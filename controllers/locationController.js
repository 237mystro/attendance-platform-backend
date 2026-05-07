const crypto = require('crypto');
const QRCode = require('qrcode');
const Location = require('../models/Location');
const CompanySetting = require('../models/CompanySetting');
const { generateLocationQRCode } = require('../utils/qrcode');
const User = require('../models/User');

// Build the QR image data URL from a company setting document
const buildQRDataURL = async (setting) => {
  const payload = JSON.stringify({
    type: 'company_checkin',
    company: setting.company,
    token: setting.qrToken
  });
  return QRCode.toDataURL(payload, {
    width: 500,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
};

// @desc    Get all locations
// @route   GET /api/v1/locations
// @access  Private (Admin/HR)
exports.getLocations = async (req, res, next) => {
  try {
    const locations = await Location.find();

    res.status(200).json({
      success: true,
      count: locations.length,
      data: locations
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

// @desc    Get single location
// @route   GET /api/v1/locations/:id
// @access  Private (Admin/HR)
exports.getLocation = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    res.status(200).json({
      success: true,
      data: location
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

// @desc    Create new location
// @route   POST /api/v1/locations
// @access  Private (Admin/HR)
exports.createLocation = async (req, res, next) => {
  try {
    const { name, address, location, radius } = req.body;

    // Create location
    const newLocation = await Location.create({
      name,
      address,
      location,
      radius
    });

    // Generate QR code for the location
    const { qrCode } = await generateLocationQRCode(newLocation._id);
    newLocation.qrCode = qrCode;
    await newLocation.save();

    res.status(201).json({
      success: true,
      data: newLocation
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

// @desc    Update location
// @route   PUT /api/v1/locations/:id
// @access  Private (Admin/HR)
exports.updateLocation = async (req, res, next) => {
  try {
    const location = await Location.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    // Regenerate QR code if location changed
    if (req.body.location || req.body.radius) {
      const { qrCode } = await generateLocationQRCode(location._id);
      location.qrCode = qrCode;
      await location.save();
    }

    res.status(200).json({
      success: true,
      data: location
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

// @desc    Delete location
// @route   DELETE /api/v1/locations/:id
// @access  Private (Admin/HR)
exports.deleteLocation = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    await Location.deleteOne({ _id: location._id });

    res.status(200).json({ success: true, data: {} });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Get company geofence settings
// @route   GET /api/v1/locations/geofence
// @access  Private
exports.getGeofence = async (req, res) => {
  try {
    const setting = await CompanySetting.findOne({ company: req.user.company });
    if (!setting || !setting.geofence?.latitude) {
      return res.status(200).json({ success: true, geofence: null });
    }
    res.status(200).json({ success: true, geofence: setting.geofence });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Save company geofence settings
// @route   POST /api/v1/locations/geofence
// @access  Private (Admin/HR)
exports.setGeofence = async (req, res) => {
  try {
    const { latitude, longitude, radius, address } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
    }
    if (radius < 30 || radius > 200) {
      return res.status(400).json({ success: false, message: 'Radius must be between 30 and 200 meters' });
    }

    const setting = await CompanySetting.findOneAndUpdate(
      { company: req.user.company },
      {
        company: req.user.company,
        geofence: { latitude, longitude, radius, address: address || '' },
        updatedBy: req.user.id,
        updatedAt: new Date()
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json({ success: true, geofence: setting.geofence });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get QR code for location
// @route   GET /api/v1/locations/:id/qrcode
// @access  Private (Admin/HR)
exports.getLocationQRCode = async (req, res, next) => {
  try {
    const location = await Location.findById(req.params.id);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    // Generate new QR code
    const { qrCode } = await generateLocationQRCode(location._id);

    res.status(200).json({
      success: true,
      data: {
        qrCode,
        location: location.name
      }
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
};

// @desc    Get company attendance QR code (auto-creates token if missing)
// @route   GET /api/v1/locations/company-qr
// @access  Private (Admin/HR)
exports.getCompanyQR = async (req, res) => {
  try {
    let setting = await CompanySetting.findOne({ company: req.user.company });

    if (!setting) {
      setting = new CompanySetting({ company: req.user.company, updatedBy: req.user.id, updatedAt: new Date() });
    }

    if (!setting.qrToken) {
      setting.qrToken = crypto.randomBytes(32).toString('hex');
      setting.qrTokenGeneratedAt = new Date();
      await setting.save();
    }

    const qrCode = await buildQRDataURL(setting);

    res.status(200).json({
      success: true,
      qrCode,
      company: setting.company,
      generatedAt: setting.qrTokenGeneratedAt
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Regenerate company attendance QR code (invalidates old one)
// @route   POST /api/v1/locations/company-qr/regenerate
// @access  Private (Admin/HR)
exports.regenerateCompanyQR = async (req, res) => {
  try {
    const newToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const graceExpiry = new Date(now.getTime() + 10 * 60 * 1000); // 10-min grace period

    // Fetch the existing setting so we can preserve the current token as "previous"
    const existing = await CompanySetting.findOne({ company: req.user.company });

    const setting = await CompanySetting.findOneAndUpdate(
      { company: req.user.company },
      {
        company: req.user.company,
        qrToken: newToken,
        qrTokenGeneratedAt: now,
        // Old token stays valid for 10 minutes so employees mid-scan aren't disrupted
        qrTokenPrevious: existing?.qrToken || '',
        qrTokenPreviousExpiry: graceExpiry,
        updatedBy: req.user.id,
        updatedAt: now
      },
      { upsert: true, new: true }
    );

    const qrCode = await buildQRDataURL(setting);

    res.status(200).json({
      success: true,
      qrCode,
      company: setting.company,
      generatedAt: setting.qrTokenGeneratedAt
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};