const express = require('express');
const {
  getLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  getLocationQRCode,
  getGeofence,
  setGeofence,
  getCompanyQR,
  regenerateCompanyQR
} = require('../controllers/locationController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/geofence')
  .get(protect, getGeofence)
  .post(protect, authorize('admin', 'hr'), setGeofence);

router.route('/company-qr')
  .get(protect, authorize('admin', 'hr'), getCompanyQR);

router.post('/company-qr/regenerate', protect, authorize('admin', 'hr'), regenerateCompanyQR);

router.route('/')
  .get(protect, authorize('admin', 'hr'), getLocations)
  .post(protect, authorize('admin', 'hr'), createLocation);

router.route('/:id')
  .get(protect, authorize('admin', 'hr'), getLocation)
  .put(protect, authorize('admin', 'hr'), updateLocation)
  .delete(protect, authorize('admin', 'hr'), deleteLocation);

router.route('/:id/qrcode')
  .get(protect, authorize('admin', 'hr'), getLocationQRCode);

module.exports = router;