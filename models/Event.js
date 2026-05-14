const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
  company: {
    type: String,
    required: true
  },
  companySlug: {
    type: String,
    required: true,
    index: true
  },
  eventToken: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Please add an event title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  date: {
    type: Date,
    required: [true, 'Please add an event date']
  },
  location: {
    latitude: {
      type: Number,
      required: [true, 'Please add location latitude']
    },
    longitude: {
      type: Number,
      required: [true, 'Please add location longitude']
    },
    radius: {
      type: Number,
      default: 100,
      min: [10, 'Radius must be at least 10 meters']
    },
    address: String
  },
  qrCode: {
    type: String,
    required: true
  },
  link: {
    type: String,
    required: true
  },
  requiredFields: [{
    name: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['text', 'email', 'number', 'date', 'select'],
      default: 'text'
    },
    options: [String], // for select type
    required: {
      type: Boolean,
      default: true
    }
  }],
  attendees: [{
    name: String,
    email: String,
    phone: String,
    age: Number,
    customFields: mongoose.Schema.Types.Mixed,
    submittedAt: {
      type: Date,
      default: Date.now
    },
    location: {
      latitude: Number,
      longitude: Number
    }
  }],
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
EventSchema.index({ company: 1, date: -1 });
EventSchema.index({ link: 1 });
EventSchema.index({ companySlug: 1, eventToken: 1 });

module.exports = mongoose.model('Event', EventSchema);
