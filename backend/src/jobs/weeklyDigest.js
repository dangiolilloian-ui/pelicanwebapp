const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Weekly owner digest.
//
// Fires Monday 08:00 with a one-glance push summarizing the week that just
// started: how many shifts, planned labor, how many are still unassigned,
// and what's waiting for a decision (pending swaps / time-off). The target
// audience is the owner who doesn't live in the app day-to-day but wants a
// Monday-morning "is this week under control" ping.
//
// Dedup: cron only fires once per Monday so we don't bother with a
// per-run flag. If the server restarts past 08:00 on a Monday the digest
// that week is lost — acceptable tradeoff for not building a job-log table.

function getWeekStart(d) {
  const ws = new Date(d);
  ws.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  ws.setHours(0, 0, 0, 0);
  return ws;
}

async function sendWeeklyDigest() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  if (orgs.length === 0) return;

  let sent = 0;
  for (const org of orgs) {
    const [shifts, pendingSwaps, pendingTimeOff, owners] = await Promise.all([
      prisma.shift.findMany({
        where: {
          organizationId: org.id,
          startTime: { gte: weekStart, lt: weekEnd },
        },
        include: { position: { select: { hourlyRate: true } } },
      }),
      prisma.shiftSwap.count({
        where: { status: 'PENDING', shift: { organizationId: org.id } },
      }),
      prisma.timeOffRequest.count({
        where: { status: 'PENDING', user: { organizationId: org.id } },
      }),
      prisma.user.findMany({
        where: { organizationId: org.id, role: 'OWNER' },
        select: { id: true },
      }),
    ]);

    if (owners.length === 0) continue;
    if (shifts.length === 0 && pendingSwaps === 0 && pendingTimeOff === 0) continue;

    let plannedHours = 0;
    let plannedCost = 0;
    let unassigned = 0;
    for (const s of shifts) {
      const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
      plannedHours += h;
      plannedCost += h * (s.position?.hourlyRate || 0);
      if (!s.userId) unassigned++;
    }

    const money = Math.round(plannedCost).toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    });

    const bits = [
      `${shifts.length} shifts · ${Math.round(plannedHours)}h · ${money}`,
    ];
    if (unassigned > 0) bits.push(`${unassigned} unassigned`);
    if (pendingSwaps > 0) bits.push(`${pendingSwaps} swap${pendingSwaps === 1 ? '' : 's'} pending`);
    if (pendingTimeOff > 0) bits.push(`${pendingTimeOff} time-off pending`);

    await notifyMany(owners.map((o) => o.id), {
      type: 'WEEKLY_DIGEST',
      title: 'Week ahead',
      body: bits.join(' · '),
      link: '/dashboard',
    });
    sent++;
  }

  if (sent > 0) console.log('[weekly-digest] pushed to ' + sent + ' org(s)');
}

function startWeeklyDigestJob() {
  // 08:00 every Monday.
  cron.schedule('0 8 * * 1', () => {
    sendWeeklyDigest().catch((err) => console.error('[weekly-digest] tick failed', err));
  });
  console.log('[weekly-digest] scheduler started (Mon 08:00)');
}

module.exports = { startWeeklyDigestJob, sendWeeklyDigest };
