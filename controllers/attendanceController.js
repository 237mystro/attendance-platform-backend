const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const User = require('../models/User');
const CompanySetting = require('../models/CompanySetting');
const Branch = require('../models/Branch');
const LateRecord = require('../models/LateRecord');
const cloudinary = require('cloudinary').v2;
const { calculateDistance, formatDistance } = require('../utils/locationVerification');
const { isBranchRole } = require('../middleware/auth');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Infer the biometric type from the user-agent string.
// iOS devices use Face ID (priority) or Touch ID; everything else uses fingerprint.
const getBiometricType = (userAgent = '') => {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) return 'faceId';
  return 'fingerprint';
};

// Mutates employee.trustedDevices in memory; caller must save.
// Returns { isKnownDevice, deviceFlagged }.
const trackDevice = (employee, fingerprint, ipAddress, userAgent) => {
  if (!fingerprint) return { isKnownDevice: true, deviceFlagged: false };

  const existing = employee.trustedDevices.find(d => d.fingerprint === fingerprint);
  if (existing) {
    existing.lastSeen = new Date();
    existing.ipAddress = ipAddress;
    return { isKnownDevice: true, deviceFlagged: false };
  }

  const isFirstEver = employee.trustedDevices.length === 0;
  employee.trustedDevices.push({ fingerprint, userAgent, ipAddress });
  // Flag only when the employee already has known devices (not the very first login)
  return { isKnownDevice: false, deviceFlagged: !isFirstEver };
};

// Shared late-deduction helper (used by both checkIn and biometricCheckIn)
const recordLateness = async (employee, shift, now, deadlineMs, bufferMinutes, company) => {
  if (employee.salary > 0) {
    const lateMinutes = Math.ceil((now.getTime() - deadlineMs) / 60000);
    const hourlyRate  = employee.salary / 176;
    const deduction   = Math.round((lateMinutes / 60) * hourlyRate * 100) / 100;

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    await LateRecord.create({
      employeeId:      employee._id,
      shiftId:         shift._id,
      company,
      date:            today,
      month:           now.getMonth() + 1,
      year:            now.getFullYear(),
      scheduledStart:  shift.startTime,
      actualCheckIn:   now,
      lateMinutes,
      bufferMinutes,
      hourlyRate,
      deductionAmount: deduction
    });
  }
};

