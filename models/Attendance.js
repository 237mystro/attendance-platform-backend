const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  shiftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
    required: true
  },
  date: { type: Date, required: true, index: true },
  checkInTime: { type: Date },
  checkOutTime: { type: Date },
  status: {
    type: String,
    enum: ['present', 'late', 'absent', 'excused'],
    default: 'absent'
  },
  // Check-in geo location
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number], index: '2dsphere' }
  },
  // Check-out geo location
  checkOutLocation: {
    type: { type: String, enum: ['Point'] },
    coordinates: [Number]
  },
  selfieUrl: { type: String },
  checkOutSelfieUrl: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  qrData: { type: String },
  // 'qr' = scanned QR code, 'biometric' = Face ID / fingerprint
  attendanceMethod: {
    type: String,
    enum: ['qr', 'biometric'],
    default: 'qr'
  },
  biometricType: {
    type: String,
    enum: ['fingerprint', 'faceId', 'unknown']
  },
  // SHA-256 fingerprint of the device's browser characteristics
  deviceFingerprint: { type: String },
  // false if the device fingerprint was not previously seen for this employee
  isKnownDevice: { type: Boolean, default: true },
  // true when an unrecognised device is detected — triggers admin alert
  deviceFlagged: { type: Boolean, default: false },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1, status: 1 });
AttendanceSchema.index({ deviceFlagged: 1, date: -1 });

module.exports = mongoose.model('Attendance', AttendanceSchema);
