const CompanySetting = require('../models/CompanySetting');
const LateRecord     = require('../models/LateRecord');
const DeductionReport= require('../models/DeductionReport');
const Employee       = require('../models/Employee');
const User           = require('../models/User');
const Branch         = require('../models/Branch');
const { isBranchRole } = require('../middleware/auth');
const { sendDeductionReport } = require('../utils/emailService');

// ── Helpers ──────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// ── Buffer time ───────────────────────────────────────────

// GET /api/v1/deductions/buffer
exports.getBuffer = async (req, res) => {
  try {
    if (isBranchRole(req.user)) {
      const branch = await Branch.findById(req.user.branchId);
      return res.status(200).json({ success: true, bufferMinutes: branch?.bufferMinutes ?? 0 });
    }
    const s = await CompanySetting.findOne({ company: req.user.company });
    res.status(200).json({ success: true, bufferMinutes: s?.bufferMinutes ?? 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/deductions/buffer
exports.setBuffer = async (req, res) => {
  try {
    const { bufferMinutes } = req.body;
    const mins = parseInt(bufferMinutes, 10);
    if (isNaN(mins) || mins < 0 || mins > 120) {
      return res.status(400).json({ success: false, message: 'Buffer must be 0–120 minutes.' });
    }
    if (isBranchRole(req.user)) {
      await Branch.findByIdAndUpdate(req.user.branchId, { bufferMinutes: mins });
      return res.status(200).json({ success: true, bufferMinutes: mins });
    }
    await CompanySetting.findOneAndUpdate(
      { company: req.user.company },
      { bufferMinutes: mins, company: req.user.company, updatedBy: req.user.id, updatedAt: new Date() },
      { upsert: true }
    );
    res.status(200).json({ success: true, bufferMinutes: mins });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Late records ──────────────────────────────────────────

// GET /api/v1/deductions/records?month=4&year=2026
exports.getLateRecords = async (req, res) => {
  try {
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const filter = { company: req.user.company, month, year };
    if (isBranchRole(req.user)) {
      const empIds = await Employee.find({ branchId: req.user.branchId }).distinct('_id');
      filter.employeeId = { $in: empIds };
    }

    const records = await LateRecord.find(filter)
      .populate('employeeId', 'name position email salary')
      .sort({ date: 1 });

    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/deductions/my-records  (employee)
exports.getMyLateRecords = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    const records = await LateRecord.find({ employeeId: employee._id })
      .sort({ date: -1 })
      .limit(60);

    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Monthly deduction reports ─────────────────────────────

// POST /api/v1/deductions/reports/generate
exports.generateReport = async (req, res) => {
  try {
    const month    = parseInt(req.body.month) || new Date().getMonth() + 1;
    const year     = parseInt(req.body.year)  || new Date().getFullYear();
    const branchId = isBranchRole(req.user) ? req.user.branchId : null;

    // One report per month per scope (company or branch)
    const existing = await DeductionReport.findOne({ company: req.user.company, month, year, branchId: branchId ?? null });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A report for ${MONTH_NAMES[month - 1]} ${year} already exists.`,
        reportId: existing._id
      });
    }

    let bufferMinutes;
    if (branchId) {
      const branch = await Branch.findById(branchId);
      bufferMinutes = branch?.bufferMinutes ?? 0;
    } else {
      const setting = await CompanySetting.findOne({ company: req.user.company });
      bufferMinutes = setting?.bufferMinutes ?? 0;
    }

    // Late records scoped to company or branch
    const recordFilter = { company: req.user.company, month, year };
    if (branchId) {
      const empIds = await Employee.find({ branchId }).distinct('_id');
      recordFilter.employeeId = { $in: empIds };
    }
    const records = await LateRecord.find(recordFilter)
      .populate('employeeId', 'name position email salary');

    if (!records.length) {
      return res.status(400).json({
        success: false,
        message: `No late records found for ${MONTH_NAMES[month - 1]} ${year}.`
      });
    }

    // Aggregate per employee
    const empMap = {};
    for (const r of records) {
      const eid = r.employeeId._id.toString();
      if (!empMap[eid]) {
        empMap[eid] = {
          employeeId:       r.employeeId._id,
          name:             r.employeeId.name,
          position:         r.employeeId.position || '',
          email:            r.employeeId.email || '',
          baseSalary:       r.employeeId.salary,
          totalLateMinutes: 0,
          deductionAmount:  0,
          lateRecords:      []
        };
      }
      empMap[eid].totalLateMinutes  += r.lateMinutes;
      empMap[eid].deductionAmount   += r.deductionAmount;
      empMap[eid].lateRecords.push(r._id);
    }

    const employees = Object.values(empMap).map(e => ({
      ...e,
      deductionAmount: Math.round(e.deductionAmount * 100) / 100,
      finalSalary:     Math.round((e.baseSalary - e.deductionAmount) * 100) / 100
    }));

    const totalDeductionAmount = employees.reduce((s, e) => s + e.deductionAmount, 0);

    const report = await DeductionReport.create({
      company: req.user.company,
      branchId: branchId ?? null,
      month,
      year,
      period: `${MONTH_NAMES[month - 1]} ${year}`,
      bufferMinutes,
      employees,
      totalDeductionAmount: Math.round(totalDeductionAmount * 100) / 100,
      generatedBy: req.user.id,
      generatedAt: new Date()
    });

    res.status(201).json({ success: true, data: report });
  } catch (err) {
    console.error('Generate report error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/deductions/reports
exports.getReports = async (req, res) => {
  try {
    const filter = { company: req.user.company };
    if (isBranchRole(req.user)) filter.branchId = req.user.branchId;

    const reports = await DeductionReport.find(filter)
      .sort({ year: -1, month: -1 })
      .populate('generatedBy', 'name')
      .populate('approvedBy', 'name');
    res.status(200).json({ success: true, count: reports.length, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/deductions/reports/:id
exports.getReport = async (req, res) => {
  try {
    const filter = { _id: req.params.id, company: req.user.company };
    if (isBranchRole(req.user)) filter.branchId = req.user.branchId;

    const report = await DeductionReport.findOne(filter)
      .populate('generatedBy', 'name')
      .populate('approvedBy', 'name');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

    // Enrich with per-employee late records detail
    const enriched = report.toObject();
    for (const emp of enriched.employees) {
      emp.records = await LateRecord.find({ _id: { $in: emp.lateRecords } }).sort({ date: 1 });
    }
    res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/v1/deductions/reports/:id/approve
exports.approveReport = async (req, res) => {
  try {
    const approveFilter = { _id: req.params.id, company: req.user.company };
    if (isBranchRole(req.user)) approveFilter.branchId = req.user.branchId;
    const report = await DeductionReport.findOne(approveFilter);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });
    if (report.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Report has already been approved.' });
    }
    report.status     = 'approved';
    report.approvedBy = req.user.id;
    report.approvedAt = new Date();
    await report.save();
    res.status(200).json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/deductions/reports/:id/pay-and-send
exports.payAndSend = async (req, res) => {
  try {
    const payFilter = { _id: req.params.id, company: req.user.company };
    if (isBranchRole(req.user)) payFilter.branchId = req.user.branchId;
    const report = await DeductionReport.findOne(payFilter)
      .populate('approvedBy', 'name');
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });
    if (report.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Report must be approved before paying.' });
    }

    // Enrich with records for email
    const enriched = report.toObject();
    for (const emp of enriched.employees) {
      emp.records = await LateRecord.find({ _id: { $in: emp.lateRecords } }).sort({ date: 1 });
    }

    // Send email to each employee with a deduction
    const emailResults = [];
    for (const emp of enriched.employees) {
      if (emp.email && emp.deductionAmount > 0) {
        const result = await sendDeductionReport(emp, enriched);
        emailResults.push({ name: emp.name, email: emp.email, sent: result.success });
      }
    }

    report.status      = 'paid';
    report.emailSentAt = new Date();
    await report.save();

    res.status(200).json({ success: true, data: report, emailResults });
  } catch (err) {
    console.error('Pay-and-send error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/v1/deductions/my-reports  (employee: their own deduction reports)
exports.getMyReports = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) return res.status(404).json({ success: false, message: 'Employee record not found' });

    const reports = await DeductionReport.find({
      company: req.user.company,
      status: { $in: ['approved', 'paid'] },
      'employees.employeeId': employee._id
    }).sort({ year: -1, month: -1 });

    const myReports = reports.map(r => {
      const entry = r.employees.find(e => e.employeeId.toString() === employee._id.toString());
      return {
        _id: r._id,
        period: r.period,
        month: r.month,
        year: r.year,
        status: r.status,
        bufferMinutes: r.bufferMinutes,
        totalLateMinutes: entry?.totalLateMinutes ?? 0,
        deductionAmount:  entry?.deductionAmount  ?? 0,
        baseSalary:       entry?.baseSalary       ?? 0,
        finalSalary:      entry?.finalSalary      ?? 0,
        approvedAt: r.approvedAt,
        emailSentAt: r.emailSentAt
      };
    });

    res.status(200).json({ success: true, data: myReports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
