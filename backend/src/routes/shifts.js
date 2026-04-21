const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { computeCoverageGaps } = require('../lib/coverage');
const { notifyMany, notify } = require('../lib/notify');
const { checkAvailability } = require('../lib/availabilityCheck');
const { overtimeWarnings } = require('../lib/weeklyHours');
const { getHolidayOnDate, getHolidayDateSet } = require('../lib/holidays');
const { shiftAccessFilter, canAccessLocation } = require('../lib/locationAccess');

const router = Router();

// List shifts for the org (with date range filter)
// - OWNER: sees all shifts
// - ADMIN/MANAGER: sees shifts at their assigned locations
// - EMPLOYEE: sees only their own shifts
router.get('/', authenticate, async (req, res) => {
  const { start, end } = req.query;
  const where = await shiftAccessFilter(req.user);

  if (start && end) {
    where.startTime = { gte: new Date(start), lte: new Date(end) };
  }

  const shifts = await prisma.shift.findMany({
    where,
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  res.json(shifts);
});

// Create shift
router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { startTime, endTime, notes, userId, positionId, locationId } = req.body;

  // Enforce location access — managers/admins can only create shifts at their locations
  if (!(await canAccessLocation(req.user, locationId))) {
    return res.status(403).json({ error: 'You do not have access to this location' });
  }

  // Block scheduling on holidays
  const holiday = await getHolidayOnDate(req.user.organizationId, startTime);
  if (holiday) {
    return res.status(400).json({ error: `Cannot schedule on ${holiday.name} (holiday)` });
  }

  const shift = await prisma.shift.create({
    data: {
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      notes,
      organizationId: req.user.organizationId,
      userId: userId || null,
      positionId: positionId || null,
      locationId: locationId || null,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
    },
  });

  const [avail, ot] = await Promise.all([
    checkAvailability({ userId: shift.userId, startTime, endTime }),
    overtimeWarnings({ userId: shift.userId, startTime, endTime }),
  ]);
  const assignedName = shift.user ? `${shift.user.firstName} ${shift.user.lastName}` : 'unassigned';
  await audit(req, 'SHIFT_CREATE', 'SHIFT', shift.id,
    `Created shift for ${assignedName} on ${new Date(shift.startTime).toLocaleString()}`,
    { userId: shift.userId, startTime: shift.startTime, endTime: shift.endTime });
  res.status(201).json({ ...shift, _warnings: [...avail, ...ot] });
});

