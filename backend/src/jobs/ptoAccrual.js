const cron = require('node-cron');
const prisma = require('../config/db');
const { getConfig, recordAccrualForEntry } = require('../lib/pto');

// Nightly sweep: find all TimeEntry rows closed in the last LOOKBACK_HOURS
// that don't yet have an ACCRUAL ledger entry, and accrue their PTO. We use
// a lookback window instead of "since last run" so a missed night catches up
// without a bespoke offset tracker. The helper is idempotent — duplicate
// runs are safe.
const LOOKBACK_HOURS = parseInt(process.env.PTO_ACCRUAL_LOOKBACK_HOURS || '72', 10);

async function runAccrualSweep() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const entries = await prisma.timeEntry.findMany({
    where: {
      clockOut: { gte: since, not: null },
    },
    include: {
      user: { select: { id: true, organizationId: true } },
    },
  });

  if (entries.length === 0) return { accrued: 0, skipped: 0 };

  // Cache config per org so a nightly sweep doesn't re-read the org row N times.
  const configCache = new Map();
  const getCachedConfig = async (orgId) => {
    if (!configCache.has(orgId)) configCache.set(orgId, await getConfig(orgId));
    return configCache.get(orgId);
  };

  let accrued = 0;
  let skipped = 0;
  for (const entry of entries) {
    try {
      const config = await getCachedConfig(entry.user.organizationId);
      if (!config.enabled) {
        skipped += 1;
        continue;
      }
      const written = await recordAccrualForEntry(entry.user.organizationId, entry, config);
      if (written) accrued += 1;
      else skipped += 1;
    } catch (err) {
      console.error('[pto-accrual] failed for entry', entry.id, err.message);
      skipped += 1;
    }
  }
  return { accrued, skipped };
}

function startPtoAccrualJob() {
  // 03:15 every day — well past midnight so any late clock-outs are closed.
  cron.schedule('15 3 * * *', async () => {
    try {
      const result = await runAccrualSweep();
      console.log(`[pto-accrual] nightly sweep: accrued=${result.accrued} skipped=${result.skipped}`);
    } catch (err) {
      console.error('[pto-accrual] sweep failed:', err);
    }
  });
  console.log(`[pto-accrual] scheduler started (lookback: ${LOOKBACK_HOURS}h, 03:15 daily)`);
}

module.exports = { startPtoAccrualJob, runAccrualSweep };
