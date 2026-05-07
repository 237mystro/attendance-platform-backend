const Payment = require('../models/Payment');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { processMTNPayment, processOrangePayment } = require('../utils/momo');

// @desc    Get all payments for the admin's company
// @route   GET /api/v1/payments
// @access  Private (Admin/HR)
exports.getPayments = async (req, res, next) => {
  try {
    const employeeIds = await Employee.find({
      userId: { $in: await User.find({ company: req.user.company }).distinct('_id') }
    }).distinct('_id');

    const payments = await Payment.find({ employeeId: { $in: employeeIds } })
      .populate('employeeId', 'name position');

    res.status(200).json({ success: true, count: payments.length, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get single payment
// @route   GET /api/v1/payments/:id
// @access  Private (Admin/HR)
exports.getPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findById(req.params.id).populate('employeeId', 'name position');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const employee = await Employee.findById(payment.employeeId);
    const user = await User.findById(employee?.userId);
    if (!user || user.company !== req.user.company) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this payment' });
    }

    res.status(200).json({ success: true, data: payment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Process payment to employee
// @route   POST /api/v1/payments
// @access  Private (Admin/HR)
exports.processPayment = async (req, res, next) => {
  try {
    const { employeeId, amount, paymentMethod, payrollId } = req.body;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const empUser = await User.findById(employee.userId);
    if (!empUser || empUser.company !== req.user.company) {
      return res.status(403).json({ success: false, message: 'Not authorized to pay this employee' });
    }

    if (!employee.momoNumber) {
      return res.status(400).json({ success: false, message: 'Employee does not have a mobile money number' });
    }

    let transactionResult;
    if (paymentMethod === 'mtn') {
      transactionResult = await processMTNPayment(employee.momoNumber, amount);
    } else if (paymentMethod === 'orange') {
      transactionResult = await processOrangePayment(employee.momoNumber, amount);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method' });
    }

    if (!transactionResult.success) {
      return res.status(400).json({ success: false, message: transactionResult.message });
    }

    const payment = await Payment.create({
      employeeId,
      payrollId,
      amount,
      paymentMethod,
      transactionId: transactionResult.transactionId,
      status: 'completed',
      momoReference: transactionResult.momoReference,
      receiptUrl: transactionResult.receiptUrl,
      paidAt: Date.now()
    });

    await payment.populate('employeeId', 'name position');

    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};
