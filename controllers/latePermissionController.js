const LatePermission = require('../models/LatePermission');
const Employee = require('../models/Employee');
const { isBranchRole } = require('../middleware/auth');

const todayMidnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const getScopedEmployeeFilter = async (user) => {
  if (!isBranchRole(user)) {
    return {};
  }

  if (!user.branchId) {
    return { employeeId: { $in: [] } };
  }

  const employeeIds = await Employee.find({ branchId: user.branchId }).distinct('_id');
  return { employeeId: { $in: employeeIds } };
};

// ── Employee: submit a late request for today ─────────────────────────────────
// POST /api/v1/late-permissions
exports.submitRequest = async (req, res) => {
  try {
    const { reason, estimatedArrival } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'Please provide a reason for your late arrival.' });
    }

    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found.' });
    }

    const today = todayMidnight();
    const existing = await LatePermission.findOne({ employeeId: employee._id, date: today });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a late request for today.',
        data: existing
      });
    }

    const request = await LatePermission.create({
      employeeId: employee._id,
      company: req.user.company,
      date: today,
      reason: reason.trim(),
      estimatedArrival: estimatedArrival?.trim() || undefined
    });

    // Real-time notification to all admin/HR in the company
    if (req.app.get('io')) {
      req.app.get('io').to(`company_${req.user.company}`).emit('late_permission:new', {
        requestId: request._id,
        employeeName: employee.name,
        branchId: employee.branchId ? employee.branchId.toString() : null,
        reason: request.reason,
        estimatedArrival: request.estimatedArrival || null
      });
    }

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already submitted a late request for today.' });
    }
    console.error('Submit late request error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── Employee: view own request history ───────────────────────────────────────
// GET /api/v1/late-permissions/my
exports.getMyRequests = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found.' });
    }

    const requests = await LatePermission.find({ employeeId: employee._id })
      .sort({ date: -1 })
      .limit(30);

    res.json({ success: true, data: requests });
  } catch (err) {
    console.error('Get my late requests error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── Admin: view all company requests ─────────────────────────────────────────
// GET /api/v1/late-permissions/admin?status=pending
exports.getCompanyRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {
      company: req.user.company,
      ...(await getScopedEmployeeFilter(req.user))
    };
    if (status) filter.status = status;

    const requests = await LatePermission.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('employeeId', 'name position');

    res.json({ success: true, count: requests.length, data: requests });
  } catch (err) {
    console.error('Get company late requests error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── Admin: get pending request count (for badge) ──────────────────────────────
// GET /api/v1/late-permissions/pending-count
exports.getPendingCount = async (req, res) => {
  try {
    const count = await LatePermission.countDocuments({
      company: req.user.company,
      status: 'pending',
      ...(await getScopedEmployeeFilter(req.user))
    });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ── Admin: review a request ───────────────────────────────────────────────────
// PUT /api/v1/late-permissions/:id/review
exports.reviewRequest = async (req, res) => {
  try {
    const { status, extraMinutes, adminNote } = req.body;

    if (!['approved_extension', 'approved_full', 'denied'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid decision.' });
    }
    if (status === 'approved_extension') {
      const mins = Number(extraMinutes);
      if (!Number.isFinite(mins) || mins < 1 || mins > 480) {
        return res.status(400).json({ success: false, message: 'Extra minutes must be between 1 and 480.' });
      }
    }

    const requestFilter = {
      _id: req.params.id,
      company: req.user.company,
      ...(await getScopedEmployeeFilter(req.user))
    };

    const request = await LatePermission
      .findOne(requestFilter)
      .populate('employeeId', 'name userId branchId');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This request has already been reviewed.' });
    }

    request.status      = status;
    request.extraMinutes = status === 'approved_extension' ? Number(extraMinutes) : 0;
    request.adminNote   = adminNote?.trim() || '';
    await request.save();

    // Notify the specific employee via their personal socket room
    const io = req.app.get('io');
    if (request.employeeId?.userId && io) {
      io.to(`user_${request.employeeId.userId}`).emit('late_permission:reviewed', {
        requestId: request._id,
        status,
        extraMinutes: request.extraMinutes,
        adminNote: request.adminNote
      });
    }

    // Push updated pending count to all admins in the company
    if (io) {
      const remaining = await LatePermission.countDocuments({
        company: req.user.company,
        status: 'pending'
      });
      io.to(`company_${req.user.company}`).emit('late_permission:count', {
        count: remaining,
        branchId: request.employeeId?.branchId ? request.employeeId.branchId.toString() : null
      });
    }

    res.json({ success: true, data: request });
  } catch (err) {
    console.error('Review late request error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};
