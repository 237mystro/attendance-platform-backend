const express = require('express');
const {
  checkIn,
  getAttendance,
  getAdminAttendanceDashboard,
  getMyGeofence,
  getBiometricStatus,
  biometricRegisterStart,
  biometricRegisterFinish,
  biometricAuthStart,
  biometricCheckIn,
  getFlaggedDeviceAttendance
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// ── Employee routes ──────────────────────────────────────────────────────────
router.get('/my-geofence',  protect, getMyGeofence);
router.post('/checkin',     protect, authorize('employee'), checkIn);
router.get('/',             protect, authorize('employee'), getAttendance);

// Biometric registration + authentication
router.get('/biometric/status',          protect, authorize('employee'), getBiometricStatus);
router.post('/biometric/register-start', protect, authorize('employee'), biometricRegisterStart);
router.post('/biometric/register-finish',protect, authorize('employee'), biometricRegisterFinish);
router.post('/biometric/auth-start',     protect, authorize('employee'), biometricAuthStart);
router.post('/biometric/checkin',        protect, authorize('employee'), biometricCheckIn);

// ── Admin / HR routes ────────────────────────────────────────────────────────
router.get('/admin-dashboard', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getAdminAttendanceDashboard);
router.get('/flagged-devices', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getFlaggedDeviceAttendance);

module.exports = router;
