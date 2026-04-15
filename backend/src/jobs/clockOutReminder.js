const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Clock-out reminder.
//
// Counterpart to the break reminder: if an employee is still punched in
// CLOCKOUT_GRACE_MINUTES (default 15) past the scheduled end time of the
// shift the TimeEntry is linked to, nudge them to clock out. Most "forgot
// to clock out" incidents end with the entry being closed at midnight by a
// manager the next morning — catching it within 15 minutes means the
// timecard stays accurate and payroll doesn't need manual corrections.
//
// Unlinked time entries (shiftId = null) are skipped because we have no
// anchor for "supposed to be done by now". The break reminder doesn't care
// about that distinction, but this one can't work without a scheduled end.

const GRACE_MINUTES = parseInt(process.env.CLOCKOUT_GRACE_MINUTES || '15', 10);

async function sendClockOutReminders() {
  const now = new Date();

  // Pull candidate entries (still open, linked to a shift, never reminded).
  // We filter by scheduled end time in JS because the cutoff depends on the
  // related shift's end_time, which Prisma can't directly compare in the
  // where clause without a raw query.
  const candidates = await prisma.timeEntry.findMany({
    where: {
      clockOut: null,
      clockOutReminderAt: null,
      shiftId: { not: null },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (candidates.length === 0) return;

  const shiftIds = [...new Set(candidates.map((e) => e.shiftId))];
  const shifts = await prisma.shift.findMany({
    where: { id: { in: shiftIds } },
    select: { id: true, endTime: true },
  });
  const endById = new Map(shifts.map((s) => [s.id, s.endTime]));

  const due = [];
  for (const e of candidates) {
    const end = endById.get(e.shiftId);
    if (!end) continue;
    const overdueMs = now.getTime() - new Date(end).getTime();
    if (overdueMs >= GRACE_MINUTES * 60 * 1000) due.push(e);
  }
  if (due.length === 0) return;

  for (const e of due) {
    await notifyMany([e.userId], {
      type: 'CLOCKOUT_REMINDER',
      title: 'Still clocked in?',
      body: "Your shift ended a few minutes ago. Don't forget to clock out.",
      link: '/dashboard/timeclock',
    });
  }

  await prisma.timeEntry.updateMany({
    where: { id: { in: due.map((e) => e.id) } },
    data: { clockOutReminderAt: new Date() },
  });

  console.log('[clockout-reminder] nudged ' + due.length + ' employee(s)');
}

function startClockOutReminderJob() {
  // Every 5 minutes — shorter than the break job because the actionable
  // window is smaller and the dedup flag keeps the cost bounded.
  cron.schedule('*/5 * * * *', () => {
    sendClockOutReminders().catch((err) => console.error('[clockout-reminder] tick failed', err));
  });
  console.log('[clockout-reminder] scheduler started (grace: ' + GRACE_MINUTES + 'm)');
}

module.exports = { startClockOutReminderJob, sendClockOutReminders };
