// backend/utils/emailService.js
const nodemailer = require('nodemailer');

// Create transporter (configure with your email service)
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER, // Your emfail
      pass: process.env.EMAIL_PASS  // Your email password or app password
    }
  });
};

// Send employee credentials email
const sendEmployeeCredentials = async (employeeEmail, employeeName, tempPassword, companyName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: employeeEmail,
      subject: `Welcome to ${companyName} - AutoPayroll Account`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Welcome to AutoPayroll</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f7fa;">
            <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #1976d2; margin: 0;">AutoPayroll</h1>
                    <p style="color: #666; margin: 10px 0 0 0;">Automated Payroll Management</p>
                </div>
                
                <h2 style="color: #333;">Welcome, ${employeeName}!</h2>
                
                <p>Your account has been created by your administrator at <strong>${companyName}</strong>.</p>
                
                <div style="background-color: #e3f2fd; padding: 20px; border-radius: 5px; margin: 25px 0;">
                    <h3 style="margin-top: 0; color: #1976d2;">Your Login Credentials:</h3>
                    <p style="margin: 10px 0;"><strong>Email:</strong> ${employeeEmail}</p>
                    <p style="margin: 10px 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                
                <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 25px 0; border-left: 4px solid #ff9800;">
                    <p style="margin: 0;"><strong>⚠️ Important:</strong> Please change your password immediately after logging in for security.</p>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://autopay-mu.vercel.app'}/login"
                       style="background-color: #1976d2; color: white; padding: 15px 30px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;
                              font-weight: bold; font-size: 16px;">
                        Login to AutoPayroll
                    </a>
                </div>
                
                <p>If you have any questions, please contact your HR administrator.</p>
                <p>Best regards,<br/><strong>The AutoPayroll Team</strong></p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="font-size: 12px; color: #999; text-align: center;">
                    This is an automated message. Please do not reply to this email.
                </p>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Credentials email sent successfully to:', employeeEmail);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Error sending credentials email to:', employeeEmail, error);
    return { success: false, error: error.message };
  }
};

// Send password reset email (bonus feature)
const sendPasswordReset = async (email, resetToken) => {
  try {
    const transporter = createTransporter();
    
    const resetUrl = `${process.env.FRONTEND_URL || 'https://autopay-mu.vercel.app'}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'AutoPayroll - Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1976d2;">Password Reset Request</h2>
          <p>You have requested to reset your password. Click the button below to reset it:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #1976d2; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          
          <p>If you didn't request this, please ignore this email.</p>
          <p>This link will expire in 1 hour.</p>
          
          <p>Best regards,<br/>The AutoPayroll Team</p>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent: %s', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message };
  }
};

const sendPasswordResetOtp = async (email, name, otp) => {
  try {
    const transporter = createTransporter();

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'AutoPayroll Password Reset Code',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f5f7fa">
          <div style="background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 12px 30px rgba(15,23,42,0.08)">
            <h1 style="margin:0 0 8px;color:#0f172a;font-size:28px">Reset your password</h1>
            <p style="margin:0 0 20px;color:#475569;line-height:1.6">
              Hi ${name || 'there'}, use the one-time password below to reset your AutoPayroll password.
            </p>

            <div style="background:linear-gradient(135deg,#0f4c81,#246bce);border-radius:14px;padding:20px;text-align:center;margin:24px 0">
              <div style="color:rgba(255,255,255,0.72);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">
                One-Time Password
              </div>
              <div style="color:#ffffff;font-size:34px;font-weight:700;letter-spacing:8px">${otp}</div>
            </div>

            <p style="margin:0 0 12px;color:#334155;line-height:1.6">
              This code expires in <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
            </p>
            <p style="margin:0;color:#64748b;font-size:12px">
              For security, never share this code with anyone.
            </p>
          </div>
        </div>
      `
    });

    return { success: true };
  } catch (error) {
    console.error('Error sending password reset OTP:', error);
    return { success: false, error: error.message };
  }
};

const sendShiftReminder = async (email, name, shift) => {
  try {
    const transporter = createTransporter();
    const shiftDate = new Date(shift.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: 'AutoPayroll – Shift Reminder: 30 Minutes to Go',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2 style="color:#1976d2">Shift Reminder</h2>
          <p>Hi <strong>${name}</strong>,</p>
          <p>Your shift starts in approximately <strong>30 minutes</strong>.</p>
          <div style="background:#e3f2fd;padding:16px;border-radius:6px;margin:16px 0">
            <p style="margin:0"><strong>Date:</strong> ${shiftDate}</p>
            <p style="margin:6px 0 0"><strong>Time:</strong> ${shift.startTime} – ${shift.endTime}</p>
          </div>
          <p>Please ensure you are on time and have your QR code ready for check-in.</p>
          <p>Best regards,<br/><strong>AutoPayroll</strong></p>
        </div>`
    });
    return { success: true };
  } catch (err) {
    console.error('Shift reminder email error:', err);
    return { success: false };
  }
};

const sendShiftTransferRequest = async (toEmail, toName, fromName, shift, message) => {
  try {
    const transporter = createTransporter();
    const shiftDate = new Date(shift.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: toEmail,
      subject: `AutoPayroll – ${fromName} wants to transfer a shift to you`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2 style="color:#1976d2">Shift Transfer Request</h2>
          <p>Hi <strong>${toName}</strong>,</p>
          <p><strong>${fromName}</strong> has requested to transfer the following shift to you:</p>
          <div style="background:#e3f2fd;padding:16px;border-radius:6px;margin:16px 0">
            <p style="margin:0"><strong>Date:</strong> ${shiftDate}</p>
            <p style="margin:6px 0 0"><strong>Time:</strong> ${shift.startTime} – ${shift.endTime}</p>
            ${message ? `<p style="margin:6px 0 0"><strong>Message:</strong> ${message}</p>` : ''}
          </div>
          <p>Log in to AutoPayroll to accept or decline this request.</p>
          <p>Best regards,<br/><strong>AutoPayroll</strong></p>
        </div>`
    });
    return { success: true };
  } catch (err) {
    console.error('Transfer request email error:', err);
    return { success: false };
  }
};