// ===============================
// @desc    Process employee check-in with QR code + location
// @route   POST /api/v1/attendance/checkin
// @access  Private (Employee)
// ===============================
exports.checkIn = async (req, res) => {
  try {
    const { qrData, userLocation, selfieBase64, deviceFingerprint } = req.body;

    if (!qrData || !userLocation) {
      return res.status(400).json({ success: false, message: 'Please provide QR code data and location' });
    }

    let parsedQRData;
    try { parsedQRData = JSON.parse(qrData); } catch {
      return res.status(400).json({ success: false, message: 'Invalid QR code format' });
    }

    let geofence, tokenValid;
    const companySetting = await CompanySetting.findOne({ company: req.user.company });

    if (parsedQRData.branchId) {
      const branch = await Branch.findOne({ _id: parsedQRData.branchId, company: req.user.company });
      if (!branch) {
        return res.status(403).json({ success: false, message: 'Invalid branch QR code.' });
      }
      geofence = branch.geofence;
      tokenValid =
        (branch.qrToken && parsedQRData.token === branch.qrToken) ||
        (branch.qrTokenPrevious && parsedQRData.token === branch.qrTokenPrevious &&
          branch.qrTokenPreviousExpiry && new Date() < branch.qrTokenPreviousExpiry);
    } else {
      if (!companySetting?.geofence?.latitude) {
        return res.status(400).json({ success: false, message: 'Geofence not configured. Please ask your administrator.' });
      }
      geofence = companySetting.geofence;
      tokenValid =
        (companySetting.qrToken && parsedQRData.token === companySetting.qrToken) ||
        (companySetting.qrTokenPrevious &&
          parsedQRData.token === companySetting.qrTokenPrevious &&
          companySetting.qrTokenPreviousExpiry &&
          new Date() < companySetting.qrTokenPreviousExpiry);
    }

    if (!geofence?.latitude) {
      return res.status(400).json({ success: false, message: 'Geofence not configured for this location. Ask your manager to set it up.' });
    }

    const distance = calculateDistance(
      { latitude: userLocation.latitude, longitude: userLocation.longitude },
      { latitude: geofence.latitude, longitude: geofence.longitude }
    );
    if (distance > geofence.radius) {
      return res.status(400).json({
        success: false,
        message: `You are ${formatDistance(distance)} away. You must be within ${geofence.radius}m to check in/out.`
      });
    }

    const ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const userAgent = req.headers['user-agent'] || '';

    let selfieUrl = '';
    if (selfieBase64 && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const result = await cloudinary.uploader.upload(selfieBase64, {
          folder: 'autopay_selfies',
          resource_type: 'image',
          timeout: 30000
        });
        selfieUrl = result.secure_url;
      } catch (err) {
        console.error('Selfie upload error (non-fatal):', err.message);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let shift;

    if (parsedQRData.type === 'company_checkin') {
      if (!parsedQRData.company || parsedQRData.company !== req.user.company) {
        return res.status(403).json({ success: false, message: 'This QR code belongs to a different company. Access denied.' });
      }
      if (!tokenValid) {
        return res.status(400).json({ success: false, message: 'QR code is no longer valid. Please ask your manager for the latest QR code.' });
      }

      const employee = await Employee.findOne({ userId: req.user.id });
      if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

      shift = await Shift.findOne({
        employeeId: employee._id,
        date: { $gte: today, $lt: tomorrow }
      }).populate('employeeId');

      if (!shift) {
        return res.status(404).json({ success: false, message: 'No shift scheduled for you today. Contact your administrator.' });
      }
    } else {
      if (!parsedQRData.shiftId || !parsedQRData.token) {
        return res.status(400).json({ success: false, message: 'Invalid QR code data' });
      }
      shift = await Shift.findById(parsedQRData.shiftId).populate('employeeId');
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
      if (parsedQRData.token !== shift.qrToken) {
        return res.status(400).json({ success: false, message: 'Invalid QR code token' });
      }
      const employeeUser = await User.findById(shift.employeeId.userId);
      if (!employeeUser || employeeUser.company !== req.user.company) {
        return res.status(403).json({ success: false, message: 'This QR code belongs to a different company. Access denied.' });
      }
      if (shift.employeeId.userId.toString() !== req.user.id.toString()) {
        return res.status(403).json({ success: false, message: 'This shift is not assigned to you' });
      }
    }

    let attendance = await Attendance.findOne({
      employeeId: shift.employeeId._id,
      date: { $gte: today, $lt: tomorrow }
    });

    const now = new Date();
    const geoPoint = { type: 'Point', coordinates: [userLocation.longitude, userLocation.latitude] };

    if (attendance?.checkInTime && !attendance.checkOutTime) {
      attendance.checkOutTime = now;
      attendance.checkOutLocation = geoPoint;
      attendance.checkOutSelfieUrl = selfieUrl;
      attendance.updatedAt = Date.now();
      await attendance.save();
      shift.status = 'completed';
      await shift.save();
      return res.status(200).json({ success: true, message: 'Check-out successful', action: 'checkout', data: { attendance, shift } });
    }

    const winDate  = shift.date.toISOString().split('T')[0];
    const winStart = new Date(`${winDate}T${shift.startTime}`);
    const winEnd   = new Date(`${winDate}T${shift.endTime}`);
    const openFrom = new Date(winStart.getTime() - 30 * 60 * 1000);

    if (shift.assignmentStatus === 'declined') {
      return res.status(400).json({ success: false, message: 'You have declined this shift. Check-in is not allowed.' });
    }
    if (now < openFrom) {
      return res.status(400).json({ success: false, message: `Check-in is not yet open. It becomes available 30 minutes before your shift starts at ${shift.startTime}.` });
    }
    if (now > winEnd) {
      return res.status(400).json({ success: false, message: `Your shift ended at ${shift.endTime}. The check-in window is now closed — you have been marked absent.` });
    }

    // ── Device tracking ──
    const empRecord = await Employee.findById(shift.employeeId._id);
    const { isKnownDevice, deviceFlagged } = trackDevice(empRecord, deviceFingerprint, ipAddress, userAgent);

    const dateStr    = shift.date.toISOString().split('T')[0];
    const shiftStart = new Date(`${dateStr}T${shift.startTime}`);
    const bufferMinutes = parsedQRData.branchId
      ? ((await Branch.findById(parsedQRData.branchId))?.bufferMinutes ?? 0)
      : (companySetting?.bufferMinutes ?? 0);
    const deadlineMs = shiftStart.getTime() + bufferMinutes * 60 * 1000;
    const isLate     = now.getTime() > deadlineMs;
    const status     = isLate ? 'late' : 'present';

    const attendanceFields = {
      checkInTime: now,
      status,
      location: geoPoint,
      selfieUrl,
      ipAddress,
      userAgent,
      attendanceMethod: 'qr',
      qrData,
      deviceFingerprint,
      isKnownDevice,
      deviceFlagged,
      updatedAt: Date.now()
    };

    if (attendance) {
      Object.assign(attendance, attendanceFields);
      await attendance.save();
    } else {
      attendance = await Attendance.create({
        employeeId: shift.employeeId._id,
        shiftId: shift._id,
        date: today,
        ...attendanceFields
      });
    }

    // Save device tracking changes
    await empRecord.save();

    shift.checkInTime = now;
    shift.status = 'in-progress';
    shift.checkInLocation = geoPoint;
    await shift.save();

    // Emit socket notification for flagged device
    if (deviceFlagged && req.app.get('io')) {
      req.app.get('io').to(`company_${req.user.company}`).emit('attendance:device_flagged', {
        employeeName: empRecord.name,
        employeeId: empRecord._id,
        attendanceId: attendance._id,
        ipAddress,
        userAgent,
        timestamp: now
      });
    }

    if (isLate) {
      try { await recordLateness(empRecord, shift, now, deadlineMs, bufferMinutes, req.user.company); }
      catch (e) { console.error('Late record (non-fatal):', e.message); }
    }

    res.status(200).json({
      success: true,
      message: isLate ? `Check-in recorded. You were ${Math.ceil((now - deadlineMs) / 60000)} minute(s) late.` : 'Check-in successful',
      action: 'checkin',
      late: isLate,
      data: { attendance, shift }
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ success: false, message: 'Server error during check-in' });
  }
};

// ===============================
// @desc    Check biometric registration status
// @route   GET /api/v1/attendance/biometric/status
// @access  Private (Employee)
// ===============================
exports.getBiometricStatus = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    res.json({
      success: true,
      registered: employee.biometricCredentials.length > 0,
      credentialCount: employee.biometricCredentials.length
    });
  } catch (err) {
    console.error('Biometric status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ===============================
// @desc    Start WebAuthn biometric registration
// @route   POST /api/v1/attendance/biometric/register-start
// @access  Private (Employee)
// ===============================
exports.biometricRegisterStart = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';

    const options = generateRegistrationOptions({
      rpName: req.user.company || 'AutoPayroll',
      rpID,
      userID: employee._id.toString(),
      userName: employee.email,
      userDisplayName: employee.name,
      attestationType: 'none',
      // Platform authenticator = built-in device biometric (Face ID / fingerprint)
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      excludeCredentials: employee.biometricCredentials.map(c => ({
        id: Buffer.from(c.credentialId, 'base64url'),
        type: 'public-key',
        transports: c.transports
      }))
    });

    employee.currentBiometricChallenge = options.challenge;
    employee.currentBiometricChallengeExpiry = new Date(Date.now() + 5 * 60 * 1000);
    await employee.save();

    res.json({ success: true, options });
  } catch (err) {
    console.error('Biometric register start error:', err);
    res.status(500).json({ success: false, message: 'Server error starting registration' });
  }
};