// Update shift
router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { startTime, endTime, notes, status, userId, positionId, locationId } = req.body;

  // Enforce location access on the existing shift
  const existing = await prisma.shift.findUnique({ where: { id: req.params.id }, select: { locationId: true, organizationId: true } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (!(await canAccessLocation(req.user, existing.locationId))) {
    return res.status(403).json({ error: 'You do not have access to this location' });
  }
  // Also check the new location if they're moving the shift
  if (locationId !== undefined && locationId !== existing.locationId) {
    if (!(await canAccessLocation(req.user, locationId))) {
      return res.status(403).json({ error: 'You do not have access to the target location' });
    }
  }

  // If the start time is changing, check the new date isn't a holiday
  if (startTime) {
    const holiday = await getHolidayOnDate(req.user.organizationId, startTime);
    if (holiday) {
      return res.status(400).json({ error: `Cannot schedule on ${holiday.name} (holiday)` });
    }
  }

  const before = await prisma.shift.findUnique({ where: { id: req.params.id }, select: { userId: true, startTime: true, endTime: true, status: true } });
  const shift = await prisma.shift.update({
    where: { id: req.params.id },
    data: {
      ...(startTime && { startTime: new Date(startTime) }),
      ...(endTime && { endTime: new Date(endTime) }),
      ...(notes !== undefined && { notes }),
      ...(status && { status }),
      ...(userId !== undefined && { userId: userId || null }),
      ...(positionId !== undefined && { positionId: positionId || null }),
      ...(locationId !== undefined && { locationId: locationId || null }),
      // Any meaningful change requires the employee to re-confirm
      ...((startTime || endTime || userId !== undefined) && { confirmedAt: null }),
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
    },
  });

  const [avail, ot] = await Promise.all([
    checkAvailability({
      userId: shift.userId,
      startTime: shift.startTime,
      endTime: shift.endTime,
    }),
    overtimeWarnings({
      userId: shift.userId,
      startTime: shift.startTime,
      endTime: shift.endTime,
      excludeShiftId: shift.id,
    }),
  ]);
  await audit(req, 'SHIFT_UPDATE', 'SHIFT', shift.id,
    `Updated shift ${shift.id.slice(0,8)}`,
    { before, after: { userId: shift.userId, startTime: shift.startTime, endTime: shift.endTime, status: shift.status } });

  // ── Notify affected employees about the change ──────────────────
  const [manager, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }),
    prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } }),
  ]);
  const managerName = manager ? `${manager.firstName} ${manager.lastName}` : 'A manager';
  const tz = org?.timezone || 'America/New_York';
  const shiftDate = new Date(shift.startTime).toLocaleDateString('en-US', { timeZone: tz });
  const shiftTime = `${new Date(shift.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })} – ${new Date(shift.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;

  // If the shift was reassigned to a different person
  if (before.userId && shift.userId && before.userId !== shift.userId) {
    // Notify the old employee their shift was removed
    await notify(before.userId, {
      type: 'SHIFT_UPDATED',
      title: 'Shift removed',
      body: `${managerName} removed your shift on ${shiftDate}.`,
      link: '/dashboard/schedule',
    });
    // Notify the new employee they were assigned
    await notify(shift.userId, {
      type: 'SHIFT_UPDATED',
      title: 'New shift assigned',
      body: `${managerName} assigned you a shift on ${shiftDate} (${shiftTime}).`,
      link: '/dashboard/schedule',
    });
  } else if (!before.userId && shift.userId) {
    // Shift was unassigned, now assigned to someone
    await notify(shift.userId, {
      type: 'SHIFT_UPDATED',
      title: 'New shift assigned',
      body: `${managerName} assigned you a shift on ${shiftDate} (${shiftTime}).`,
      link: '/dashboard/schedule',
    });
  } else if (before.userId && !shift.userId) {
    // Shift was assigned, now unassigned
    await notify(before.userId, {
      type: 'SHIFT_UPDATED',
      title: 'Shift removed',
      body: `${managerName} removed your shift on ${shiftDate}.`,
      link: '/dashboard/schedule',
    });
  } else if (shift.userId) {
    // Same person, but time or status changed
    const timeChanged = before.startTime?.getTime() !== shift.startTime.getTime() ||
                        before.endTime?.getTime() !== shift.endTime.getTime();
    if (timeChanged) {
      await notify(shift.userId, {
        type: 'SHIFT_UPDATED',
        title: 'Shift time changed',
        body: `${managerName} updated your shift to ${shiftDate} (${shiftTime}).`,
        link: '/dashboard/schedule',
      });
    }
  }

  res.json({ ...shift, _warnings: [...avail, ...ot] });
});

// Delete shift
router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const before = await prisma.shift.findUnique({ where: { id: req.params.id }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!before || before.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (!(await canAccessLocation(req.user, before.locationId))) {
    return res.status(403).json({ error: 'You do not have access to this location' });
  }
  await prisma.shift.delete({ where: { id: req.params.id } });
  if (before) {
    const who = before.user ? `${before.user.firstName} ${before.user.lastName}` : 'unassigned';
    await audit(req, 'SHIFT_DELETE', 'SHIFT', req.params.id,
      `Deleted shift for ${who} on ${new Date(before.startTime).toLocaleString()}`,
      { userId: before.userId, startTime: before.startTime, endTime: before.endTime });
  }
  res.status(204).end();
});

// Copy shifts from one week to another
router.post('/copy-week', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { sourceStart, sourceEnd, targetStart } = req.body;

  // Only copy shifts the user has location access to
  const accessFilter = await shiftAccessFilter(req.user);
  const sourceShifts = await prisma.shift.findMany({
    where: {
      ...accessFilter,
      startTime: { gte: new Date(sourceStart), lte: new Date(sourceEnd) },
    },
  });

  const sourceMon = new Date(sourceStart).getTime();
  const targetMon = new Date(targetStart).getTime();
  const offset = targetMon - sourceMon;

  // Get holidays in the target week so we can skip them
  const targetEnd = new Date(targetMon + 7 * 24 * 3600 * 1000);
  const holidayDates = await getHolidayDateSet(req.user.organizationId, new Date(targetMon), targetEnd);

  const toCreate = sourceShifts.filter((s) => {
    const newStart = new Date(s.startTime.getTime() + offset);
    const key = `${newStart.getUTCFullYear()}-${String(newStart.getUTCMonth() + 1).padStart(2, '0')}-${String(newStart.getUTCDate()).padStart(2, '0')}`;
    return !holidayDates.has(key);
  });

  const created = await Promise.all(
    toCreate.map((s) =>
      prisma.shift.create({
        data: {
          startTime: new Date(s.startTime.getTime() + offset),
          endTime: new Date(s.endTime.getTime() + offset),
          notes: s.notes,
          status: 'DRAFT',
          organizationId: s.organizationId,
          userId: s.userId,
          positionId: s.positionId,
          locationId: s.locationId,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          position: { select: { id: true, name: true, color: true, hourlyRate: true } },
          location: { select: { id: true, name: true } },
        },
      })
    )
  );

  res.status(201).json(created);
});

// Bulk delete shifts by IDs
router.post('/bulk-delete', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const accessFilter = await shiftAccessFilter(req.user);
  const result = await prisma.shift.deleteMany({
    where: { ...accessFilter, id: { in: ids } },
  });
  res.json({ deleted: result.count });
});

// Bulk reassign shifts to a user
router.post('/bulk-assign', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { ids, userId } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const accessFilter = await shiftAccessFilter(req.user);
  const result = await prisma.shift.updateMany({
    where: { ...accessFilter, id: { in: ids } },
    data: { userId: userId || null },
  });
  res.json({ updated: result.count });
});

// Bulk publish shifts by IDs
router.post('/bulk-publish', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const accessFilter = await shiftAccessFilter(req.user);
  const result = await prisma.shift.updateMany({
    where: { ...accessFilter, id: { in: ids }, status: 'DRAFT' },
    data: { status: 'PUBLISHED' },
  });
  res.json({ published: result.count });
});

// Publish shifts for a date range
router.post('/publish', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { start, end } = req.body;

  const accessFilter = await shiftAccessFilter(req.user);
  const publishWhere = {
    ...accessFilter,
    status: 'DRAFT',
    startTime: { gte: new Date(start), lte: new Date(end) },
  };

  const toPublish = await prisma.shift.findMany({
    where: publishWhere,
    select: { userId: true },
  });

  await prisma.shift.updateMany({
    where: publishWhere,
    data: { status: 'PUBLISHED', confirmedAt: null },
  });

  // Notify each affected employee once
  const affected = [...new Set(toPublish.map((s) => s.userId).filter(Boolean))];
  await notifyMany(affected, {
    type: 'SHIFT_PUBLISHED',
    title: 'New schedule published',
    body: 'Your shifts for the week are now live.',
    link: '/dashboard/schedule',
  });

  // Re-check coverage against the now-published week so the UI can warn
  // the manager about any slots still short on staff. Runtime-only (no
  // drafts) since DRAFT shifts were just promoted.
  const coverageGaps = await computeCoverageGaps({
    organizationId: req.user.organizationId,
    rangeStart: new Date(start),
    rangeEnd: new Date(end),
    includeDrafts: false,
  });

  res.json({ message: 'Shifts published', count: toPublish.length, coverageGaps });
});

// ---------- Shift confirmation ----------
// Employee acknowledges they'll work a shift
router.post('/:id/confirm', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }
  if (shift.status !== 'PUBLISHED') {
    return res.status(400).json({ error: 'Only published shifts can be confirmed' });
  }
  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { confirmedAt: new Date() },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
    },
  });
  res.json(updated);
});

// Return the checklist items that apply to this shift (all templates matching
// the shift's location, plus org-wide templates) with per-item completion
// state scoped to this shift. Visible to the assigned employee and to managers.
router.get('/:id/checklist', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  const isManager = req.user.role === 'OWNER' || req.user.role === 'ADMIN' || req.user.role === 'MANAGER';
  if (!isManager && shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }

  const templates = await prisma.checklistTemplate.findMany({
    where: {
      organizationId: req.user.organizationId,
      OR: [{ locationId: null }, { locationId: shift.locationId || undefined }],
    },
    include: { items: { orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  const allItemIds = templates.flatMap((t) => t.items.map((i) => i.id));
  const completions = allItemIds.length
    ? await prisma.checklistCompletion.findMany({
        where: { shiftId: shift.id, itemId: { in: allItemIds } },
      })
    : [];
  const done = new Map(completions.map((c) => [c.itemId, c]));

  res.json(
    templates.map((t) => ({
      id: t.id,
      name: t.name,
      locationId: t.locationId,
      items: t.items.map((i) => {
        const c = done.get(i.id);
        return {
          id: i.id,
          label: i.label,
          position: i.position,
          completedAt: c ? c.completedAt : null,
          completedByUserId: c ? c.userId : null,
        };
      }),
    }))
  );
});

// Mark an item done on this shift. Unique (itemId, shiftId) prevents doubles
// — a second tap just updates the existing completion to the latest user.
router.post('/:id/checklist/:itemId', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  const isManager = req.user.role === 'OWNER' || req.user.role === 'ADMIN' || req.user.role === 'MANAGER';
  if (!isManager && shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }
  // Validate item belongs to a template in the same org.
  const item = await prisma.checklistItem.findUnique({
    where: { id: req.params.itemId },
    include: { template: { select: { organizationId: true } } },
  });
  if (!item || item.template.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const completion = await prisma.checklistCompletion.upsert({
    where: { itemId_shiftId: { itemId: item.id, shiftId: shift.id } },
    update: { userId: req.user.id, completedAt: new Date() },
    create: { itemId: item.id, shiftId: shift.id, userId: req.user.id },
  });
  res.json(completion);
});

router.delete('/:id/checklist/:itemId', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  const isManager = req.user.role === 'OWNER' || req.user.role === 'ADMIN' || req.user.role === 'MANAGER';
  if (!isManager && shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }
  await prisma.checklistCompletion.deleteMany({
    where: { itemId: req.params.itemId, shiftId: shift.id },
  });
  res.status(204).end();
});

// Return the most recent handoff note for the same location that was written
// for a shift ending before this one starts. Used by the employee "next shift"
// hero card so openers walk in knowing what closing left behind.
router.get('/:id/previous-handoff', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  // Only the assigned employee or a manager should see handoff notes.
  const isManager = req.user.role === 'OWNER' || req.user.role === 'ADMIN' || req.user.role === 'MANAGER';
  if (!isManager && shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }
  if (!shift.locationId) return res.json({ handoff: null });

  const prior = await prisma.shift.findFirst({
    where: {
      organizationId: req.user.organizationId,
      locationId: shift.locationId,
      endTime: { lte: shift.startTime },
      handoffNote: { not: null },
      id: { not: shift.id },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { endTime: 'desc' },
  });

  if (!prior) return res.json({ handoff: null });
  res.json({
    handoff: {
      shiftId: prior.id,
      note: prior.handoffNote,
      author: prior.user ? `${prior.user.firstName} ${prior.user.lastName}` : null,
      endTime: prior.endTime,
    },
  });
});

// Employee gives up a shift. It becomes unassigned (open) and managers are
// notified so they can reassign or let someone claim it from the marketplace.
router.post('/:id/drop', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({
    where: { id: req.params.id },
    include: { position: { select: { name: true } }, location: { select: { name: true } } },
  });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'Not your shift' });
  }
  if (shift.status !== 'PUBLISHED') {
    return res.status(400).json({ error: 'Only published shifts can be dropped' });
  }
  // Block late drops — once a shift is <2h away the manager should handle it manually.
  const leadMs = shift.startTime.getTime() - Date.now();
  if (leadMs < 2 * 3600 * 1000) {
    return res.status(400).json({ error: 'Too late to drop — contact your manager' });
  }

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: { userId: null, confirmedAt: null },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
    },
  });

  // Notify all managers in the org.
  const managers = await prisma.user.findMany({
    where: {
      organizationId: req.user.organizationId,
      role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
    },
    select: { id: true },
  });
  if (managers.length > 0) {
    const dropOrg = await prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } });
    const dropTz = dropOrg?.timezone || 'America/New_York';
    const dropUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } });
    const dropName = dropUser ? `${dropUser.firstName} ${dropUser.lastName}` : 'An employee';
    const when = shift.startTime.toLocaleString('en-US', { timeZone: dropTz });
    const label = [shift.position?.name, shift.location?.name].filter(Boolean).join(' @ ') || 'Shift';
    await notifyMany(managers.map((m) => m.id), {
      type: 'SHIFT_DROPPED',
      title: `${dropName} dropped a shift`,
      body: `${label} — ${when}`,
      link: '/dashboard/schedule',
    });
  }

  res.json(updated);
});

// ---------- Open shifts marketplace ----------
// List unassigned published shifts in a date range (scoped by location access)
router.get('/open', authenticate, async (req, res) => {
  const { start, end } = req.query;
  const accessFilter = await shiftAccessFilter(req.user);
  const where = {
    ...accessFilter,
    status: 'PUBLISHED',
    userId: null,
  };
  if (start && end) where.startTime = { gte: new Date(start), lte: new Date(end) };
  const shifts = await prisma.shift.findMany({
    where,
    include: {
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true } },
      claims: {
        where: { status: 'PENDING' },
        select: { id: true, userId: true, user: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: { startTime: 'asc' },
  });
  res.json(shifts);
});

// Employee requests to claim an open shift
router.post('/:id/claim', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (shift.userId) {
    return res.status(400).json({ error: 'Shift is already assigned' });
  }
  if (shift.status !== 'PUBLISHED') {
    return res.status(400).json({ error: 'Only published open shifts can be claimed' });
  }

  try {
    const claim = await prisma.shiftClaim.create({
      data: { shiftId: shift.id, userId: req.user.id },
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    // Notify managers
    const claimOrg = await prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } });
    const claimTz = claimOrg?.timezone || 'America/New_York';
    const managers = await prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
      },
      select: { id: true },
    });
    await notifyMany(
      managers.map((m) => m.id),
      {
        type: 'SHIFT_CLAIM',
        title: `${claim.user.firstName} ${claim.user.lastName} wants an open shift`,
        body: `Requested ${new Date(shift.startTime).toLocaleString('en-US', { timeZone: claimTz })}`,
        link: '/dashboard/schedule',
      }
    );

    res.status(201).json(claim);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'You already requested this shift' });
    }
    throw err;
  }
});

// Manager approves a claim — assigns the shift to that user and denies the rest
router.post('/claims/:claimId/approve', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const claim = await prisma.shiftClaim.findUnique({
    where: { id: req.params.claimId },
    include: { shift: true },
  });
  if (!claim || claim.shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Claim not found' });
  }
  if (claim.shift.userId) {
    return res.status(400).json({ error: 'Shift already assigned' });
  }

  await prisma.$transaction([
    prisma.shift.update({
      where: { id: claim.shiftId },
      data: { userId: claim.userId, confirmedAt: null },
    }),
    prisma.shiftClaim.update({
      where: { id: claim.id },
      data: { status: 'APPROVED' },
    }),
    prisma.shiftClaim.updateMany({
      where: { shiftId: claim.shiftId, id: { not: claim.id }, status: 'PENDING' },
      data: { status: 'DENIED' },
    }),
  ]);

  const approveOrg = await prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } });
  const approveTz = approveOrg?.timezone || 'America/New_York';
  await notify(claim.userId, {
    type: 'SHIFT_CLAIM',
    title: 'Your open-shift request was approved',
    body: `You've been assigned the shift starting ${new Date(claim.shift.startTime).toLocaleString('en-US', { timeZone: approveTz })}.`,
    link: '/dashboard/schedule',
  });

  res.json({ ok: true });
});

