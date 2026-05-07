const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employeeId: {
    type: String,
    unique: true,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  momoNumber: {
    type: String,
    required: true
  },
  position: {
    type: String,
    required: true
  },
  department: {
    type: String
  },
  salary: {
    type: Number,
    required: true
  },
  payPerShift: {
    type: Number,
    required: true
  },
  schedule: {
    type: String
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'terminated'],
    default: 'active'
  },
  branchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // WebAuthn credentials registered on the employee's device
  biometricCredentials: [{
    credentialId: { type: String, required: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
  }],
  // Devices previously used for attendance (by fingerprint hash)
  trustedDevices: [{
    fingerprint: { type: String, required: true },
    userAgent: { type: String },
    ipAddress: { type: String },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
  }],
  // Temporary WebAuthn challenge storage (expires after 5 minutes)
  currentBiometricChallenge: { type: String },
  currentBiometricChallengeExpiry: { type: Date }
});

module.exports = mongoose.model('Employee', EmployeeSchema);