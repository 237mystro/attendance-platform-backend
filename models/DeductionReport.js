const mongoose = require('mongoose');

const EmployeeDeductionSchema = new mongoose.Schema({
  employeeId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  name:             String,
  position:         String,
  email:            String,
  baseSalary:       Number,
  totalLateMinutes: Number,
  deductionAmount:  Number,
  finalSalary:      Number,
  lateRecords:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'LateRecord' }]
}, { _id: false });

const DeductionReportSchema = new mongoose.Schema({
  company:             { type: String, required: true, trim: true },
  branchId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
  month:               { type: Number, required: true },
  year:                { type: Number, required: true },
  period:              { type: String },           // "April 2026"
  bufferMinutes:       { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'approved', 'paid'],
    default: 'draft'
  },
  employees:           [EmployeeDeductionSchema],
  totalDeductionAmount:{ type: Number, default: 0 },
  generatedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  generatedAt:         { type: Date, default: Date.now },
  approvedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:          Date,
  emailSentAt:         Date
});

DeductionReportSchema.index({ company: 1, year: 1, month: 1 });

module.exports = mongoose.model('DeductionReport', DeductionReportSchema);
