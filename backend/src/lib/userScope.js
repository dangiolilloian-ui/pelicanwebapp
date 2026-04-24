const prisma = require('../config/db');

/**
 * Can `requester` perform a privileged action (deactivate, reactivate, remove)
 * on `target`? Centralized so every endpoint enforces the same rule and we
 * don't have drift between "can deactivate" and "can delete".
 *
 * Rules:
 *   - Cross-org actions: never allowed.
 *   - Self-actions: never allowed (a user can't deactivate or delete themself).
 *   - Removing/deactivating the last remaining OWNER: never allowed.
 *   - OWNER: can act on anyone in the org.
 *   - ADMIN: can act on anyone in the org EXCEPT an OWNER.
 *   - MANAGER: can only act on EMPLOYEEs whose `locations` overlap with the
 *     manager's own `managedLocations` (i.e. the employee works in a store
 *     the manager is responsible for).
 *   - EMPLOYEE: can never act.
 *
 * Returns { ok: true, target } on success, { ok: false, status, error } on
 * failure so the caller can bubble the right HTTP code.
 */
async function canManageTarget(requesterPayload, targetId) {
  const [requester, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: requesterPayload.id },
      select: {
        id: true,
        role: true,
        organizationId: true,
        managedLocations: { select: { id: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        role: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
        locations: { select: { id: true } },
      },
    }),
  ]);

  if (!requester) return { ok: false, status: 401, error: 'Requester not found' };
  if (!target) return { ok: false, status: 404, error: 'User not found' };
  if (requester.organizationId !== target.organizationId) {
    return { ok: false, status: 404, error: 'User not found' };
  }
  if (requester.id === target.id) {
    return { ok: false, status: 400, error: "You can't do that to your own account" };
  }

  // Never let the org lose its last OWNER — neither via delete nor deactivate.
  if (target.role === 'OWNER') {
    const otherOwners = await prisma.user.count({
      where: {
        organizationId: target.organizationId,
        role: 'OWNER',
        isActive: true,
        NOT: { id: target.id },
      },
    });
    if (otherOwners === 0) {
      return { ok: false, status: 400, error: 'Cannot remove or deactivate the last owner' };
    }
  }

  if (requester.role === 'OWNER') return { ok: true, target };

  if (requester.role === 'ADMIN') {
    if (target.role === 'OWNER') {
      return { ok: false, status: 403, error: 'Admins cannot act on the owner' };
    }
    return { ok: true, target };
  }

  if (requester.role === 'MANAGER') {
    if (target.role !== 'EMPLOYEE') {
      return {
        ok: false,
        status: 403,
        error: 'Managers can only deactivate or remove employees',
      };
    }
    const requesterLocs = new Set(requester.managedLocations.map((l) => l.id));
    if (requesterLocs.size === 0) {
      return {
        ok: false,
        status: 403,
        error: 'You are not assigned to any departments',
      };
    }
    const overlap = target.locations.some((l) => requesterLocs.has(l.id));
    if (!overlap) {
      return {
        ok: false,
        status: 403,
        error: 'This employee is not in one of your departments',
      };
    }
    return { ok: true, target };
  }

  return { ok: false, status: 403, error: 'Insufficient permissions' };
}

module.exports = { canManageTarget };
