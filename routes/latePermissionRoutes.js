const express = require('express');
const router = express.Router();
const {
  submitRequest,
  getMyRequests,
  getCompanyRequests,
  getPendingCount,
  reviewRequest
} = require('../controllers/latePermissionController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.post('/',              authorize('employee'),                                           submitRequest);
router.get('/my',             authorize('employee'),                                           getMyRequests);
router.get('/admin',          authorize('admin', 'hr', 'branch_manager', 'branch_hr'),         getCompanyRequests);
router.get('/pending-count',  authorize('admin', 'hr', 'branch_manager', 'branch_hr'),         getPendingCount);
router.put('/:id/review',     authorize('admin', 'hr', 'branch_manager', 'branch_hr'),         reviewRequest);

module.exports = router;
