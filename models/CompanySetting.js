const mongoose = require('mongoose');

const CompanySettingSchema = new mongoose.Schema({
  company: { type: String, required: true, unique: true, trim: true },
  geofence: {
    latitude: { type: Number },
    longitude: { type: Number },
    radius: { type: Number, min: 30, max: 200, default: 100 },
    address: { type: String, trim: true }
  },
  // Attendance QR — current token and one grace-period previous token
  qrToken: { type: String, default: '' },
  qrTokenGeneratedAt: { type: Date },
  qrTokenPrevious: { type: String, default: '' },
  qrTokenPreviousExpiry: { type: Date },
  // Late-deduction buffer (minutes)
  bufferMinutes: { type: Number, default: 0, min: 0, max: 120 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CompanySetting', CompanySettingSchema);
