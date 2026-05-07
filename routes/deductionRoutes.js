const express = require('express');
const {
  getBuffer, setBuffer,
  getLateRecords, getMyLateRecords,
  generateReport, getReports, getReport,
  approveReport, payAndSend,
  getMyReports
} = require('../controllers/deductionController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

const MGMT_ROLES = ['admin', 'hr', 'branch_manager', 'branch_hr'];

// Buffer settings
router.route('/buffer')
  .get(protect, authorize(...MGMT_ROLES), getBuffer)
  .post(protect, authorize(...MGMT_ROLES), setBuffer);

// Late records
router.get('/records',     protect, authorize(...MGMT_ROLES), getLateRecords);
router.get('/my-records',  protect, authorize('employee'),    getMyLateRecords);
router.get('/my-reports',  protect, authorize('employee'),    getMyReports);

// Monthly reports
router.post('/reports/generate',         protect, authorize(...MGMT_ROLES), generateReport);
router.get('/reports',                   protect, authorize(...MGMT_ROLES), getReports);
router.get('/reports/:id',               protect, authorize(...MGMT_ROLES), getReport);
router.put('/reports/:id/approve',       protect, authorize(...MGMT_ROLES), approveReport);
router.post('/reports/:id/pay-and-send', protect, authorize(...MGMT_ROLES), payAndSend);

module.exports = router;