// ===============================
// @desc    Complete WebAuthn biometric registration
// @route   POST /api/v1/attendance/biometric/register-finish
// @access  Private (Employee)
// ===============================
exports.biometricRegisterFinish = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    if (!employee.currentBiometricChallenge ||
        (employee.currentBiometricChallengeExpiry && new Date() > employee.currentBiometricChallengeExpiry)) {
      return res.status(400).json({ success: false, message: 'Registration challenge expired. Please try again.' });
    }

    const expectedOrigin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
    const expectedRPID   = process.env.WEBAUTHN_RP_ID  || 'localhost';

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: employee.currentBiometricChallenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: `Registration verification failed: ${err.message}` });
    }

    if (!verification.verified) {
      return res.status(400).json({ success: false, message: 'Biometric registration could not be verified' });
    }

    const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;

    employee.biometricCredentials.push({
      credentialId: Buffer.from(credentialID).toString('base64url'),
      publicKey:    Buffer.from(credentialPublicKey).toString('base64url'),
      counter,
      transports: req.body.response?.transports || []
    });
    employee.currentBiometricChallenge       = undefined;
    employee.currentBiometricChallengeExpiry = undefined;
    await employee.save();

    res.json({ success: true, message: 'Biometric registered. You can now use Face ID or fingerprint to check in.' });
  } catch (err) {
    console.error('Biometric register finish error:', err);
    res.status(500).json({ success: false, message: 'Server error completing registration' });
  }
};

