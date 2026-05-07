const mongoose = require('mongoose');

const LateRecordSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  shiftId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Shift',    required: true },
  company:    { type: String, required: true, trim: true },
  date:       { type: Date, required: true },
  month:      { type: Number, required: true },   // 1-12
  year:       { type: Number, required: true },
  scheduledStart: { type: String, required: true }, // "08:00"
  actualCheckIn:  { type: Date, required: true },
  lateMinutes:    { type: Number, required: true },  // minutes past buffer
  bufferMinutes:  { type: Number, default: 0 },      // buffer in effect at scan time
  hourlyRate:     { type: Number, required: true },  // snapshot of salary/176
  deductionAmount:{ type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

LateRecordSchema.index({ employeeId: 1, month: 1, year: 1 });
LateRecordSchema.index({ company: 1, month: 1, year: 1 });

module.exports = mongoose.model('LateRecord', LateRecordSchema);
