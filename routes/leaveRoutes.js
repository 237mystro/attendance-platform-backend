const express = require('express');
const {
  getMyLeaveRequests,
  submitLeaveRequest,
  getAllLeaveRequests,
  updateLeaveStatus
} = require('../controllers/leaveController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/my-requests', protect, authorize('employee'), getMyLeaveRequests);
router.post('/request', protect, authorize('employee'), submitLeaveRequest);
router.get('/all', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getAllLeaveRequests);
router.patch('/:id/:action', protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), updateLeaveStatus);

module.exports = router;
