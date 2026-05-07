const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const { isBranchRole } = require('../middleware/auth');

// @desc    Get current employee's leave requests
// @route   GET /api/v1/leave/my-requests
// @access  Private (Employee)
exports.getMyLeaveRequests = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const requests = await Leave.find({ employeeId: employee._id })
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, requests });
  } catch (err) {
    console.error('Get my leave requests error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Submit a leave request
// @route   POST /api/v1/leave/request
// @access  Private (Employee)
exports.submitLeaveRequest = async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;

    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    }

    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const leave = await Leave.create({
      userId: req.user.id,
      employeeId: employee._id,
      company: req.user.company,
      leaveType,
      startDate,
      endDate,
      reason
    });

    res.status(201).json({ success: true, request: leave });
  } catch (err) {
    console.error('Submit leave request error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all leave requests for the company (admin/hr)
// @route   GET /api/v1/leave/all
// @access  Private (Admin/HR)
exports.getAllLeaveRequests = async (req, res) => {
  try {
    const filter = { company: req.user.company };
    if (isBranchRole(req.user)) {
      const empIds = await Employee.find({ branchId: req.user.branchId }).distinct('_id');
      filter.employeeId = { $in: empIds };
    }

    const requests = await Leave.find(filter)
      .populate('employeeId', 'name position')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, requests });
  } catch (err) {
    console.error('Get all leave requests error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Approve or deny a leave request
// @route   PATCH /api/v1/leave/:id/approve  or  PATCH /api/v1/leave/:id/deny
// @access  Private (Admin/HR)
exports.updateLeaveStatus = async (req, res) => {
  try {
    const { id, action } = req.params;

    if (!['approve', 'deny'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    const leaveFilter = { _id: id, company: req.user.company };
    if (isBranchRole(req.user)) {
      const empIds = await Employee.find({ branchId: req.user.branchId }).distinct('_id');
      leaveFilter.employeeId = { $in: empIds };
    }
    const leave = await Leave.findOne(leaveFilter);
    if (!leave) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    if (leave.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Leave request has already been actioned' });
    }

    leave.status = action === 'approve' ? 'approved' : 'denied';
    leave.adminNote = req.body.adminNote || '';
    await leave.save();

    res.status(200).json({ success: true, request: leave });
  } catch (err) {
    console.error('Update leave status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
