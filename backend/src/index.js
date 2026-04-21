const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

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
const conversationRoutes = require('./routes/conversations');

const { startShiftRemindersJob } = require('./jobs/shiftReminders');
const { startUnconfirmedNudgeJob } = require('./jobs/unconfirmedNudge');
const { startPtoAccrualJob } = require('./jobs/ptoAccrual');
const { startBreakReminderJob } = require('./jobs/breakReminder');
const { startClockOutReminderJob } = require('./jobs/clockOutReminder');
const { startBirthdayReminderJob } = require('./jobs/birthdayReminder');
const { startWeeklyDigestJob } = require('./jobs/weeklyDigest');
const { startLaborBudgetAlertJob } = require('./jobs/laborBudgetAlert');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
const PORT = process.env.PORT || 4000;

// We sit behind nginx-proxy-manager, so the real client IP is in the
// X-Forwarded-For header.  Trust the first hop so req.ip (used by the rate
// limiter on /auth/login) reflects the actual browser, not the proxy.
app.set('trust proxy', 1);
const path = require('path');

app.use(cors());
app.use(express.json());

// Serve uploaded chat attachments
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Make io accessible to route handlers
app.set('io', io);

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
app.use('/api/conversations', conversationRoutes);
// iCal feed lives outside /api so calendar apps get a clean URL
app.use('/ical', icalRoutes);

// --- Socket.IO authentication & room management ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  // Auto-join a room named after the user's ID so we can target messages
  socket.join(`user:${socket.user.id}`);
  // Also join an org-wide room for broadcast events
  socket.join(`org:${socket.user.organizationId}`);

  // When a client opens a conversation, join its room for real-time updates
  socket.on('join-conversation', (conversationId) => {
    socket.join(`conv:${conversationId}`);
  });

  socket.on('leave-conversation', (conversationId) => {
    socket.leave(`conv:${conversationId}`);
  });

  // Typing indicator
  socket.on('typing', ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit('user-typing', {
      conversationId,
      userId: socket.user.id,
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
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
