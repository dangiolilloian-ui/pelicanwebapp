const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Break reminder job.
//
// NJ/PA don't have a general adult rest-break mandate, but most operators
// treat a 30-minute unpaid meal break at 5h as table stakes — both as a
// wellness measure and to stay on the right side of wage-and-hour audits
// when the shift crosses 6 hours.  (Minors under 18 DO have a legal rest
// rule — those are already caught by the minor-compliance report.)
//
// What this job does: once every 10 minutes, find any open TimeEntry that
// has been punched in for BREAK_AFTER_HOURS (default 5) without any break
// taken (totalBreakMinutes === 0 AND breakStartedAt === null) and hasn't
// already been reminded.  Push a nudge to the employee and log an audit
// entry.  A single reminder per shift is enough — if they ignore it and
// clock out 3h later, escalating further is noise, not signal.

const BREAK_AFTER_HOURS = parseInt(process.env.BREAK_REMINDER_HOURS || '5', 10);

async function sendBreakReminders() {
  const cutoff = new Date(Date.now() - BREAK_AFTER_HOURS * 60 * 60 * 1000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      clockOut: null,
      clockIn: { lte: cutoff },
      breakStartedAt: null,
      totalBreakMinutes: 0,
      breakReminderAt: null,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (entries.length === 0) return;

  for (const e of entries) {
    const hoursIn = Math.floor((Date.now() - new Date(e.clockIn).getTime()) / 3600000);
    await notifyMany([e.userId], {
      type: 'BREAK_REMINDER',
      title: 'Time for a break?',
      body: "You've been clocked in for " + hoursIn + "h without a break. Take 30 when you can.",
      link: '/dashboard/timeclock',
    });
  }

  await prisma.timeEntry.updateMany({
    where: { id: { in: entries.map((e) => e.id) } },
    data: { breakReminderAt: new Date() },
  });

  console.log('[break-reminder] nudged ' + entries.length + ' employee(s)');
}

function startBreakReminderJob() {
  // Every 10 minutes. With dedup via breakReminderAt, this is cheap.
  cron.schedule('*/10 * * * *', () => {
    sendBreakReminders().catch((err) => console.error('[break-reminder] tick failed', err));
  });
  console.log('[break-reminder] scheduler started (threshold: ' + BREAK_AFTER_HOURS + 'h)');
}

module.exports = { startBreakReminderJob, sendBreakReminders };