// ===============================
// @desc    Start WebAuthn authentication (returns challenge for check-in)
// @route   POST /api/v1/attendance/biometric/auth-start
// @access  Private (Employee)
// ===============================
exports.biometricAuthStart = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    if (!employee.biometricCredentials || employee.biometricCredentials.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No biometrics registered. Please register first.',
        needsRegistration: true
      });
    }

    const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';

    const options = generateAuthenticationOptions({
      timeout: 60000,
      allowCredentials: employee.biometricCredentials.map(c => ({
        id: Buffer.from(c.credentialId, 'base64url'),
        type: 'public-key',
        transports: c.transports
      })),
      userVerification: 'required',
      rpID
    });

    employee.currentBiometricChallenge       = options.challenge;
    employee.currentBiometricChallengeExpiry = new Date(Date.now() + 5 * 60 * 1000);
    await employee.save();

    res.json({ success: true, options });
  } catch (err) {
    console.error('Biometric auth start error:', err);
    res.status(500).json({ success: false, message: 'Server error starting authentication' });
  }
};

// ===============================
// @desc    Complete biometric check-in (verify assertion + mark attendance)
// @route   POST /api/v1/attendance/biometric/checkin
// @access  Private (Employee)
// ===============================
exports.biometricCheckIn = async (req, res) => {
  try {
    const { assertion, userLocation, deviceFingerprint } = req.body;

    if (!assertion || !userLocation) {
      return res.status(400).json({ success: false, message: 'Missing biometric assertion or location' });
    }

    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    if (!employee.currentBiometricChallenge ||
        (employee.currentBiometricChallengeExpiry && new Date() > employee.currentBiometricChallengeExpiry)) {
      return res.status(400).json({ success: false, message: 'Authentication challenge expired. Please try again.' });
    }

    // Find the credential used
    const storedCredential = employee.biometricCredentials.find(c => c.credentialId === assertion.id);
    if (!storedCredential) {
      return res.status(400).json({ success: false, message: 'Unrecognised credential. Please re-register your biometric.' });
    }

    const expectedOrigin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';
    const expectedRPID   = process.env.WEBAUTHN_RP_ID  || 'localhost';

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: employee.currentBiometricChallenge,
        expectedOrigin,
        expectedRPID,
        authenticator: {
          credentialID:        Buffer.from(storedCredential.credentialId, 'base64url'),
          credentialPublicKey: Buffer.from(storedCredential.publicKey,    'base64url'),
          counter:             storedCredential.counter,
          transports:          storedCredential.transports
        },
        requireUserVerification: true
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: `Biometric authentication failed: ${err.message}` });
    }

    if (!verification.verified) {
      return res.status(400).json({ success: false, message: 'Biometric authentication failed' });
    }

    // Update counter (anti-replay) and clear challenge
    storedCredential.counter                     = verification.authenticationInfo.newCounter;
    employee.currentBiometricChallenge           = undefined;
    employee.currentBiometricChallengeExpiry     = undefined;

    // ── Geofence check ──
    const companySetting = await CompanySetting.findOne({ company: req.user.company });
    let geofence;

    if (employee.branchId) {
      const branch = await Branch.findById(employee.branchId);
      if (branch?.geofence?.latitude) geofence = branch.geofence;
    }
    if (!geofence) {
      if (!companySetting?.geofence?.latitude) {
        return res.status(400).json({ success: false, message: 'Geofence not configured. Please contact your administrator.' });
      }
      geofence = companySetting.geofence;
    }

    const distance = calculateDistance(
      { latitude: userLocation.latitude, longitude: userLocation.longitude },
      { latitude: geofence.latitude, longitude: geofence.longitude }
    );
    if (distance > geofence.radius) {
      return res.status(400).json({
        success: false,
        message: `You are ${formatDistance(distance)} away. You must be within ${geofence.radius}m to check in/out.`
      });
    }

    // ── Device tracking ──
    const ipAddress     = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const userAgent     = req.headers['user-agent'] || '';
    const biometricType = getBiometricType(userAgent);
    const { isKnownDevice, deviceFlagged } = trackDevice(employee, deviceFingerprint, ipAddress, userAgent);

    // ── Shift lookup ──
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const shift = await Shift.findOne({
      employeeId: employee._id,
      date: { $gte: today, $lt: tomorrow }
    }).populate('employeeId');

    if (!shift) {
      return res.status(404).json({ success: false, message: 'No shift scheduled for you today. Contact your administrator.' });
    }

    const winDate  = shift.date.toISOString().split('T')[0];
    const winStart = new Date(`${winDate}T${shift.startTime}`);
    const winEnd   = new Date(`${winDate}T${shift.endTime}`);
    const openFrom = new Date(winStart.getTime() - 30 * 60 * 1000);
    const now      = new Date();

    if (shift.assignmentStatus === 'declined') {
      return res.status(400).json({ success: false, message: 'You have declined this shift. Check-in is not allowed.' });
    }
    if (now < openFrom) {
      return res.status(400).json({ success: false, message: `Check-in opens 30 minutes before your shift starts at ${shift.startTime}.` });
    }
    if (now > winEnd) {
      return res.status(400).json({ success: false, message: `Your shift ended at ${shift.endTime}. The check-in window is closed.` });
    }

    const geoPoint = { type: 'Point', coordinates: [userLocation.longitude, userLocation.latitude] };

    let attendance = await Attendance.findOne({
      employeeId: employee._id,
      date: { $gte: today, $lt: tomorrow }
    });

    // ── Check-out path ──
    if (attendance?.checkInTime && !attendance.checkOutTime) {
      attendance.checkOutTime     = now;
      attendance.checkOutLocation = geoPoint;
      attendance.updatedAt        = Date.now();
      await attendance.save();
      shift.status = 'completed';
      await shift.save();
      await employee.save(); // persist device tracking
      return res.status(200).json({ success: true, message: 'Check-out successful', action: 'checkout', data: { attendance, shift } });
    }

    // ── Check-in path ──
    const dateStr       = shift.date.toISOString().split('T')[0];
    const shiftStart    = new Date(`${dateStr}T${shift.startTime}`);
    const bufferMinutes = companySetting?.bufferMinutes ?? 0;
    const deadlineMs    = shiftStart.getTime() + bufferMinutes * 60 * 1000;
    const isLate        = now.getTime() > deadlineMs;
    const status        = isLate ? 'late' : 'present';

    const attendanceFields = {
      checkInTime: now,
      status,
      location: geoPoint,
      ipAddress,
      userAgent,
      attendanceMethod: 'biometric',
      biometricType,
      deviceFingerprint,
      isKnownDevice,
      deviceFlagged,
      updatedAt: Date.now()
    };

    if (attendance) {
      Object.assign(attendance, attendanceFields);
      await attendance.save();
    } else {
      attendance = await Attendance.create({
        employeeId: employee._id,
        shiftId:    shift._id,
        date:       today,
        ...attendanceFields
      });
    }

    shift.checkInTime    = now;
    shift.status         = 'in-progress';
    shift.checkInLocation = geoPoint;
    await shift.save();

    // Persist credential counter + device tracking
    await employee.save();

    // ── Notify admins about unknown device via socket ──
    if (deviceFlagged && req.app.get('io')) {
      req.app.get('io').to(`company_${req.user.company}`).emit('attendance:device_flagged', {
        employeeName: employee.name,
        employeeId:   employee._id,
        attendanceId: attendance._id,
        ipAddress,
        userAgent,
        timestamp:    now
      });
    }

    if (isLate) {
      try { await recordLateness(employee, shift, now, deadlineMs, bufferMinutes, req.user.company); }
      catch (e) { console.error('Late record (non-fatal):', e.message); }
    }

    res.status(200).json({
      success: true,
      message: isLate
        ? `Check-in recorded. You were ${Math.ceil((now - deadlineMs) / 60000)} minute(s) late.`
        : 'Biometric check-in successful',
      action: 'checkin',
      late: isLate,
      deviceFlagged,
      data: { attendance, shift }
    });
  } catch (err) {
    console.error('Biometric check-in error:', err);
    res.status(500).json({ success: false, message: 'Server error during biometric check-in' });
  }
};

