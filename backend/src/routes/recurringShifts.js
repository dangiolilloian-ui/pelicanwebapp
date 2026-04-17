const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { getHolidayDateSet } = require('../lib/holidays');
const { getUserLocationIds } = require('../lib/locationAccess');

const router = Router();

// Hydrate each rule with user/position/location labels so the settings list
// can render them without a second round trip. We do this manually (not via
// Prisma relations) because RecurringShift has no FK relations defined —
// users/positions/locations can be soft-deleted and we want the rule to
// survive that until a manager cleans it up.
async function hydrate(rules, organizationId) {
  const userIds = [...new Set(rules.map((r) => r.userId).filter(Boolean))];
  const posIds = [...new Set(rules.map((r) => r.positionId).filter(Boolean))];
  const locIds = [...new Set(rules.map((r) => r.locationId).filter(Boolean))];
  const [users, positions, locations] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds }, organizationId },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    posIds.length
      ? prisma.position.findMany({
          where: { id: { in: posIds }, organizationId },
          select: { id: true, name: true, color: true },
        })
      : [],
    locIds.length
      ? prisma.location.findMany({
          where: { id: { in: locIds }, organizationId },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const uMap = new Map(users.map((u) => [u.id, u]));
  const pMap = new Map(positions.map((p) => [p.id, p]));
  const lMap = new Map(locations.map((l) => [l.id, l]));
  return rules.map((r) => ({
    ...r,
    user: r.userId ? uMap.get(r.userId) || null : null,
    position: r.positionId ? pMap.get(r.positionId) || null : null,
    location: r.locationId ? lMap.get(r.locationId) || null : null,
  }));
}

router.get('/', authenticate, async (req, res) => {
  const where = { organizationId: req.user.organizationId };
  // Scope to user's locations for non-owners
  const locationIds = await getUserLocationIds(req.user);
  if (locationIds !== null) {
    where.OR = [{ locationId: { in: locationIds } }, { locationId: null }];
  }
  const rules = await prisma.recurringShift.findMany({
    where,
    orderBy: [{ active: 'desc' }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
  res.json(await hydrate(rules, req.user.organizationId));
});

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const {
    userId, positionId, locationId,
    dayOfWeek, startTime, endTime,
    validFrom, validUntil, notes,
  } = req.body;
  if (dayOfWeek == null || !startTime || !endTime || !validFrom) {
    return res.status(400).json({ error: 'dayOfWeek, startTime, endTime, validFrom required' });
  }
  const rule = await prisma.recurringShift.create({
    data: {
      organizationId: req.user.organizationId,
      userId: userId || null,
      positionId: positionId || null,
      locationId: locationId || null,
      dayOfWeek: Number(dayOfWeek),
      startTime,
      endTime,
      validFrom: new Date(validFrom),
      validUntil: validUntil ? new Date(validUntil) : null,
      notes: notes || null,
    },
  });
  const [hydrated] = await hydrate([rule], req.user.organizationId);
  res.status(201).json(hydrated);
});

router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const {
    userId, positionId, locationId,
    dayOfWeek, startTime, endTime,
    validFrom, validUntil, notes, active,
  } = req.body;
  const rule = await prisma.recurringShift.update({
    where: { id: req.params.id },
    data: {
      ...(userId !== undefined && { userId: userId || null }),
      ...(positionId !== undefined && { positionId: positionId || null }),
      ...(locationId !== undefined && { locationId: locationId || null }),
      ...(dayOfWeek !== undefined && { dayOfWeek: Number(dayOfWeek) }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(validFrom !== undefined && { validFrom: new Date(validFrom) }),
      ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
      ...(notes !== undefined && { notes }),
      ...(active !== undefined && { active: !!active }),
    },
  });
  const [hydrated] = await hydrate([rule], req.user.organizationId);
  res.json(hydrated);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  await prisma.recurringShift.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Materialize active rules into DRAFT shifts for a given week. Returns the
// count of created shifts and a list of skipped rules (already a shift
// exists for that user/day/time, or rule inactive for that date).
router.post('/materialize', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { weekStart } = req.body;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });

  // Normalize to midnight of the given day. The frontend sends the Monday
  // already, we just zero-out the time-of-day so local DST changes don't
  // shift the materialized shifts by an hour.
  const base = new Date(weekStart);
  base.setHours(0, 0, 0, 0);
  const weekStartMs = base.getTime();
  const weekEndMs = weekStartMs + 7 * 24 * 3600 * 1000;

  // Scope to user's locations for non-owners
  const locationIds = await getUserLocationIds(req.user);
  const locFilter = locationIds !== null
    ? { AND: [
        { OR: [{ locationId: { in: locationIds } }, { locationId: null }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: new Date(weekStartMs) } }] },
      ]}
    : { OR: [{ validUntil: null }, { validUntil: { gte: new Date(weekStartMs) } }] };

  const rules = await prisma.recurringShift.findMany({
    where: {
      organizationId: req.user.organizationId,
      active: true,
      validFrom: { lte: new Date(weekEndMs) },
      ...locFilter,
    },
  });

  // Pull existing shifts for the week so we can dedupe by userId+startTime.
  // Makes materialize idempotent: click twice, nothing doubles.
  const existingShifts = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      startTime: { gte: new Date(weekStartMs), lt: new Date(weekEndMs) },
    },
    select: { userId: true, startTime: true, endTime: true },
  });
  const existingKey = new Set(
    existingShifts.map((s) => `${s.userId || '_'}|${s.startTime.toISOString()}`)
  );

  // Pull approved time-off that overlaps this week so we can skip rules for
  // users who are off. Index by userId for fast lookup inside the loop.
  const userIds = [...new Set(rules.map((r) => r.userId).filter(Boolean))];
  const timeOff = userIds.length
    ? await prisma.timeOffRequest.findMany({
        where: {
          userId: { in: userIds },
          status: 'APPROVED',
          startDate: { lte: new Date(weekEndMs) },
          endDate: { gte: new Date(weekStartMs) },
        },
        select: { userId: true, startDate: true, endDate: true },
      })
    : [];
  const timeOffByUser = new Map();
  for (const t of timeOff) {
    const list = timeOffByUser.get(t.userId) || [];
    list.push({ start: new Date(t.startDate).setHours(0, 0, 0, 0), end: new Date(t.endDate).setHours(23, 59, 59, 999) });
    timeOffByUser.set(t.userId, list);
  }
  const isOnTimeOff = (userId, dayMs) => {
    const ranges = timeOffByUser.get(userId);
    if (!ranges) return false;
    return ranges.some((r) => dayMs >= r.start && dayMs <= r.end);
  };

  // Fetch holidays in this week so recurring shifts skip holiday dates
  const holidayDates = await getHolidayDateSet(req.user.organizationId, new Date(weekStartMs), new Date(weekEndMs));

  // Schedule grid uses Monday as index 0; RecurringShift.dayOfWeek is
  // 0=Sun..6=Sat. Map each rule's dayOfWeek to a Monday-based offset.
  const mondayOffset = (dow) => (dow === 0 ? 6 : dow - 1);

  const toCreate = [];
  const skipped = [];
  for (const r of rules) {
    const offset = mondayOffset(r.dayOfWeek);
    const day = new Date(weekStartMs + offset * 24 * 3600 * 1000);

    // Enforce validFrom/validUntil at day granularity.
    if (r.validFrom && day < new Date(new Date(r.validFrom).setHours(0, 0, 0, 0))) {
      skipped.push({ ruleId: r.id, reason: 'before validFrom' });
      continue;
    }
    if (r.validUntil && day > new Date(new Date(r.validUntil).setHours(23, 59, 59, 999))) {
      skipped.push({ ruleId: r.id, reason: 'after validUntil' });
      continue;
    }

    // Skip if this rule's user has approved time-off covering that day.
    if (r.userId && isOnTimeOff(r.userId, day.getTime())) {
      skipped.push({ ruleId: r.id, reason: 'user on time-off' });
      continue;
    }

    // Skip if this day is a holiday
    const dayKey = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
    if (holidayDates.has(dayKey)) {
      skipped.push({ ruleId: r.id, reason: 'holiday' });
      continue;
    }

    const [sh, sm] = r.startTime.split(':').map(Number);
    const [eh, em] = r.endTime.split(':').map(Number);
    const start = new Date(day);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(day);
    end.setHours(eh, em, 0, 0);
    // Overnight shifts: if end <= start, roll end to next day.
    if (end <= start) end.setDate(end.getDate() + 1);

    const key = `${r.userId || '_'}|${start.toISOString()}`;
    if (existingKey.has(key)) {
      skipped.push({ ruleId: r.id, reason: 'already scheduled' });
      continue;
    }

    toCreate.push({
      organizationId: req.user.organizationId,
      userId: r.userId || null,
      positionId: r.positionId || null,
      locationId: r.locationId || null,
      startTime: start,
      endTime: end,
      notes: r.notes,
      status: 'DRAFT',
    });
    existingKey.add(key); // guard against two rules for the same slot in one request
  }

  if (toCreate.length > 0) {
    await prisma.shift.createMany({ data: toCreate });
  }

  res.json({ created: toCreate.length, skipped: skipped.length, skippedDetails: skipped });
});

module.exports = router;
