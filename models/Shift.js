// backend/models/Shift.js (updated)
const mongoose = require('mongoose');
const crypto = require('crypto');

const ShiftSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  day: {
    type: String,
    required: true,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'missed'],
    default: 'scheduled'
  },
  qrToken: {
    type: String
  },
  qrExpiry: {
    type: Date
  },
  checkInTime: {
    type: Date
  },
  checkOutTime: {
    type: Date
  },
  checkInLocation: {
    type: {
      type: String,
      enum: ['Point']
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  assignmentStatus: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  },
  company: {
    type: String
  },
  notified30min: {
    type: Boolean,
    default: false
  },
  notified15min: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate QR token before saving
ShiftSchema.pre('save', function(next) {
  if (!this.qrToken) {
    this.qrToken = crypto.randomBytes(32).toString('hex');
    this.qrExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry
  }
  next();
});

module.exports = mongoose.model('Shift', ShiftSchema);
