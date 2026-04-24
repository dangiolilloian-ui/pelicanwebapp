const prisma = require('../config/db');

/**
 * Find the right managers to notify for a given employee or shift context.
 *
 * New (Department-aware) strategy:
 *   1. Resolve (positionIds, locationIds) for the subject (employee or shift).
 *   2. Find Departments where `locationId` is in locationIds AND at least one
 *      position overlaps with positionIds. Collect every dept's managers.
 *   3. Also collect store-managers whose managedLocations intersect
 *      locationIds (they have full-store authority at that location).
 *   4. If nothing found, fall back to all OWNERs so the notification never
 *      silently disappears.
 *   5. Always exclude `excludeUserId` (the triggering employee).
 *
 * @param {string} organizationId
 * @param {object} opts
 * @param {string} [opts.employeeId] — employee triggering the notification
 * @param {string[]} [opts.positionIds] — explicit position IDs (e.g. from a shift)
 * @param {string[]} [opts.locationIds] — explicit location IDs (e.g. from a shift)
 * @param {string} [opts.excludeUserId] — user to exclude from results
 * @returns {Promise<string[]>} array of user IDs to notify
 */
async function getDeptManagers(organizationId, opts = {}) {
  const { employeeId, positionIds, locationIds, excludeUserId } = opts;

  let posIds = positionIds || [];
  let locIds = locationIds || [];

  if (employeeId && posIds.length === 0 && locIds.length === 0) {
    const emp = await prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        positions: { select: { id: true } },
        locations: { select: { id: true } },
      },
    });
    if (emp) {
      posIds = emp.positions.map((p) => p.id);
      locIds = emp.locations.map((l) => l.id);
    }
  }

  const managerSet = new Set();

  // Dept managers: a Department covers this context only if both its
  // location and at least one of its positions overlap with the subject.
  if (locIds.length > 0) {
    const depts = await prisma.department.findMany({
      where: {
        organizationId,
        locationId: { in: locIds },
        ...(posIds.length > 0
          ? { positions: { some: { id: { in: posIds } } } }
          : {}),
      },
      select: { managers: { select: { id: true, isActive: true } } },
    });
    for (const d of depts) {
      for (const m of d.managers) {
        if (m.isActive) managerSet.add(m.id);
      }
    }
  }

  // Store managers at any of the relevant locations.
  if (locIds.length > 0) {
    const storeMgrs = await prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
        isActive: true,
        isStoreManager: true,
        managedLocations: { some: { id: { in: locIds } } },
      },
      select: { id: true },
    });
    for (const m of storeMgrs) managerSet.add(m.id);
  }

  // Fallback: if nobody's assigned, notify all OWNERs.
  if (managerSet.size === 0) {
    const owners = await prisma.user.findMany({
      where: { organizationId, role: 'OWNER', isActive: true },
      select: { id: true },
    });
    for (const o of owners) managerSet.add(o.id);
  }

  if (excludeUserId) managerSet.delete(excludeUserId);
  return [...managerSet];
}

module.exports = { getDeptManagers };
