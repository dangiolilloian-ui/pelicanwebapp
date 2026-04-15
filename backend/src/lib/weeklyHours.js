const prisma = require('../config/db');

// Returns { current, cap, projected, overtime } for the user in the week containing `refDate`.
// Only counts PUBLISHED shifts + the `extra` (minutes or ms) being added in the current write.
async function computeWeeklyHours({ userId, refDate, extraMs = 0, excludeShiftId = null }) {
  if (!userId) return null;
  const ref = new Date(refDate);
  // Monday-start week
  const start = new Date(ref);
  start.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const where = {
    userId,
    startTime: { gte: start, lt: end },
    status: 'PUBLISHED',
  };
  if (excludeShiftId) where.id = { not: excludeShiftId };

  const shifts = await prisma.shift.findMany({
    where,
    select: { startTime: true, endTime: true },
  });

  const currentMs = shifts.reduce(
    (acc, s) => acc + (new Date(s.endTime) - new Date(s.startTime)),
    0
  );
  const projectedMs = currentMs + extraMs;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { weeklyHoursCap: true },
  });

  return {
    current: currentMs / 3600000,
    projected: projectedMs / 3600000,
    cap: user?.weeklyHoursCap ?? null,
    overtimeThreshold: 40,
    projectedOvertime: Math.max(0, projectedMs / 3600000 - 40),
    weekStart: start,
    weekEnd: end,
  };
}

// Returns an array of human-readable warning strings for a shift being saved.
async function overtimeWarnings({ userId, startTime, endTime, excludeShiftId }) {
  if (!userId) return [];
  const extraMs = new Date(endTime) - new Date(startTime);
  const stats = await computeWeeklyHours({
    userId,
    refDate: startTime,
    extraMs,
    excludeShiftId,
  });
  if (!stats) return [];

  const warnings = [];
  if (stats.cap && stats.projected > stats.cap) {
    warnings.push(
      `This shift brings the week to ${stats.projected.toFixed(1)}h, over the ${stats.cap}h cap.`
    );
  }
  if (stats.projected > 40) {
    const ot = (stats.projected - 40).toFixed(1);
    warnings.push(`Overtime: ${ot}h over the 40h weekly threshold.`);
  }
  return warnings;
}

module.exports = { computeWeeklyHours, overtimeWarnings };
