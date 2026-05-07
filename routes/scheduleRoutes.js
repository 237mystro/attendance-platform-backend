const express = require('express');
const {
  getMyShifts,
  getShifts,
  getShift,
  createShift,
  bulkCreateShifts,
  updateShift,
  deleteShift,
  respondToShift,
  checkIn,
  checkOut
} = require('../controllers/scheduleController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/my-shifts')
  .get(protect, authorize('employee'), getMyShifts);

router.route('/')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getShifts)
  .post(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), createShift);

router.post('/bulk', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), bulkCreateShifts);

router.route('/:id')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getShift)
  .put(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), updateShift)
  .delete(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), deleteShift);

router.route('/:id/respond')
  .patch(protect, authorize('employee'), respondToShift);

router.route('/:id/checkin')
  .post(protect, checkIn);

router.route('/:id/checkout')
  .post(protect, checkOut);

module.exports = router;