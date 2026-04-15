const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const shiftRoutes = require('./routes/shifts');
const positionRoutes = require('./routes/positions');
const locationRoutes = require('./routes/locations');
const availabilityRoutes = require('./routes/availability');
const timeoffRoutes = require('./routes/timeoff');
const messageRoutes = require('./routes/messages');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const timeclockRoutes = require('./routes/timeclock');
const reportRoutes = require('./routes/reports');
const templateRoutes = require('./routes/templates');
const swapRoutes = require('./routes/swaps');
const kioskRoutes = require('./routes/kiosk');
const icalRoutes = require('./routes/ical');
const recurringShiftRoutes = require('./routes/recurringShifts');
const announcementRoutes = require('./routes/announcements');
const certificationRoutes = require('./routes/certifications');
const checklistRoutes = require('./routes/checklists');
const employeeNoteRoutes = require('./routes/employeeNotes');
const auditLogRoutes = require('./routes/auditLogs');
const orgRoutes = require('./routes/org');
const ptoRoutes = require('./routes/pto');
const coverageRoutes = require('./routes/coverage');
const pushRoutes = require('./routes/push');
const approvalRoutes = require('./routes/approvals');
const holidayRoutes = require('./routes/holidays');
const dailySalesRoutes = require('./routes/dailySales');
const onboardingRoutes = require('./routes/onboarding');
const incidentRoutes = require('./routes/incidents');

const { startShiftRemindersJob } = require('./jobs/shiftReminders');
const { startUnconfirmedNudgeJob } = require('./jobs/unconfirmedNudge');
const { startPtoAccrualJob } = require('./jobs/ptoAccrual');
const { startBreakReminderJob } = require('./jobs/breakReminder');
const { startClockOutReminderJob } = require('./jobs/clockOutReminder');
const { startBirthdayReminderJob } = require('./jobs/birthdayReminder');
const { startWeeklyDigestJob } = require('./jobs/weeklyDigest');
const { startLaborBudgetAlertJob } = require('./jobs/laborBudgetAlert');

const app = express();
const PORT = process.env.PORT || 4000;

// We sit behind nginx-proxy-manager, so the real client IP is in the
// X-Forwarded-For header.  Trust the first hop so req.ip (used by the rate
// limiter on /auth/login) reflects the actual browser, not the proxy.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/timeoff', timeoffRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/timeclock', timeclockRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/swaps', swapRoutes);
app.use('/api/kiosk', kioskRoutes);
app.use('/api/recurring-shifts', recurringShiftRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/certifications', certificationRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/employee-notes', employeeNoteRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/pto', ptoRoutes);
app.use('/api/coverage', coverageRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/sales', dailySalesRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/incidents', incidentRoutes);
// iCal feed lives outside /api so calendar apps get a clean URL
app.use('/ical', icalRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pelican API running on port ${PORT}`);
  startShiftRemindersJob();
  startUnconfirmedNudgeJob();
  startPtoAccrualJob();
  startBreakReminderJob();
  startClockOutReminderJob();
  startBirthdayReminderJob();
  startWeeklyDigestJob();
  startLaborBudgetAlertJob();
});
