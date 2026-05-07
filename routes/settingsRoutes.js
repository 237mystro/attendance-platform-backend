// backend/routes/settingsRoutes.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const {
  getSettings,
  updateSettings,
  updateProfile,
  changePassword
} = require('../controllers/settingsController');
const { protect } = require('../middleware/auth');

const router = express.Router();

const avatarDir = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image uploads are allowed for profile photos.'));
    }
  }
});

router.route('/')
  .get(protect, getSettings) 
  .put(protect, updateSettings);

router.route('/profile') 
  .put(protect, (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'Profile image must be 5 MB or smaller.' });
      }
      return res.status(400).json({ success: false, message: err.message || 'Avatar upload failed.' });
    });
  }, updateProfile);

router.route('/change-password')
  .put(protect, changePassword);

module.exports = router;
