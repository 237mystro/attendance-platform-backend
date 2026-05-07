const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { isBranchRole } = require('../middleware/auth');

const getEmployeeIds = async (reqUser) => {
  if (isBranchRole(reqUser)) {
    return Employee.find({ branchId: reqUser.branchId }).distinct('_id');
  }
  const userIds = await User.find({ company: reqUser.company }).distinct('_id');
  return Employee.find({ userId: { $in: userIds } }).distinct('_id');
};

// @desc    Get current employee's own shifts (all assignment statuses)
// @route   GET /api/v1/schedules/my-shifts
// @access  Private (Employee)
exports.getMyShifts = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const defaultFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const from = req.query.from ? new Date(req.query.from) : defaultFrom;

    const shifts = await Shift.find({
      employeeId: employee._id,
      date: { $gte: from }
    }).sort({ date: 1 });

    res.status(200).json({ success: true, count: shifts.length, data: shifts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get all shifts for company
// @route   GET /api/v1/schedules
// @access  Private (Admin/HR)
exports.getShifts = async (req, res) => {
  try {
    const employeeIds = await getEmployeeIds(req.user);

    const shifts = await Shift.find({ employeeId: { $in: employeeIds } })
      .populate('employeeId', 'name position')
      .sort({ date: -1 });

    res.status(200).json({ success: true, count: shifts.length, data: shifts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get single shift
// @route   GET /api/v1/schedules/:id
// @access  Private (Admin/HR)
exports.getShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id).populate('employeeId', 'name position');
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    const employee = await Employee.findById(shift.employeeId);
    const user = await User.findById(employee?.userId);
    if (!user || user.company !== req.user.company) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this shift' });
    }

    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Create new shift and notify employee
// @route   POST /api/v1/schedules
// @access  Private (Admin/HR)
exports.createShift = async (req, res) => {
  try {
    const { employeeId, date, day, startTime, endTime } = req.body;

    if (!employeeId || !date || !day || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'employeeId, date, day, startTime and endTime are all required.' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Verify the employee belongs to the same company, and for branch roles, to their branch
    const empUser = await User.findById(employee.userId);
    if (!empUser || empUser.company !== req.user.company) {
      return res.status(403).json({ success: false, message: 'Employee does not belong to your company' });
    }
    if (isBranchRole(req.user) && employee.branchId?.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'Employee does not belong to your branch' });
    }

    const shift = await Shift.create({
      employeeId,
      date,
      day,
      startTime,
      endTime,
      company: req.user.company,
      assignmentStatus: 'pending',
      status: 'scheduled'
    });

    await shift.populate('employeeId', 'name position');

    // Push real-time notification to the employee
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${employee.userId}`).emit('shift:assigned', {
        shift,
        message: `New shift assigned: ${day} ${startTime}–${endTime}`
      });
    }

    res.status(201).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Update shift
// @route   PUT /api/v1/schedules/:id
// @access  Private (Admin/HR)
exports.updateShift = async (req, res) => {
  try {
    const shift = await Shift.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('employeeId', 'name position');

    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Delete shift
// @route   DELETE /api/v1/schedules/:id
// @access  Private (Admin/HR)
exports.deleteShift = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }

    await Shift.deleteOne({ _id: shift._id });

    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Bulk-create recurring shifts for one employee
// @route   POST /api/v1/schedules/bulk
// @access  Private (Admin/HR/Branch)
exports.bulkCreateShifts = async (req, res) => {
  try {
    const { employeeId, days, startTime, endTime, startDate, endDate } = req.body;

    if (!employeeId || !Array.isArray(days) || !days.length ||
        !startTime || !endTime || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'employeeId, days (array), startTime, endTime, startDate and endDate are all required.'
      });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ success: false, message: 'Start time must be before end time.' });
    }

    const start = new Date(startDate + 'T00:00:00');
    const end   = new Date(endDate   + 'T00:00:00');
    if (start > end) {
      return res.status(400).json({ success: false, message: 'Start date must be before end date.' });
    }
    const spanDays = Math.round((end - start) / 86400000);
    if (spanDays > 366) {
      return res.status(400).json({ success: false, message: 'Date range cannot exceed 1 year.' });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const empUser = await User.findById(employee.userId);
    if (!empUser || empUser.company !== req.user.company) {
      return res.status(403).json({ success: false, message: 'Employee does not belong to your company' });
    }
    if (isBranchRole(req.user) && employee.branchId?.toString() !== req.user.branchId?.toString()) {
      return res.status(403).json({ success: false, message: 'Employee does not belong to your branch' });
    }

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const shiftsToCreate = [];
    const cur = new Date(start);

    while (cur <= end) {
      const dayName = DAY_NAMES[cur.getDay()];
      if (days.includes(dayName)) {
        shiftsToCreate.push({
          employeeId,
          date: new Date(cur),
          day: dayName,
          startTime,
          endTime,
          company: req.user.company,
          assignmentStatus: 'pending',
          status: 'scheduled'
        });
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (!shiftsToCreate.length) {
      return res.status(400).json({
        success: false,
        message: 'No shifts generated — none of the selected days fall in the chosen date range.'
      });
    }

    const created = await Shift.insertMany(shiftsToCreate);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${employee.userId}`).emit('shift:assigned', {
        count: created.length,
        message: `${created.length} shifts assigned (${days.join(', ')}, ${startTime}–${endTime})`
      });
    }

    res.status(201).json({
      success: true,
      count: created.length,
      message: `${created.length} shift${created.length === 1 ? '' : 's'} created successfully.`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Employee checks in to a shift
// @route   POST /api/v1/schedules/:id/checkin
// @access  Private
exports.checkIn = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }
    if (shift.status !== 'scheduled') {
      return res.status(400).json({ success: false, message: 'Shift is not in a scheduled state.' });
    }

    shift.status = 'in-progress';
    shift.checkInTime = new Date();
    await shift.save();

    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Employee checks out of a shift
// @route   POST /api/v1/schedules/:id/checkout
// @access  Private
exports.checkOut = async (req, res) => {
  try {
    const shift = await Shift.findById(req.params.id);
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }
    if (shift.status !== 'in-progress') {
      return res.status(400).json({ success: false, message: 'Shift is not currently in progress.' });
    }

    shift.status = 'completed';
    shift.checkOutTime = new Date();
    await shift.save();

    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Employee accepts or declines a pending shift assignment
// @route   PATCH /api/v1/schedules/:id/respond
// @access  Private (Employee)
exports.respondToShift = async (req, res) => {
  try {
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be "accept" or "decline".' });
    }

    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    const shift = await Shift.findOne({ _id: req.params.id, employeeId: employee._id });
    if (!shift) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }
    if (shift.assignmentStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'This shift has already been responded to.' });
    }

    shift.assignmentStatus = action === 'accept' ? 'accepted' : 'declined';
    await shift.save();
    await shift.populate('employeeId', 'name position');

    // Notify all admin/hr in the company
    const io = req.app.get('io');
    if (io && shift.company) {
      io.to(`company_${shift.company}`).emit('shift:response', {
        shiftId: shift._id,
        employeeName: employee.name,
        assignmentStatus: shift.assignmentStatus
      });
    }

    res.status(200).json({ success: true, data: shift });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
