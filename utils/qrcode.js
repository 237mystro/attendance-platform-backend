// backend/utils/qrcode.js (updated for messaging)
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

// Generate QR code for a shift
const generateShiftQRCode = async (shiftId) => {
  try {
    // Create a unique token for this shift
    const token = crypto.randomBytes(32).toString('hex');
    
    // Create QR data with shift ID and token
    const qrData = JSON.stringify({
      shiftId,
      token,
      timestamp: Date.now()
    });
    
    // Generate QR code
    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    return {
      success: true,
      qrCode,
      token
    };
  } catch (err) {
    console.error('QR Code generation error:', err);
    return {
      success: false,
      message: 'Error generating QR code'
    };
  }
};

// Verify QR code data
const verifyQRData = (qrDataString) => {
  try {
    const data = JSON.parse(qrDataString);
    
    // Check if it's for the correct shift
    if (!data.shiftId || !data.token || !data.timestamp) {
      return { 
        success: false, 
        message: 'Invalid QR code format' 
      };
    }
    
    // Check if it's not expired (5 minutes)
    const now = Date.now();
    if (now - data.timestamp > 5 * 60 * 1000) {
      return { 
        success: false, 
        message: 'QR code has expired' 
      };
    }
    
    return { 
      success: true, 
        shiftId: data.shiftId,
        token: data.token,
        timestamp: data.timestamp
    };
  } catch (err) {
    console.error('QR Code verification error:', err);
    return { 
      success: false, 
      message: 'Invalid QR code' 
    };
  }
};

// Generate QR code for a location
const generateLocationQRCode = async (locationId) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const qrData = JSON.stringify({ locationId, token, timestamp: Date.now() });
    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });
    return { success: true, qrCode, token };
  } catch (err) {
    console.error('Location QR Code generation error:', err);
    return { success: false, message: 'Error generating location QR code' };
  }
};

module.exports = {
  generateShiftQRCode,
  generateLocationQRCode,
  verifyQRData
};