const mongoose = require('mongoose');

const BranchSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Branch name is required'],
    trim: true,
    maxlength: 100
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  managerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  hrId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  geofence: {
    latitude:  { type: Number },
    longitude: { type: Number },
    radius:    { type: Number, min: 30, max: 200, default: 100 },
    address:   { type: String, trim: true }
  },
  qrToken:              { type: String, default: '' },
  qrTokenGeneratedAt:   { type: Date },
  qrTokenPrevious:      { type: String, default: '' },
  qrTokenPreviousExpiry:{ type: Date },
  bufferMinutes: { type: Number, default: 0, min: 0, max: 120 },
  active:        { type: Boolean, default: true },
  createdAt:     { type: Date, default: Date.now }
});

module.exports = mongoose.model('Branch', BranchSchema);
