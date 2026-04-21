const cron = require("node-cron");
const prisma = require("../config/db");
const { notifyMany } = require("../lib/notify");

// Window: remind employees about PUBLISHED shifts whose start time falls
// inside [now, now + REMINDER_LEAD_MIN]. The dedup flag reminder_sent_at
// stops us re-notifying on the next tick.
const REMINDER_LEAD_MIN = parseInt(process.env.SHIFT_REMINDER_LEAD_MIN || "60", 10);

async function sendShiftReminders() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_MIN * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      status: "PUBLISHED",
      userId: { not: null },
      reminderSentAt: null,
      startTime: { gte: now, lte: windowEnd },
    },
    include: {
      user: { select: { id: true, firstName: true } },
      location: { select: { name: true } },
      organization: { select: { timezone: true } },
    },
  });

  if (shifts.length === 0) return;

  for (const s of shifts) {
    const tz = s.organization?.timezone || 'America/New_York';
    const when = new Date(s.startTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
    const locationBit = s.location?.name ? ` at ${s.location.name}` : "";
    await notifyMany([s.userId], {
      type: "SHIFT_REMINDER",
      title: "Upcoming shift",
      body: `Your shift${locationBit} starts at ${when}.`,
      link: "/dashboard",
    });
  }

  await prisma.shift.updateMany({
    where: { id: { in: shifts.map((s) => s.id) } },
    data: { reminderSentAt: now },
  });

  console.log(`[reminders] sent ${shifts.length} shift reminder(s)`);
}

function startShiftRemindersJob() {
  // Every 5 minutes. Dedup via reminder_sent_at means restarting the server
  // or a missed tick cannot double-send.
  cron.schedule("*/5 * * * *", () => {
    sendShiftReminders().catch((err) => console.error("[reminders] tick failed", err));
  });
  console.log(`[reminders] scheduler started (lead: ${REMINDER_LEAD_MIN}m)`);
}

module.exports = { startShiftRemindersJob, sendShiftReminders };
