const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Nag employees (and CC their managers) about published shifts starting in
// the next NUDGE_WINDOW_HOURS that they haven't confirmed yet. Dedup via
// unconfirmed_nudged_at so we only nudge once per shift — if the employee
// still hasn't confirmed 24h later, the manager already knows about it.
const NUDGE_WINDOW_HOURS = parseInt(process.env.UNCONFIRMED_NUDGE_HOURS || '24', 10);

async function sendUnconfirmedNudges() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + NUDGE_WINDOW_HOURS * 60 * 60 * 1000);

  const shifts = await prisma.shift.findMany({
    where: {
      status: 'PUBLISHED',
      userId: { not: null },
      confirmedAt: null,
      unconfirmedNudgedAt: null,
      startTime: { gte: now, lte: windowEnd },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { name: true } },
      location: { select: { name: true } },
    },
  });

  if (shifts.length === 0) return;

  // Fetch managers per org in one pass so we don't re-query for each shift.
  const orgIds = [...new Set(shifts.map((s) => s.organizationId))];
  const managers = await prisma.user.findMany({
    where: { organizationId: { in: orgIds }, role: { in: ['OWNER', 'MANAGER'] } },
    select: { id: true, organizationId: true },
  });
  const managersByOrg = new Map();
  for (const m of managers) {
    const list = managersByOrg.get(m.organizationId) || [];
    list.push(m.id);
    managersByOrg.set(m.organizationId, list);
  }

  // Look up org timezones so notifications display local times
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, timezone: true },
  });
  const tzByOrg = new Map(orgs.map((o) => [o.id, o.timezone || 'America/New_York']));

  for (const s of shifts) {
    const tz = tzByOrg.get(s.organizationId) || 'America/New_York';
    const when = new Date(s.startTime).toLocaleString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });
    const label = [s.position?.name, s.location?.name].filter(Boolean).join(' @ ') || 'Shift';

    // Employee nudge
    await notifyMany([s.userId], {
      type: 'SHIFT_UNCONFIRMED',
      title: 'Confirm your shift',
      body: `Please confirm ${label} — ${when}.`,
      link: '/dashboard',
    });

    // Manager heads-up (excluding the employee if they happen to be a manager)
    const mgrs = (managersByOrg.get(s.organizationId) || []).filter((id) => id !== s.userId);
    if (mgrs.length > 0) {
      await notifyMany(mgrs, {
        type: 'SHIFT_UNCONFIRMED',
        title: 'Unconfirmed shift',
        body: `${s.user.firstName} ${s.user.lastName} hasn't confirmed ${label} — ${when}.`,
        link: '/dashboard/schedule',
      });
    }
  }

  await prisma.shift.updateMany({
    where: { id: { in: shifts.map((s) => s.id) } },
    data: { unconfirmedNudgedAt: now },
  });

  console.log(`[unconfirmed] nudged ${shifts.length} shift(s)`);
}

function startUnconfirmedNudgeJob() {
  // Every 15 minutes. Dedup via unconfirmed_nudged_at keeps this at most once per shift.
  cron.schedule('*/15 * * * *', () => {
    sendUnconfirmedNudges().catch((err) => console.error('[unconfirmed] tick failed', err));
  });
  console.log(`[unconfirmed] scheduler started (window: ${NUDGE_WINDOW_HOURS}h)`);
}

module.exports = { startUnconfirmedNudgeJob, sendUnconfirmedNudges };
