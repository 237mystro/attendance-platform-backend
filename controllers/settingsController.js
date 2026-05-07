// backend/controllers/settingsController.js
const User = require('../models/User');
const Employee = require('../models/Employee');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const serializeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  company: user.company,
  role: user.role,
  branchId: user.branchId || null,
  phone: user.phone || '',
  momoNumber: user.momoNumber || '',
  position: user.position || '',
  avatarUrl: user.avatarUrl || '',
  preferences: user.preferences || { theme: 'light', language: 'en' },
  notifications: user.notifications || { email: true, sms: false, push: true }
});

// @desc    Get user settings
// @route   GET /api/v1/settings
// @access  Private
exports.getSettings = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        notifications: user.notifications || {
          email: true,
          sms: false,
          push: true
        },
        preferences: user.preferences || {
          theme: 'light',
          language: 'en'
        },
        security: {
          twoFactorAuth: user.twoFactorAuth || false
        }
      }
    });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching settings'
    });
  }
};

// @desc    Update user settings
// @route   PUT /api/v1/settings
// @access  Private
exports.updateSettings = async (req, res, next) => {
  try {
    const { notifications, preferences, security } = req.body;
    
    const updateData = {};
    if (notifications) updateData.notifications = notifications;
    if (preferences) updateData.preferences = preferences;
    if (security) updateData.twoFactorAuth = security.twoFactorAuth;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: {
        notifications: user.notifications || {
          email: true,
          sms: false,
          push: true
        },
        preferences: user.preferences || {
          theme: 'light',
          language: 'en'
        },
        security: {
          twoFactorAuth: user.twoFactorAuth || false
        }
      }
    });
  } catch (err) {
    console.error('Update settings error:', err);
    
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ success: false, message: message.join(', ') });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while updating settings'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/v1/settings/profile
// @access  Private
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, email, phone, momoNumber, position } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    if (momoNumber) updateData.momoNumber = momoNumber;
    if (position) updateData.position = position;
    if (req.file) {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'autopay_avatars',
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
            resource_type: 'image'
          });
          updateData.avatarUrl = result.secure_url;
        } finally {
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        }
      } else {
        updateData.avatarUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${req.file.filename}`;
      }
    }

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Update employee record if exists
    const employee = await Employee.findOne({ userId: req.user.id });
    if (employee) {
      await Employee.findByIdAndUpdate(employee._id, updateData, {
        new: true,
        runValidators: true
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: serializeUser(user)
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ success: false, message: message.join(', ') });
    }
    
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
};

// @desc    Change password
// @route   PUT /api/v1/settings/change-password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide current and new passwords' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    user.isFirstLogin = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: 'Server error while changing password' });
  }
};