// Manager denies a single claim
router.post('/claims/:claimId/deny', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const claim = await prisma.shiftClaim.findUnique({
    where: { id: req.params.claimId },
    include: { shift: { select: { organizationId: true, startTime: true } } },
  });
  if (!claim || claim.shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Claim not found' });
  }
  await prisma.shiftClaim.update({
    where: { id: claim.id },
    data: { status: 'DENIED' },
  });
  const denyOrg = await prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } });
  const denyTz = denyOrg?.timezone || 'America/New_York';
  await notify(claim.userId, {
    type: 'SHIFT_CLAIM',
    title: 'Your open-shift request was denied',
    body: `Shift on ${new Date(claim.shift.startTime).toLocaleString('en-US', { timeZone: denyTz })}.`,
    link: '/dashboard/open-shifts',
  });
  res.json({ ok: true });
});

// Employee cancels their own pending claim
router.post('/claims/:claimId/cancel', authenticate, async (req, res) => {
  const claim = await prisma.shiftClaim.findUnique({
    where: { id: req.params.claimId },
  });
  if (!claim || claim.userId !== req.user.id) {
    return res.status(404).json({ error: 'Claim not found' });
  }
  await prisma.shiftClaim.update({
    where: { id: claim.id },
    data: { status: 'CANCELLED' },
  });
  res.json({ ok: true });
});

