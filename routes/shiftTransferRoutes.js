const express = require('express');
const {
  getEligibleEmployees,
  requestTransfer,
  respondToTransfer,
  getMyTransfers
} = require('../controllers/shiftTransferController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/eligible-employees', protect, authorize('employee'), getEligibleEmployees);
router.get('/my-transfers', protect, authorize('employee'), getMyTransfers);
router.post('/request', protect, authorize('employee'), requestTransfer);
router.patch('/:id/:action', protect, authorize('employee'), respondToTransfer);

module.exports = router;
