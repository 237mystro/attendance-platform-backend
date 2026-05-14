const Shift = require('../models/Shift');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const User = require('../models/User');
const { sendShiftReminder } = require('./emailService');

/**
 * Build a full Date for a shift's start or end time on its date.
 * shift.date is stored as a Date (midnight UTC); we reconstruct using
 * the stored time string so the comparison is correct regardless of TZ.
 */
const shiftDateTime = (shiftDate, timeStr) => {
  const base = new Date(shiftDate);
  const [h, m] = timeStr.split(':').map(Number);
  base.setUTCHours(h, m, 0, 0);
  return base;
};

const startShiftNotifier = (io) => {
  setInterval(async () => {
    try {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // ── 1. 30-minute shift reminders ─────────────────────────────────
      const upcomingShifts = await Shift.find({
        status: 'scheduled',
        assignmentStatus: 'accepted',
        date: { $gte: today, $lt: tomorrow }
      }).populate('employeeId');

      for (const shift of upcomingShifts) {
        const shiftStart = shiftDateTime(shift.date, shift.startTime);
        const minutesAway = (shiftStart - now) / (1000 * 60);

        if (!shift.notified30min && minutesAway >= 25 && minutesAway <= 35) {
          const user = await User.findById(shift.employeeId?.userId);
          if (user) {
            io.to(`user_${user._id}`).emit('shift:reminder', {
              shiftId: shift._id,
              minutesBefore: 30,
              date: shift.date,
              startTime: shift.startTime,
              endTime: shift.endTime,
              message: `Reminder: your shift starts in ~30 minutes at ${shift.startTime}`
            });
            await sendShiftReminder(user.email, user.name, shift);
          }
          shift.notified30min = true;
          await shift.save();
        }

        if (!shift.notified15min && minutesAway >= 10 && minutesAway <= 20) {
          const user = await User.findById(shift.employeeId?.userId);
          if (user) {
            io.to(`user_${user._id}`).emit('shift:reminder', {
              shiftId: shift._id,
              minutesBefore: 15,
              date: shift.date,
              startTime: shift.startTime,
              endTime: shift.endTime,
              message: `Reminder: your shift starts in ~15 minutes at ${shift.startTime}`
            });
          }
          shift.notified15min = true;
          await shift.save();
        }
      }

      // ── 2. Auto-complete / auto-absent overdue shifts ─────────────────
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const overdueShifts = await Shift.find({
        status: { $in: ['scheduled', 'in-progress'] },
        date: { $gte: sevenDaysAgo, $lte: now }
      });

      for (const shift of overdueShifts) {
        const shiftEnd = shiftDateTime(shift.date, shift.endTime);

        // Only act once the shift's end time has passed
        if (now <= shiftEnd) continue;

        if (shift.status === 'in-progress') {
          // Was checked in but never checked out → auto-complete
          shift.status = 'completed';
          shift.checkOutTime = shiftEnd;
          await shift.save();
          continue;
        }

        // status === 'scheduled' and shift has fully ended → absent
        shift.status = 'missed';
        await shift.save();

        // Create an explicit absent attendance record (only for accepted shifts;
        // skip if a record already exists for this employee on that day)
        if (shift.assignmentStatus === 'accepted') {
          const shiftDay     = new Date(shift.date);
          const shiftDayEnd  = new Date(shiftDay.getTime() + 24 * 60 * 60 * 1000);

          const existing = await Attendance.findOne({
            employeeId: shift.employeeId,
            date: { $gte: shiftDay, $lt: shiftDayEnd }
          });

          if (!existing) {
            await Attendance.create({
              employeeId: shift.employeeId,
              shiftId:    shift._id,
              date:       shiftDay,
              status:     'absent'
            });
          }
        }
      }

    } catch (err) {
      console.error('Shift notifier error:', err);
    }
  }, 60 * 1000); // check every minute
};

module.exports = { startShiftNotifier };
