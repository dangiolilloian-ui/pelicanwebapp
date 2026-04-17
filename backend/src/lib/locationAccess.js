const prisma = require('../config/db');

/**
 * Get the location IDs the current user has access to.
 * - OWNER: returns null (meaning all locations — no filtering needed)
 * - ADMIN/MANAGER/EMPLOYEE: returns array of their assigned location IDs
 */
async function getUserLocationIds(user) {
  if (user.role === 'OWNER') return null; // no restriction

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { locations: { select: { id: true } } },
  });

  return dbUser?.locations.map((l) => l.id) || [];
}

/**
 * Build a Prisma `where` clause for shifts based on the user's role and locations.
 * - OWNER: sees all shifts in the org
 * - ADMIN/MANAGER: sees shifts at their assigned locations (+ unassigned-location shifts)
 * - EMPLOYEE: sees shifts at their assigned locations (+ their own shifts regardless of location)
 */
async function shiftAccessFilter(user) {
  const base = { organizationId: user.organizationId };

  if (user.role === 'OWNER') return base;

  if (user.role === 'ADMIN' || user.role === 'MANAGER') {
    const locationIds = await getUserLocationIds(user);
    if (locationIds === null) return base;
    // Managers/admins see shifts at their locations + shifts with no location
    return {
      ...base,
      OR: [
        { locationId: { in: locationIds } },
        { locationId: null },
      ],
    };
  }

  // EMPLOYEE: sees all shifts at their assigned locations
  const empLocationIds = await getUserLocationIds(user);
  if (!empLocationIds || empLocationIds.length === 0) {
    // No locations assigned — fall back to only their own shifts
    return { ...base, userId: user.id };
  }
  return {
    ...base,
    OR: [
      { locationId: { in: empLocationIds } },
      { userId: user.id }, // always see your own shifts even if no location set
    ],
  };
}

/**
 * Check if a manager/admin has access to a specific location.
 * Owners always have access. Employees don't use this check.
 */
async function canAccessLocation(user, locationId) {
  if (user.role === 'OWNER') return true;
  if (!locationId) return true; // null location = org-wide, anyone can access

  const locationIds = await getUserLocationIds(user);
  if (locationIds === null) return true;
  return locationIds.includes(locationId);
}

module.exports = { getUserLocationIds, shiftAccessFilter, canAccessLocation };
