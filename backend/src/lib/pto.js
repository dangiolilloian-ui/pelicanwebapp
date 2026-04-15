const prisma = require('../config/db');

// Defaults target NJ Earned Sick Leave compliance: 1 hour accrued per 30
// hours worked, capped at 40h per calendar year. This is the legal floor;
// orgs can bump accrualRatePerHour for a more generous PTO policy.
const DEFAULTS = {
  enabled: true,
  accrualRatePerHour: 1 / 30, // ~0.0333
  annualCapHours: 40,
  // Allow negative balances? Defaults to false — approval is blocked at the
  // UI level but the backend enforces it too (soft warn).
  allowNegative: false,
};

async function getConfig(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ptoConfig: true },
  });
  return { ...DEFAULTS, ...(org?.ptoConfig || {}) };
}

// Current available balance = sum of all ledger deltas for the user.
async function getBalance(userId) {
  const agg = await prisma.ptoLedgerEntry.aggregate({
    where: { userId },
    _sum: { delta: true },
  });
  return agg._sum.delta || 0;
}

// Year-to-date accrued hours (only ACCRUAL entries). Used to enforce the
// annual cap so orgs don't over-accrue.
async function getYtdAccrued(userId) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const agg = await prisma.ptoLedgerEntry.aggregate({
    where: { userId, kind: 'ACCRUAL', createdAt: { gte: startOfYear } },
    _sum: { delta: true },
  });
  return agg._sum.delta || 0;
}

// Idempotent accrual write. refId is the TimeEntry id — we skip if a row
// already exists for that ref so the nightly cron can re-run safely.
async function recordAccrualForEntry(organizationId, entry, config) {
  if (!config.enabled) return null;
  if (!entry.clockOut) return null;

  const existing = await prisma.ptoLedgerEntry.findFirst({
    where: { refType: 'TIMEENTRY', refId: entry.id, kind: 'ACCRUAL' },
  });
  if (existing) return existing;

  const workedMs = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
  const workedHours = Math.max(0, workedMs / 3600000 - (entry.totalBreakMinutes || 0) / 60);
  if (workedHours <= 0) return null;

  let delta = workedHours * config.accrualRatePerHour;

  // Enforce annual cap — clip the accrual if it would exceed remaining headroom.
  const ytd = await getYtdAccrued(entry.userId);
  const headroom = Math.max(0, config.annualCapHours - ytd);
  if (headroom <= 0) return null;
  if (delta > headroom) delta = headroom;

  // Round to 2 decimals so the ledger is readable.
  delta = Math.round(delta * 100) / 100;
  if (delta <= 0) return null;

  return prisma.ptoLedgerEntry.create({
    data: {
      organizationId,
      userId: entry.userId,
      delta,
      kind: 'ACCRUAL',
      reason: `Accrued from ${workedHours.toFixed(2)}h worked`,
      refType: 'TIMEENTRY',
      refId: entry.id,
    },
  });
}

// Called when a time-off request is approved. Idempotent via ref lookup so
// re-approving (or a retry) doesn't double-consume.
async function recordConsumeForTimeoff(organizationId, request, actorId) {
  const hours = request.hours;
  if (!hours || hours <= 0) return null;

  const existing = await prisma.ptoLedgerEntry.findFirst({
    where: { refType: 'TIMEOFF', refId: request.id, kind: 'CONSUME' },
  });
  if (existing) return existing;

  return prisma.ptoLedgerEntry.create({
    data: {
      organizationId,
      userId: request.userId,
      delta: -hours,
      kind: 'CONSUME',
      reason: `Time-off ${new Date(request.startDate).toLocaleDateString()} – ${new Date(request.endDate).toLocaleDateString()}`,
      refType: 'TIMEOFF',
      refId: request.id,
      actorId: actorId || null,
    },
  });
}

// Manual adjust/grant by a manager. `delta` can be negative.
async function recordAdjust(organizationId, userId, delta, reason, actorId) {
  return prisma.ptoLedgerEntry.create({
    data: {
      organizationId,
      userId,
      delta,
      kind: delta >= 0 ? 'GRANT' : 'ADJUST',
      reason,
      refType: 'ADJUSTMENT',
      actorId: actorId || null,
    },
  });
}

module.exports = {
  DEFAULTS,
  getConfig,
  getBalance,
  getYtdAccrued,
  recordAccrualForEntry,
  recordConsumeForTimeoff,
  recordAdjust,
};
