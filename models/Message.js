// backend/models/Message.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  company: {
    type: String,
    required: true
  },
  content: {
    type: String,
    trim: true,
    maxlength: [10000, 'Message content cannot exceed 10,000 characters']
  },
  fileUrl: {
    type: String,
    trim: true
  },
  fileName: {
    type: String,
    trim: true
  },
  fileType: {
    type: String,
    enum: ['image', 'video', 'document', 'other'],
    default: 'other'
  },
  // Multiple attachments (announcements with several files)
  files: [{
    url: { type: String, trim: true },
    name: { type: String, trim: true },
    type: { type: String, enum: ['image', 'video', 'document', 'other'], default: 'other' }
  }],
  isAnnouncement: {
    type: Boolean,
    default: false
  },
  readBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient querying
MessageSchema.index({ company: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
MessageSchema.index({ company: 1, isAnnouncement: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);