// ===============================
// @desc    Get employee's own attendance records
// @route   GET /api/v1/attendance
// @access  Private (Employee)
// ===============================
exports.getAttendance = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    const attendance = await Attendance.find({ employeeId: employee._id })
      .sort({ date: -1 })
      .limit(30);

    res.status(200).json({ success: true, count: attendance.length, data: attendance });
  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching attendance' });
  }
};

// ===============================
// @desc    Get geofence applicable to the current user (branch or company)
// @route   GET /api/v1/attendance/my-geofence
// @access  Private
// ===============================
exports.getMyGeofence = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    const branchId = employee?.branchId || req.user.branchId;

    if (branchId) {
      const branch = await Branch.findById(branchId);
      if (branch?.geofence?.latitude) {
        return res.status(200).json({
          success: true,
          source: 'branch',
          geofence: {
            latitude:  branch.geofence.latitude,
            longitude: branch.geofence.longitude,
            radius:    branch.geofence.radius || 100,
            address:   branch.geofence.address || ''
          }
        });
      }
    }

    const companySetting = await CompanySetting.findOne({ company: req.user.company });
    if (companySetting?.geofence?.latitude) {
      return res.status(200).json({
        success: true,
        source: 'company',
        geofence: {
          latitude:  companySetting.geofence.latitude,
          longitude: companySetting.geofence.longitude,
          radius:    companySetting.geofence.radius || 100,
          address:   companySetting.geofence.address || ''
        }
      });
    }

    res.status(404).json({ success: false, message: 'Geofence not configured. Please contact your administrator.' });
  } catch (err) {
    console.error('Get my geofence error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching geofence' });
  }
};