// ─── "Who can cover this shift?" ──────────────────────────────────
// Returns a ranked list of employees who could plausibly cover a given
// shift based on: not already scheduled at that time, not on approved
// time off, declared availability allows it, and (optionally) holds the
// same position. Managers use this when scrambling for a last-minute
// fill-in instead of scrolling the roster.
router.get('/:id/candidates', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const shift = await prisma.shift.findUnique({
    where: { id: req.params.id },
    include: { position: true },
  });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }

  const start = new Date(shift.startTime);
  const end = new Date(shift.endTime);
  const dayOfWeek = start.getDay();

  // 1. All employees in the org
  const employees = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId, role: 'EMPLOYEE' },
    select: { id: true, firstName: true, lastName: true, weeklyHoursCap: true },
  });

  // 2. Who already has a shift overlapping this window?
  const overlapping = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      userId: { not: null },
      startTime: { lt: end },
      endTime: { gt: start },
      id: { not: shift.id },
    },
    select: { userId: true },
  });
  const busyIds = new Set(overlapping.map((s) => s.userId));

  // 3. Who has approved time off covering this day?
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const timeOff = await prisma.timeOffRequest.findMany({
    where: {
      status: 'APPROVED',
      startDate: { lt: dayEnd },
      endDate: { gt: dayStart },
      user: { organizationId: req.user.organizationId },
    },
    select: { userId: true },
  });
  const offIds = new Set(timeOff.map((t) => t.userId));

  // 4. Availability entries for this day of week
  const availEntries = await prisma.availability.findMany({
    where: {
      userId: { in: employees.map((e) => e.id) },
      dayOfWeek,
    },
  });
  const availByUser = new Map();
  for (const a of availEntries) {
    if (!availByUser.has(a.userId)) availByUser.set(a.userId, []);
    availByUser.get(a.userId).push(a);
  }

  // 5. Weekly hours already scheduled (to flag overtime risk)
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekShifts = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      userId: { not: null },
      startTime: { gte: weekStart, lt: weekEnd },
    },
    select: { userId: true, startTime: true, endTime: true },
  });
  const weekHoursMap = new Map();
  for (const s of weekShifts) {
    const h = (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
    weekHoursMap.set(s.userId, (weekHoursMap.get(s.userId) || 0) + h);
  }

  const shiftHours = (end - start) / 3600000;
  const shiftStartMin = start.getHours() * 60 + start.getMinutes();
  const shiftEndMin = end.getHours() * 60 + end.getMinutes();

  const candidates = [];
  for (const emp of employees) {
    // Skip the currently assigned person
    if (emp.id === shift.userId) continue;
    if (busyIds.has(emp.id)) continue;
    if (offIds.has(emp.id)) continue;

    // Check availability
    const entries = availByUser.get(emp.id) || [];
    let availStatus = 'unknown'; // no declared availability
    if (entries.length > 0) {
      const markedUnavailable = entries.some((e) => !e.available);
      if (markedUnavailable) continue; // hard skip
      const covered = entries.some((e) => {
        const [sh, sm] = e.startTime.split(':').map(Number);
        const [eh, em] = e.endTime.split(':').map(Number);
        return sh * 60 + sm <= shiftStartMin && eh * 60 + em >= shiftEndMin;
      });
      availStatus = covered ? 'available' : 'partial';
    }

    const weekHours = weekHoursMap.get(emp.id) || 0;
    const projectedHours = weekHours + shiftHours;
    const overCap = emp.weeklyHoursCap && projectedHours > emp.weeklyHoursCap;

    candidates.push({
      userId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      availability: availStatus,
      weekHours: Math.round(weekHours * 10) / 10,
      projectedHours: Math.round(projectedHours * 10) / 10,
      overtime: projectedHours > 40,
      overCap: !!overCap,
    });
  }

  // Sort: available first, then partial, then unknown. Within each group,
  // lower weekHours first (spread work evenly).
  const order = { available: 0, partial: 1, unknown: 2 };
  candidates.sort((a, b) => {
    const d = (order[a.availability] ?? 9) - (order[b.availability] ?? 9);
    if (d !== 0) return d;
    return a.weekHours - b.weekHours;
  });

  res.json({
    shift: {
      id: shift.id,
      startTime: shift.startTime,
      endTime: shift.endTime,
      positionName: shift.position?.name || null,
      positionColor: shift.position?.color || null,
    },
    candidates,
  });
});

module.exports = router;
