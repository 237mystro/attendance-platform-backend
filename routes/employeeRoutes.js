// backend/routes/employeeRoutes.js
const express = require('express');
const {
  getMyProfile,
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee
} = require('../controllers/employeeController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.route('/me')
  .get(protect, getMyProfile);

router.route('/')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getEmployees)
  .post(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), createEmployee);

router.route('/:id')
  .get(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getEmployee)
  .put(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), updateEmployee)
  .delete(protect, authorize('admin', 'hr', 'branch_manager', 'branch_hr'), deleteEmployee);

module.exports = router;