// ===============================
// @desc    Get attendance dashboard for admin
// @route   GET /api/v1/attendance/admin-dashboard
// @access  Private (Admin/HR)
// ===============================
exports.getAdminAttendanceDashboard = async (req, res) => {
  try {
    const empFilter = isBranchRole(req.user)
      ? { branchId: req.user.branchId }
      : { userId: { $in: await User.find({ company: req.user.company }).distinct('_id') } };

    const employees  = await Employee.find(empFilter);
    const employeeIds = employees.map(e => e._id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todaysAttendance = await Attendance.find({
      employeeId: { $in: employeeIds },
      date: { $gte: today, $lt: tomorrow }
    }).populate('employeeId', 'name position');

    const presentCount = todaysAttendance.filter(a => a.status === 'present').length;
    const lateCount    = todaysAttendance.filter(a => a.status === 'late').length;
    const absentCount  = employees.length - presentCount - lateCount;

    res.status(200).json({
      success: true,
      data: {
        totalEmployees: employees.length,
        present:    presentCount,
        late:       lateCount,
        absent:     absentCount,
        attendance: todaysAttendance
      }
    });
  } catch (err) {
    console.error('Admin attendance dashboard error:', err);
    res.status(500).json({ success: false, message: 'Server error while fetching attendance dashboard' });
  }
};

// ===============================
// @desc    Get flagged-device attendance records for admin review
// @route   GET /api/v1/attendance/flagged-devices
// @access  Private (Admin/HR)
// ===============================
exports.getFlaggedDeviceAttendance = async (req, res) => {
  try {
    const empFilter = isBranchRole(req.user)
      ? { branchId: req.user.branchId }
      : { userId: { $in: await User.find({ company: req.user.company }).distinct('_id') } };

    const employees  = await Employee.find(empFilter);
    const employeeIds = employees.map(e => e._id);

    const flagged = await Attendance.find({
      employeeId: { $in: employeeIds },
      deviceFlagged: true
    })
      .sort({ checkInTime: -1 })
      .limit(50)
      .populate('employeeId', 'name position');

    res.json({ success: true, count: flagged.length, data: flagged });
  } catch (err) {
    console.error('Get flagged device attendance error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
