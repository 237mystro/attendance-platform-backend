const express = require('express');
const {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  submitAttendance,
  getEventAttendees,
  getPublicEvent
} = require('../controllers/eventController');

const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Public routes for scanned event links
router.get('/public/:companySlug/:eventToken', getPublicEvent);
router.post('/:companySlug/:eventToken/attend', submitAttendance);

// All other routes require authentication
router.use(protect);

// Admin/Branch only routes
router
  .route('/')
  .get(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getEvents)
  .post(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), createEvent);

router
  .route('/:id')
  .get(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getEvent)
  .put(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), updateEvent)
  .delete(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), deleteEvent);

router
  .route('/:id/attendees')
  .get(authorize('admin', 'hr', 'branch_manager', 'branch_hr'), getEventAttendees);

module.exports = router;
