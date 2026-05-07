const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  registerBusiness,
  login,
  forgotPassword,
  resetPassword
} = require('../controllers/authController');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many attempts. Please try again after 15 minutes.' }
});

router.post('/register-business', authLimiter, registerBusiness);
router.post('/login', authLimiter, login);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

module.exports = router;
