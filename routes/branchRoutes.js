const express = require('express');
const {
  getBranches, getBranch, createBranch, updateBranch, deleteBranch,
  assignRole,
  getBranchGeofence, setBranchGeofence,
  getBranchQR, regenerateBranchQR,
  getBranchSettings, updateBranchSettings,
  getBranchEmployees
} = require('../controllers/branchController');
const { protect, authorize } = require('../middleware/auth');

const ADMIN_ROLES   = ['admin', 'hr'];
const BRANCH_ROLES  = ['admin', 'hr', 'branch_manager', 'branch_hr'];

const router = express.Router();

// Company-level branch management (admin only)
router.route('/')
  .get(protect, authorize(...ADMIN_ROLES), getBranches)
  .post(protect, authorize('admin'), createBranch);

router.route('/:id')
  .get(protect, authorize(...BRANCH_ROLES), getBranch)
  .put(protect, authorize('admin'), updateBranch)
  .delete(protect, authorize('admin'), deleteBranch);

// Assign branch_manager / branch_hr
router.post('/:id/assign', protect, authorize('admin'), assignRole);

// Branch employees (admin view)
router.get('/:id/employees', protect, authorize(...ADMIN_ROLES), getBranchEmployees);

// Geofence  — ':id' can be a real ObjectId OR the literal string 'mine'
router.route('/:id/geofence')
  .get(protect, authorize(...BRANCH_ROLES, 'employee'), getBranchGeofence)
  .post(protect, authorize(...BRANCH_ROLES), setBranchGeofence);

// QR code
router.get('/:id/qr', protect, authorize(...BRANCH_ROLES), getBranchQR);
router.post('/:id/qr/regenerate', protect, authorize(...BRANCH_ROLES), regenerateBranchQR);

// Settings (buffer minutes)
router.route('/:id/settings')
  .get(protect, authorize(...BRANCH_ROLES), getBranchSettings)
  .put(protect, authorize(...BRANCH_ROLES), updateBranchSettings);

module.exports = router;
