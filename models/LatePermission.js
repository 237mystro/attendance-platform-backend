const mongoose = require('mongoose');

const latePermissionSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  company: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true,
    maxlength: 500
  },
  estimatedArrival: {
    type: String  // HH:MM format, optional
  },
  status: {
    type: String,
    enum: ['pending', 'approved_extension', 'approved_full', 'denied'],
    default: 'pending'
  },
  // Only used when status === 'approved_extension'
  extraMinutes: {
    type: Number,
    default: 0
  },
  adminNote: {
    type: String,
    maxlength: 300,
    default: ''
  }
}, { timestamps: true });

// One request per employee per day
latePermissionSchema.index({ employeeId: 1, date: 1 }, { unique: true });
latePermissionSchema.index({ company: 1, status: 1 });

module.exports = mongoose.model('LatePermission', latePermissionSchema);
