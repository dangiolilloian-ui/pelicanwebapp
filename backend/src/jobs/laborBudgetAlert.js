const cron = require('node-cron');
const prisma = require('../config/db');
const { notifyMany } = require('../lib/notify');

// Labor budget alert.
//
// Runs every hour. For each location that has a weeklyBudget set, sum the
// planned labor for the current week (shifts × position.hourlyRate) and
// push managers when the ratio crosses a threshold. We alert at 90% (soft
// warning) and 100% (hard overrun) — no lower thresholds because there's
// no point pinging on Monday morning when 40% means "on track".
//
// Dedup: in-memory only. We key by "locationId|weekStart|threshold" so a
// single location emits each threshold at most once per week. This drops
// on restart, so after a restart a mid-week overrun will re-ping the
// next tick. That's a tolerable edge case vs. the complexity of a
// dedicated state table; if we get complaints we'll promote to a row.

const TICK_CRON = process.env.LABOR_ALERT_CRON || '5 * * * *'; // hourly at :05
const fired = new Set();

function getWeekStart(d) {
  const ws = new Date(d);
  ws.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  ws.setHours(0, 0, 0, 0);
  return ws;
}

async function checkLaborBudgets() {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekKey = weekStart.toISOString().slice(0, 10);

  // Occasionally sweep: drop fired keys not matching the current week so
  // the set doesn't grow forever.
  for (const k of fired) {
    if (!k.includes(`|${weekKey}|`)) fired.delete(k);
  }

  const locations = await prisma.location.findMany({
    where: { weeklyBudget: { not: null, gt: 0 } },
    select: { id: true, name: true, weeklyBudget: true, organizationId: true },
  });
  if (locations.length === 0) return;

  for (const loc of locations) {
    const shifts = await prisma.shift.findMany({
      where: {
        locationId: loc.id,
        startTime: { gte: weekStart, lt: weekEnd },
      },
      include: { position: { select: { hourlyRate: true } } },
    });

    let cost = 0;
    for (const s of shifts) {
      const hours = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
      cost += hours * (s.position?.hourlyRate || 0);
    }
    const pct = cost / loc.weeklyBudget;

    // Walk thresholds high→low so if we crossed both in one tick, 100%
    // wins and we skip the 90% ping.
    let firedThisTick = null;
    for (const t of [100, 90]) {
      if (pct >= t / 100) { firedThisTick = t; break; }
    }
    if (!firedThisTick) continue;

    const dedupKey = `${loc.id}|${weekKey}|${firedThisTick}`;
    if (fired.has(dedupKey)) continue;
    // Also suppress the 90% alert if the 100% alert already fired this week
    // (going from overrun to merely near-cap shouldn't re-ping).
    if (firedThisTick === 90 && fired.has(`${loc.id}|${weekKey}|100`)) continue;
    fired.add(dedupKey);

    const managers = await prisma.user.findMany({
      where: { organizationId: loc.organizationId, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true },
    });
    if (managers.length === 0) continue;

    const money = Math.round(cost).toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    });
    const budgetMoney = Math.round(loc.weeklyBudget).toLocaleString('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    });

    await notifyMany(managers.map((m) => m.id), {
      type: 'LABOR_BUDGET_ALERT',
      title: firedThisTick === 100
        ? `${loc.name}: budget exceeded`
        : `${loc.name}: 90% of budget`,
      body: `${money} planned of ${budgetMoney} weekly (${Math.round(pct * 100)}%)`,
      link: '/dashboard/reports',
    });
    console.log('[labor-alert] ' + loc.name + ' crossed ' + firedThisTick + '%');
  }
}

function startLaborBudgetAlertJob() {
  cron.schedule(TICK_CRON, () => {
    checkLaborBudgets().catch((err) => console.error('[labor-alert] tick failed', err));
  });
  console.log('[labor-alert] scheduler started (cron: ' + TICK_CRON + ')');
}

module.exports = { startLaborBudgetAlertJob, checkLaborBudgets };
