const ShiftTransfer = require('../models/ShiftTransfer');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { sendShiftTransferRequest, sendShiftTransferResult } = require('../utils/emailService');

// @desc    Get employees eligible to receive a transfer (same company, excluding self)
// @route   GET /api/v1/shift-transfers/eligible-employees
// @access  Private (Employee)
exports.getEligibleEmployees = async (req, res) => {
  try {
    const companyUserIds = await User.find({
      company: req.user.company,
      role: 'employee',
      _id: { $ne: req.user.id }
    }).distinct('_id');

    const employees = await Employee.find({ userId: { $in: companyUserIds } })
      .select('_id name position userId');

    res.status(200).json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Request a shift transfer to another employee
// @route   POST /api/v1/shift-transfers/request
// @access  Private (Employee)
exports.requestTransfer = async (req, res) => {
  try {
    const { shiftId, toEmployeeId, message } = req.body;

    if (!shiftId || !toEmployeeId) {
      return res.status(400).json({ success: false, message: 'shiftId and toEmployeeId are required' });
    }

    const myEmployee = await Employee.findOne({ userId: req.user.id });
    if (!myEmployee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    if (shift.employeeId.toString() !== myEmployee._id.toString()) {
      return res.status(403).json({ success: false, message: 'This shift is not assigned to you' });
    }

    if (shift.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'Only scheduled shifts can be transferred' });
    }

    const shiftDate = new Date(shift.date);
    const [hours, minutes] = shift.startTime.split(':');
    shiftDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    if (shiftDate < new Date()) {
      return res.status(400).json({ success: false, message: 'Cannot transfer a shift that has already started or passed' });
    }

    const existingPending = await ShiftTransfer.findOne({ shiftId, status: 'pending' });
    if (existingPending) {
      return res.status(400).json({ success: false, message: 'A pending transfer request already exists for this shift' });
    }

    const toEmployee = await Employee.findById(toEmployeeId).populate('userId', 'name email company');
    if (!toEmployee || toEmployee.userId.company !== req.user.company) {
      return res.status(404).json({ success: false, message: 'Target employee not found' });
    }

    const transfer = await ShiftTransfer.create({
      shiftId,
      fromEmployeeId: myEmployee._id,
      toEmployeeId: toEmployee._id,
      company: req.user.company,
      message: message || ''
    });

    await transfer.populate([
      { path: 'shiftId' },
      { path: 'fromEmployeeId', select: 'name position' },
      { path: 'toEmployeeId', select: 'name position' }
    ]);

    // Socket.IO notification to target employee
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${toEmployee.userId._id}`).emit('transfer:incoming', {
        transfer,
        shift,
        from: { name: req.user.name, id: req.user.id }
      });
    }

    // Email notification to target employee
    await sendShiftTransferRequest(
      toEmployee.email,
      toEmployee.name,
      req.user.name,
      shift,
      message
    );

    res.status(201).json({ success: true, transfer });
  } catch (err) {
    console.error('Request transfer error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Accept or decline an incoming shift transfer
// @route   PATCH /api/v1/shift-transfers/:id/:action  (action = accept | decline)
// @access  Private (Employee)
exports.respondToTransfer = async (req, res) => {
  try {
    const { id, action } = req.params;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    const myEmployee = await Employee.findOne({ userId: req.user.id });
    if (!myEmployee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const transfer = await ShiftTransfer.findOne({
      _id: id,
      toEmployeeId: myEmployee._id,
      status: 'pending'
    }).populate('shiftId').populate('fromEmployeeId', 'userId name');

    if (!transfer) {
      return res.status(404).json({ success: false, message: 'Pending transfer request not found' });
    }

    transfer.status = action === 'accept' ? 'accepted' : 'declined';
    await transfer.save();

    if (action === 'accept') {
      // Reassign the shift to the new employee
      await Shift.findByIdAndUpdate(transfer.shiftId._id, { employeeId: myEmployee._id });
    }

    // Notify the original employee via socket
    const fromUser = await User.findById(transfer.fromEmployeeId.userId);
    const io = req.app.get('io');
    if (io && fromUser) {
      io.to(`user_${fromUser._id}`).emit(
        action === 'accept' ? 'transfer:accepted' : 'transfer:declined',
        {
          transferId: transfer._id,
          shiftId: transfer.shiftId._id,
          by: { name: req.user.name }
        }
      );
    }

    // Email the original employee
    if (fromUser) {
      await sendShiftTransferResult(
        fromUser.email,
        fromUser.name,
        req.user.name,
        transfer.shiftId,
        action
      );
    }

    res.status(200).json({ success: true, transfer });
  } catch (err) {
    console.error('Respond to transfer error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all transfers sent from or to current employee
// @route   GET /api/v1/shift-transfers/my-transfers
// @access  Private (Employee)
exports.getMyTransfers = async (req, res) => {
  try {
    const myEmployee = await Employee.findOne({ userId: req.user.id });
    if (!myEmployee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const transfers = await ShiftTransfer.find({
      $or: [
        { fromEmployeeId: myEmployee._id },
        { toEmployeeId: myEmployee._id }
      ],
      company: req.user.company
    })
      .populate('shiftId', 'date startTime endTime day status')
      .populate('fromEmployeeId', 'name position')
      .populate('toEmployeeId', 'name position')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, transfers });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
