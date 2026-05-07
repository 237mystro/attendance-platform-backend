// backend/routes/messageRoutes.js

const express = require('express');
const {
  getConversation,
  sendMessage,
  sendAnnouncement,
  getAnnouncements,
  getUnreadCount,
  getContacts
} = require('../controllers/messageController');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    const dir = './uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'image/tiff',
  // Videos
  'video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv',
  'video/webm', 'video/3gpp', 'video/3gpp2', 'video/ogg',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error(`File type "${file.mimetype}" is not supported. Allowed: images, videos, PDFs, Word/Excel/PowerPoint, text files.`), false);
  }
};

// 100 MB per file for announcements (covers HD video clips)
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Routes
router.route('/contacts')
  .get(protect, getContacts);

router.route('/unread-count')
  .get(protect, getUnreadCount);

router.route('/announcements')
  .get(protect, getAnnouncements);

router.post('/send', protect, (req, res, next) => {
  upload.array('files', 5)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum 100 MB per file.' });
    }
    return res.status(400).json({ success: false, message: err.message || 'File upload error.' });
  });
}, sendMessage);

router.post('/announcement', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), (req, res, next) => {
  upload.array('files', 5)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum 100 MB per file.' });
    }
    return res.status(400).json({ success: false, message: err.message || 'File upload error.' });
  });
}, sendAnnouncement);

router.route('/:contactId')
  .get(protect, getConversation);

module.exports = router;