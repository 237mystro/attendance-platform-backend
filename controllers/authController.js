// backend/controllers/authController.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetOtp } = require('../utils/emailService');

const sanitizeUser = (user) => ({
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

// @desc    Register business (Business Owner Registration)
// @route   POST /api/v1/auth/register-business
// @access  Public
exports.registerBusiness = async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const company = req.body.company?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;

    // Validate required fields
    if (!name || !company || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Create business admin user
    const user = await User.create({
      name,
      email,
      password,
      company,
      role: 'admin'
    });

    // Generate token
    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Registration error:', err);
    
    // Handle validation errors
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: message.join(', ')
      });
    }
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// @desc    Login user (Business Owner or Employee)
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const { password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email and password'
      });
    }

    // Check for user
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Send password reset OTP
// @route   POST /api/v1/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists for that email, a reset code has been sent.'
      });
    }

    const otp = user.generatePasswordResetOtp();
    await user.save({ validateBeforeSave: false });

    const emailResult = await sendPasswordResetOtp(user.email, user.name, otp);

    if (!emailResult.success) {
      user.passwordResetOtp = null;
      user.passwordResetOtpExpire = null;
      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Unable to send reset code right now. Please try again later.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a reset code has been sent.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while sending reset code'
    });
  }
};

// @desc    Reset password using OTP
// @route   POST /api/v1/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const otp = req.body.otp?.trim();
    const password = req.body.password;

    if (!email || !otp || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email, OTP, and new password'
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'OTP must be a 6-digit code'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    const user = await User.findOne({
      email,
      passwordResetOtp: hashedOtp,
      passwordResetOtpExpire: { $gt: new Date() }
    }).select('+password');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'The reset code is invalid or has expired'
      });
    }

    user.password = password;
    user.isFirstLogin = false;
    user.passwordResetOtp = null;
    user.passwordResetOtpExpire = null;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now sign in.'
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while resetting password'
    });
  }
};
