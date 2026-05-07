const Payroll = require('../models/Payroll');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const User = require('../models/User');
const { isBranchRole } = require('../middleware/auth');

const getEmployeeIds = async (reqUser) => {
  if (isBranchRole(reqUser)) {
    return Employee.find({ branchId: reqUser.branchId, status: 'active' }).distinct('_id');
  }
  const userIds = await User.find({ company: reqUser.company }).distinct('_id');
  return Employee.find({ userId: { $in: userIds }, status: 'active' }).distinct('_id');
};

// @desc    Get current employee's own payroll history
// @route   GET /api/v1/payrolls/my-history
// @access  Private (Employee)
exports.getMyPayrollHistory = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const payrolls = await Payroll.find({
      company: req.user.company,
      'employees.employeeId': employee._id
    }).sort({ createdAt: -1 }).limit(12);

    const history = payrolls.map(p => {
      const entry = p.employees.find(e => e.employeeId.toString() === employee._id.toString());
      return {
        _id: p._id,
        period: p.period,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        shifts: entry?.shifts || 0,
        amount: entry?.totalAmount || 0
      };
    });

    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (err) {
    console.error('Get my payroll history error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching payroll history' });
  }
};

// @desc    Get all payrolls for the admin's company
// @route   GET /api/v1/payrolls
// @access  Private (Admin/HR)
exports.getPayrolls = async (req, res, next) => {
  try {
    const filter = { company: req.user.company };
    if (isBranchRole(req.user)) filter.branchId = req.user.branchId;
    const payrolls = await Payroll.find(filter);

    res.status(200).json({ success: true, count: payrolls.length, data: payrolls });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get single payroll
// @route   GET /api/v1/payrolls/:id
// @access  Private (Admin/HR)
exports.getPayroll = async (req, res, next) => {
  try {
    const payroll = await Payroll.findOne({ _id: req.params.id, company: req.user.company });

    if (!payroll) {
      return res.status(404).json({ success: false, message: 'Payroll not found' });
    }

    res.status(200).json({ success: true, data: payroll });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Create payroll
// @route   POST /api/v1/payrolls
// @access  Private (Admin/HR)
exports.createPayroll = async (req, res, next) => {
  try {
    const { period, startDate, endDate } = req.body;

    const empIds = await getEmployeeIds(req.user);
    const employees = await Employee.find({ _id: { $in: empIds } });

    const payrollEmployees = [];
    let totalAmount = 0;
    let totalEmployees = 0;

    for (const employee of employees) {
      const shifts = await Shift.find({
        employeeId: employee._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: 'completed'
      });

      if (shifts.length > 0) {
        const totalShifts = shifts.length;
        const totalHours = shifts.reduce((sum, shift) => {
          const start = new Date(`1970-01-01T${shift.startTime}`);
          const end = new Date(`1970-01-01T${shift.endTime}`);
          return sum + (end - start) / (1000 * 60 * 60);
        }, 0);

        const totalAmountForEmployee = totalShifts * employee.payPerShift;

        payrollEmployees.push({
          employeeId: employee._id,
          name: employee.name,
          position: employee.position,
          shifts: totalShifts,
          hours: totalHours,
          payPerShift: employee.payPerShift,
          totalAmount: totalAmountForEmployee
        });

        totalAmount += totalAmountForEmployee;
        totalEmployees++;
      }
    }

    const payroll = await Payroll.create({
      period,
      startDate,
      endDate,
      company: req.user.company,
      branchId: isBranchRole(req.user) ? req.user.branchId : null,
      employees: payrollEmployees,
      totalEmployees,
      totalAmount,
      processedBy: req.user.id,
      processedAt: Date.now()
    });

    res.status(201).json({ success: true, data: payroll });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Process payroll payment
// @route   PUT /api/v1/payrolls/:id/process
// @access  Private (Admin/HR)
exports.processPayroll = async (req, res, next) => {
  try {
    const payroll = await Payroll.findOne({ _id: req.params.id, company: req.user.company });

    if (!payroll) {
      return res.status(404).json({ success: false, message: 'Payroll not found' });
    }

    if (payroll.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Payroll has already been processed' });
    }

    payroll.status = 'processed';
    payroll.paidAt = Date.now();
    await payroll.save();

    res.status(200).json({ success: true, data: payroll });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
