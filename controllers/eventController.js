const Event = require('../models/Event');
const qrcode = require('qrcode');

const slugifyCompany = (company = '') =>
  String(company)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'company';

const normalizeFieldName = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeRequiredFields = (fields = []) => {
  const seen = new Set();
  return fields
    .map(field => {
      const name = normalizeFieldName(field.name || field.label);
      if (!name || seen.has(name)) return null;
      seen.add(name);

      return {
        name,
        label: field.label || name.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
        type: ['text', 'email', 'number', 'date', 'select'].includes(field.type) ? field.type : 'text',
        options: Array.isArray(field.options)
          ? field.options.map(option => String(option).trim()).filter(Boolean)
          : [],
        required: field.required !== false
      };
    })
    .filter(Boolean);
};

const getEventPublicPayload = (event) => ({
  _id: event._id,
  title: event.title,
  description: event.description,
  date: event.date,
  location: {
    latitude:  event.location?.latitude,
    longitude: event.location?.longitude,
    radius:    event.location?.radius,
    address:   event.location?.address
  },
  requiredFields: event.requiredFields,
  status: event.status
});

// @desc    Get all events for a company
// @route   GET /api/v1/events
// @access  Private (Admin/Branch)
exports.getEvents = async (req, res) => {
  try {
    const events = await Event.find({ company: req.user.company })
      .populate('createdBy', 'name')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      count: events.length,
      data: events
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get single event
// @route   GET /api/v1/events/:id
// @access  Private (Admin/Branch)
exports.getEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('createdBy', 'name');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user belongs to the same company
    if (event.company.toString() !== req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this event'
      });
    }

    res.status(200).json({
      success: true,
      data: event
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get public event form settings
// @route   GET /api/v1/events/public/:companySlug/:eventToken
// @access  Public
exports.getPublicEvent = async (req, res) => {
  try {
    const { companySlug, eventToken } = req.params;
    const event = await Event.findOne({ companySlug, eventToken });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.status(200).json({
      success: true,
      data: getEventPublicPayload(event)
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Create new event
// @route   POST /api/v1/events
// @access  Private (Admin/Branch)
exports.createEvent = async (req, res) => {
  try {
    const { title, description, date, location, requiredFields } = req.body;

    // Generate unique link using dynamic import for ESM-only uuid package
    const { v4: uuidv4 } = await import('uuid');
    const eventToken = uuidv4();
    const companySlug = slugifyCompany(req.user.company);
    const frontendUrl = (process.env.FRONTEND_URL || 'https://autopay-mu.vercel.app').replace(/\/$/, '');
    const link = `${frontendUrl}/event/${companySlug}/${eventToken}`;

    // Generate a direct URL QR code so Google Lens and phone cameras open the form.
    const qrCode = await qrcode.toDataURL(link);

    const event = await Event.create({
      company: req.user.company,
      companySlug,
      eventToken,
      title,
      description,
      date,
      location,
      qrCode,
      link,
      requiredFields: normalizeRequiredFields(requiredFields),
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      data: event
    });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update event
// @route   PUT /api/v1/events/:id
// @access  Private (Admin/Branch)
exports.updateEvent = async (req, res) => {
  try {
    let event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user belongs to the same company
    if (event.company.toString() !== req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this event'
      });
    }

    const updates = { ...req.body };
    if (updates.requiredFields) {
      updates.requiredFields = normalizeRequiredFields(updates.requiredFields);
    }

    event = await Event.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: event
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete event
// @route   DELETE /api/v1/events/:id
// @access  Private (Admin/Branch)
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user belongs to the same company
    if (event.company.toString() !== req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this event'
      });
    }

    await Event.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Submit event attendance
// @route   POST /api/v1/events/:companySlug/:eventToken/attend
// @access  Public
exports.submitAttendance = async (req, res) => {
  try {
    const { companySlug, eventToken } = req.params;
    const { name, email, phone, age, customFields, userLocation } = req.body;

    const event = await Event.findOne({ companySlug, eventToken });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Event is not active'
      });
    }

    // Check if within geofence
    if (userLocation && event.location) {
      const distance = calculateDistance(
        { latitude: userLocation.latitude, longitude: userLocation.longitude },
        { latitude: event.location.latitude, longitude: event.location.longitude }
      );

      if (distance > event.location.radius) {
        return res.status(400).json({
          success: false,
          message: `You are ${formatDistance(distance)} away. You must be within ${event.location.radius}m to attend.`
        });
      }
    }

    // Validate required fields
    const normalizedCustomFields = { ...(customFields || {}) };
    for (const field of event.requiredFields) {
      if (!['name', 'email', 'phone', 'age'].includes(field.name) && Object.prototype.hasOwnProperty.call(req.body, field.name)) {
        normalizedCustomFields[field.name] = req.body[field.name];
      }
    }

    const attendeeData = { name, email, phone, age, customFields: normalizedCustomFields, submittedAt: new Date() };
    if (userLocation) {
      attendeeData.location = userLocation;
    }

    for (const field of event.requiredFields) {
      if (field.required) {
        const value = field.name === 'name' ? name :
                     field.name === 'email' ? email :
                     field.name === 'phone' ? phone :
                     field.name === 'age' ? age :
                     normalizedCustomFields?.[field.name];

        if (!value) {
          return res.status(400).json({
            success: false,
            message: `${field.name} is required`
          });
        }
      }
    }

    event.attendees.push(attendeeData);
    await event.save();

    res.status(200).json({
      success: true,
      message: 'Attendance submitted successfully'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get event attendees
// @route   GET /api/v1/events/:id/attendees
// @access  Private (Admin/Branch)
exports.getEventAttendees = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if user belongs to the same company
    if (event.company.toString() !== req.user.company) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this event'
      });
    }

    res.status(200).json({
      success: true,
      count: event.attendees.length,
      data: event.attendees
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Helper functions
const calculateDistance = (point1, point2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = point1.latitude * Math.PI / 180;
  const φ2 = point2.latitude * Math.PI / 180;
  const Δφ = (point2.latitude - point1.latitude) * Math.PI / 180;
  const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};

const formatDistance = (distance) => {
  if (distance < 1000) {
    return `${Math.round(distance)}m`;
  } else {
    return `${(distance / 1000).toFixed(1)}km`;
  }
};
