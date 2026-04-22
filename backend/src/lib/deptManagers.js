const prisma = require('../config/db');

/**
 * Find the right managers to notify for a given employee or shift context.
 *
 * Strategy:
 * 1. Look up which positions/locations the employee belongs to.
 * 2. Find managers assigned to any of those positions or locations.
 * 3. If no department managers are found, fall back to all OWNER users.
 * 4. Always exclude `excludeUserId` (the employee themselves).
 *
 * @param {string} organizationId
 * @param {object} opts
 * @param {string} [opts.employeeId] — the employee triggering the notification
 * @param {string[]} [opts.positionIds] — explicit position IDs (e.g. from a shift)
 * @param {string[]} [opts.locationIds] — explicit location IDs (e.g. from a shift)
 * @param {string} [opts.excludeUserId] — user to exclude from results
 * @returns {Promise<string[]>} array of user IDs to notify
 */
async function getDeptManagers(organizationId, opts = {}) {
  const { employeeId, positionIds, locationIds, excludeUserId } = opts;

  // If explicit position/location IDs weren't passed, look them up from the employee
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

  // Find managers assigned to any of these positions or locations
  const managerSet = new Set();

  if (posIds.length > 0) {
    const posMgrs = await prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
        managedPositions: { some: { id: { in: posIds } } },
      },
      select: { id: true },
    });
    for (const m of posMgrs) managerSet.add(m.id);
  }

  if (locIds.length > 0) {
    const locMgrs = await prisma.user.findMany({
      where: {
        organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
        managedLocations: { some: { id: { in: locIds } } },
      },
      select: { id: true },
    });
    for (const m of locMgrs) managerSet.add(m.id);
  }

  // Fallback: if no department managers found, notify all OWNERs
  if (managerSet.size === 0) {
    const owners = await prisma.user.findMany({
      where: { organizationId, role: 'OWNER' },
      select: { id: true },
    });
    for (const o of owners) managerSet.add(o.id);
  }

  // Exclude the triggering user
  if (excludeUserId) managerSet.delete(excludeUserId);

  return [...managerSet];
}

module.exports = { getDeptManagers };