const sendShiftTransferResult = async (toEmail, toName, responderName, shift, action) => {
  try {
    const transporter = createTransporter();
    const shiftDate = new Date(shift.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const accepted = action === 'accept';
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: toEmail,
      subject: `AutoPayroll – Your shift transfer was ${accepted ? 'accepted' : 'declined'}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2 style="color:${accepted ? '#388e3c' : '#d32f2f'}">Shift Transfer ${accepted ? 'Accepted' : 'Declined'}</h2>
          <p>Hi <strong>${toName}</strong>,</p>
          <p><strong>${responderName}</strong> has <strong>${accepted ? 'accepted' : 'declined'}</strong> your shift transfer request.</p>
          <div style="background:#f5f5f5;padding:16px;border-radius:6px;margin:16px 0">
            <p style="margin:0"><strong>Date:</strong> ${shiftDate}</p>
            <p style="margin:6px 0 0"><strong>Time:</strong> ${shift.startTime} – ${shift.endTime}</p>
          </div>
          ${accepted
            ? `<p>The shift has been transferred to ${responderName} and will count towards their payment.</p>`
            : `<p>The shift remains assigned to you. Please arrange alternative coverage if needed.</p>`
          }
          <p>Best regards,<br/><strong>AutoPayroll</strong></p>
        </div>`
    });
    return { success: true };
  } catch (err) {
    console.error('Transfer result email error:', err);
    return { success: false };
  }
};

const sendDeductionReport = async (employee, report) => {
  try {
    const transporter = createTransporter();
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '--';

    const rows = (employee.records || []).map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${fmtDate(r.date)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${r.scheduledStart}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${fmtTime(r.actualCheckIn)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${r.lateMinutes} min</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#d32f2f">-${fmt(r.deductionAmount)}</td>
      </tr>`).join('');

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: employee.email,
      subject: `AutoPayroll – ${report.period} Salary Deduction Report`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;padding:20px;background:#f5f7fa">
          <div style="background:white;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.08)">
            <div style="text-align:center;margin-bottom:24px">
              <h1 style="color:#1976d2;margin:0">AutoPayroll</h1>
              <p style="color:#666;margin:6px 0 0">Salary Deduction Report — ${report.period}</p>
            </div>
            <h2 style="color:#333">Hi ${employee.name},</h2>
            <p>Your salary for <strong>${report.period}</strong> includes a late-arrival deduction.
               Below is the full breakdown for your records.</p>

            <div style="background:#e3f2fd;padding:16px;border-radius:6px;margin:20px 0">
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:4px 0">Base Salary</td>
                    <td style="text-align:right"><strong>XAF ${fmt(employee.baseSalary)}</strong></td></tr>
                <tr><td style="padding:4px 0;color:#d32f2f">Total Deduction (${employee.totalLateMinutes} min late)</td>
                    <td style="text-align:right;color:#d32f2f"><strong>-XAF ${fmt(employee.deductionAmount)}</strong></td></tr>
                <tr style="border-top:2px solid #1976d2">
                  <td style="padding:8px 0 0;font-size:16px"><strong>Net Salary</strong></td>
                  <td style="padding:8px 0 0;text-align:right;font-size:16px;color:#388e3c"><strong>XAF ${fmt(employee.finalSalary)}</strong></td>
                </tr>
              </table>
            </div>

            <h3 style="color:#555;font-size:14px;margin-bottom:8px">Late Arrival Details</h3>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:#f5f5f5">
                  <th style="padding:8px 12px;text-align:left">Date</th>
                  <th style="padding:8px 12px">Scheduled</th>
                  <th style="padding:8px 12px">Checked In</th>
                  <th style="padding:8px 12px">Late</th>
                  <th style="padding:8px 12px;text-align:right">Deduction</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>

            <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:12px;border-radius:4px;margin-top:20px;font-size:13px">
              <strong>Note:</strong> Buffer time applied: <strong>${report.bufferMinutes} minutes</strong>.
              Deductions are calculated at your standard hourly rate.
            </div>

            <p style="margin-top:24px;font-size:13px;color:#666">
              If you believe any record is incorrect, please contact HR.
            </p>
            <p>Best regards,<br/><strong>${report.company} via AutoPayroll</strong></p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#999;text-align:center">This is an automated message. Do not reply directly to this email.</p>
          </div>
        </div>`
    });
    return { success: true };
  } catch (err) {
    console.error('Deduction report email error:', err);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendEmployeeCredentials,
  sendPasswordReset,
  sendPasswordResetOtp,
  sendShiftReminder,
  sendShiftTransferRequest,
  sendShiftTransferResult,
  sendDeductionReport
};
