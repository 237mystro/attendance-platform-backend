const express = require('express');
const {
  getMyPayrollHistory,
  getPayrolls,
  getPayroll,
  createPayroll,
  processPayroll
} = require('../controllers/payrollController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/my-history')
  .get(protect, getMyPayrollHistory);

router.route('/')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getPayrolls)
  .post(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), createPayroll);

router.route('/:id')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getPayroll);

router.route('/:id/process')
  .put(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), processPayroll);

module.exports = router;