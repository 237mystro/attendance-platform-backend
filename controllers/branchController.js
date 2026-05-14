const crypto = require('crypto');
const QRCode = require('qrcode');
const Branch = require('../models/Branch');
const User = require('../models/User');
const Employee = require('../models/Employee');

// ── Helpers ──────────────────────────────────────────────────────────────────

const buildBranchQR = async (branch) => {
  const payload = JSON.stringify({
    type: 'company_checkin',
    company: branch.company,
    branchId: branch._id.toString(),
    token: branch.qrToken
  });
  return QRCode.toDataURL(payload, { width: 500, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
};

// ── CRUD ─────────────────────────────────────────────────────────────────────

// @desc  Get all branches for admin's company
// @route GET /api/v1/branches
// @access Private (Admin/HR)
exports.getBranches = async (req, res) => {
  try {
    const branches = await Branch.find({ company: req.user.company, active: true })
      .populate('managerId', 'name email position')
      .populate('hrId', 'name email position')
      .sort({ createdAt: 1 });

    // Attach employee count to each branch
    const result = await Promise.all(branches.map(async (b) => {
      const count = await Employee.countDocuments({ branchId: b._id });
      return { ...b.toObject(), employeeCount: count };
    }));

    res.status(200).json({ success: true, count: result.length, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Get single branch
// @route GET /api/v1/branches/:id
// @access Private (Admin/HR/Branch Manager)
exports.getBranch = async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (!['admin', 'hr'].includes(req.user.role)) {
      filter._id = req.user.branchId; // branch staff only see their own
    }

    const branch = await Branch.findOne(filter)
      .populate('managerId', 'name email position')
      .populate('hrId', 'name email position');

    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const employeeCount = await Employee.countDocuments({ branchId: branch._id });
    res.status(200).json({ success: true, data: { ...branch.toObject(), employeeCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Create branch
// @route POST /api/v1/branches
// @access Private (Admin)
exports.createBranch = async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Branch name is required.' });

    const branch = await Branch.create({
      name,
      address: address || '',
      company: req.user.company
    });

    res.status(201).json({ success: true, data: branch });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc  Update branch details (name / address)
// @route PUT /api/v1/branches/:id
// @access Private (Admin)
exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { name: req.body.name, address: req.body.address },
      { new: true, runValidators: true }
    );
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc  Soft-delete branch
// @route DELETE /api/v1/branches/:id
// @access Private (Admin)
exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      { active: false },
      { new: true }
    );
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    // Remove branchId from users and employees that were in this branch
    await User.updateMany({ branchId: branch._id }, { branchId: null, role: 'employee' });
    await Employee.updateMany({ branchId: branch._id }, { branchId: null });

    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Role assignment ───────────────────────────────────────────────────────────

// @desc  Assign an employee as branch_manager or branch_hr
// @route POST /api/v1/branches/:id/assign
// @access Private (Admin)
exports.assignRole = async (req, res) => {
  try {
    const { userId, role } = req.body; // role: 'branch_manager' | 'branch_hr' | 'employee'

    if (!userId) return res.status(400).json({ success: false, message: 'userId is required.' });
    if (!['branch_manager', 'branch_hr', 'employee'].includes(role)) {
      return res.status(400).json({ success: false, message: 'role must be branch_manager, branch_hr, or employee.' });
    }

    const branch = await Branch.findOne({ _id: req.params.id, company: req.user.company });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const targetUser = await User.findOne({ _id: userId, company: req.user.company });
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found in your company' });

    // If demoting back to employee, clear their previous branch manager/hr slot
    if (role === 'employee') {
      if (branch.managerId?.toString() === userId) branch.managerId = null;
      if (branch.hrId?.toString() === userId)      branch.hrId = null;
      targetUser.branchId = null;
    } else {
      // If this branch already has someone in this slot, demote them first
      const slotField = role === 'branch_manager' ? 'managerId' : 'hrId';
      if (branch[slotField] && branch[slotField].toString() !== userId) {
        await User.findByIdAndUpdate(branch[slotField], { role: 'employee', branchId: null });
      }
      branch[slotField] = userId;
      targetUser.branchId = branch._id;
    }

    targetUser.role = role;
    await targetUser.save();
    await branch.save();

    // Also update the Employee record's branchId if it exists
    await Employee.findOneAndUpdate({ userId: targetUser._id }, {
      branchId: role === 'employee' ? null : branch._id
    });

    await branch.populate('managerId', 'name email position');
    await branch.populate('hrId', 'name email position');

    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Branch-scoped settings (geofence, QR) ────────────────────────────────────

// @desc  Get branch geofence
// @route GET /api/v1/branches/:id/geofence
// @access Private
exports.getBranchGeofence = async (req, res) => {
  try {
    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    const branch = await Branch.findOne({ _id: id, company: req.user.company });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.status(200).json({
      success: true,
      geofence: branch.geofence?.latitude
        ? {
            latitude: branch.geofence.latitude,
            longitude: branch.geofence.longitude,
            radius: Math.max(Number(branch.geofence.radius) || 0, 50),
            address: branch.geofence.address || ''
          }
        : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Set branch geofence
// @route POST /api/v1/branches/:id/geofence
// @access Private (Admin / Branch Manager/HR)
exports.setBranchGeofence = async (req, res) => {
  try {
    const { latitude, longitude, radius, address } = req.body;
    const normalizedRadius = Math.max(Number(radius) || 0, 50);
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude are required.' });
    }
    if (radius < 30 || radius > 200) {
      return res.status(400).json({ success: false, message: 'Radius must be 30–200 m.' });
    }

    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    const branch = await Branch.findOneAndUpdate(
      { _id: id, company: req.user.company },
      { geofence: { latitude, longitude, radius: normalizedRadius, address: address || '' } },
      { new: true }
    );
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.status(200).json({ success: true, geofence: branch.geofence });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Get branch attendance QR code
// @route GET /api/v1/branches/:id/qr
// @access Private
exports.getBranchQR = async (req, res) => {
  try {
    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    let branch = await Branch.findOne({ _id: id, company: req.user.company });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    if (!branch.qrToken) {
      branch.qrToken = crypto.randomBytes(32).toString('hex');
      branch.qrTokenGeneratedAt = new Date();
      await branch.save();
    }

    const qrCode = await buildBranchQR(branch);
    res.status(200).json({ success: true, qrCode, generatedAt: branch.qrTokenGeneratedAt, branchName: branch.name });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Regenerate branch attendance QR code
// @route POST /api/v1/branches/:id/qr/regenerate
// @access Private (Admin / Branch Manager/HR)
exports.regenerateBranchQR = async (req, res) => {
  try {
    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    const existing = await Branch.findOne({ _id: id, company: req.user.company });
    if (!existing) return res.status(404).json({ success: false, message: 'Branch not found' });

    const now = new Date();
    const branch = await Branch.findByIdAndUpdate(
      id,
      {
        qrToken: crypto.randomBytes(32).toString('hex'),
        qrTokenGeneratedAt: now,
        qrTokenPrevious: existing.qrToken || '',
        qrTokenPreviousExpiry: new Date(now.getTime() + 10 * 60 * 1000)
      },
      { new: true }
    );

    const qrCode = await buildBranchQR(branch);
    res.status(200).json({ success: true, qrCode, generatedAt: branch.qrTokenGeneratedAt, branchName: branch.name });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Get buffer minutes for branch
// @route GET /api/v1/branches/:id/settings
// @access Private
exports.getBranchSettings = async (req, res) => {
  try {
    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    const branch = await Branch.findOne({ _id: id, company: req.user.company });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.status(200).json({ success: true, data: { bufferMinutes: branch.bufferMinutes } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Update branch settings (buffer minutes)
// @route PUT /api/v1/branches/:id/settings
// @access Private
exports.updateBranchSettings = async (req, res) => {
  try {
    const id = req.params.id === 'mine' ? req.user.branchId : req.params.id;
    const branch = await Branch.findOneAndUpdate(
      { _id: id, company: req.user.company },
      { bufferMinutes: req.body.bufferMinutes ?? 0 },
      { new: true }
    );
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.status(200).json({ success: true, data: { bufferMinutes: branch.bufferMinutes } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc  Get all employees in a branch (admin view)
// @route GET /api/v1/branches/:id/employees
// @access Private (Admin/HR)
exports.getBranchEmployees = async (req, res) => {
  try {
    const employees = await Employee.find({ branchId: req.params.id })
      .populate('userId', 'name email role');
    res.status(200).json({ success: true, count: employees.length, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
