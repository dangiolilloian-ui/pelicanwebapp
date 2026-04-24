const prisma = require('../config/db');

/**
 * Manager Scope
 * =============
 *
 * Central helper that answers "what can this manager see/act on?" once, so
 * every route — live roster, dashboard, approvals, attendance, notifications —
 * enforces the same rule without copy-pasting the branch logic.
 *
 * Four kinds:
 *   - 'all'   : no filter. OWNERs always, plus ADMIN/MANAGER who have no
 *               scope configured yet (back-compat: avoid empty queues the
 *               first time someone upgrades).
 *   - 'store' : isStoreManager + managedLocations. Full authority within
 *               those locations, regardless of department.
 *   - 'dept'  : dept-scoped manager. Authority only within their
 *               managedDepartments (each of which pins a location + a set
 *               of positions).
 *   - 'none'  : EMPLOYEE, deactivated, or unknown role. No manager view.
 */

async function loadScope(userId, roleHint) {
  if (!userId) return { kind: 'none' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      isStoreManager: true,
      managedLocations: { select: { id: true } },
      managedDepartments: {
        select: {
          id: true,
          locationId: true,
          positions: { select: { id: true } },
        },
      },
    },
  });

  if (!user || !user.isActive) return { kind: 'none' };

  const role = roleHint || user.role;

  if (role === 'OWNER') return { kind: 'all' };
  if (role === 'EMPLOYEE') return { kind: 'none' };

  const hasLocs = user.managedLocations.length > 0;
  const hasDepts = user.managedDepartments.length > 0;

  // Back-compat: a manager-tier user with nothing configured sees everything.
  // Without this, the very first render after upgrading would hand them an
  // empty dashboard and they'd think the app was broken.
  if (!hasLocs && !hasDepts) return { kind: 'all' };

  if (user.isStoreManager && hasLocs) {
    return {
      kind: 'store',
      locIds: new Set(user.managedLocations.map((l) => l.id)),
    };
  }

  if (hasDepts) {
    const deptIds = new Set();
    const locIds = new Set();
    const posIds = new Set();
    const deptPosLoc = [];
    for (const d of user.managedDepartments) {
      deptIds.add(d.id);
      locIds.add(d.locationId);
      const pIds = new Set(d.positions.map((p) => p.id));
      for (const pid of pIds) posIds.add(pid);
      deptPosLoc.push({ deptId: d.id, locationId: d.locationId, positionIds: pIds });
    }
    return { kind: 'dept', deptIds, locIds, posIds, deptPosLoc };
  }

  // Edge case: isStoreManager=false and only managedLocations set — treat as
  // store-level anyway. Misconfiguration shouldn't lock them out of their own
  // store; the UI will fix this on the next edit.
  if (hasLocs) {
    return {
      kind: 'store',
      locIds: new Set(user.managedLocations.map((l) => l.id)),
    };
  }

  return { kind: 'none' };
}

/**
 * Does `scope` cover this shift? Used to filter live roster, approvals, etc.
 * A shift matches 'dept' scope only if (locationId, positionId) both belong
 * to the same dept — matching just one side would leak cross-department shifts.
 */
function coversShift(scope, shift) {
  if (!scope || !shift) return false;
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  if (scope.kind === 'store') {
    return shift.locationId != null && scope.locIds.has(shift.locationId);
  }
  if (scope.kind === 'dept') {
    if (shift.locationId == null) return false;
    for (const d of scope.deptPosLoc) {
      if (d.locationId !== shift.locationId) continue;
      // A shift with no position is visible if the dept has no positions yet,
      // otherwise it must match one of them. We err on the permissive side
      // because unassigned shifts are the ones managers most need to see.
      if (!shift.positionId) return true;
      if (d.positionIds.has(shift.positionId)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Does `scope` cover this user (for roster/team purposes)?
 * Target needs {locations: [{id}], positions: [{id}]} loaded.
 */
function coversUser(scope, target) {
  if (!scope || !target) return false;
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  const targetLocIds = (target.locations || []).map((l) => l.id);
  if (scope.kind === 'store') {
    return targetLocIds.some((id) => scope.locIds.has(id));
  }
  if (scope.kind === 'dept') {
    const targetPosIds = new Set((target.positions || []).map((p) => p.id));
    for (const d of scope.deptPosLoc) {
      if (!targetLocIds.includes(d.locationId)) continue;
      // If the employee has no positions assigned, the dept-scoped manager
      // can still see them so long as the location matches — they're the
      // person most likely to go fix that assignment.
      if (targetPosIds.size === 0) return true;
      for (const pid of d.positionIds) {
        if (targetPosIds.has(pid)) return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * Prisma `where` fragment to narrow a User query by this scope. Returns
 * undefined for 'all' (caller should skip AND-ing it in). Returns an always-
 * false filter for 'none' so the query returns no rows.
 */
function userScopeWhere(scope) {
  if (!scope || scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return { id: '__never__' };
  if (scope.kind === 'store') {
    return { locations: { some: { id: { in: [...scope.locIds] } } } };
  }
  if (scope.kind === 'dept') {
    // Either the user works at one of the dept locations AND has one of the
    // dept positions, OR (fallback for unassigned employees) works at the
    // location with no position on file.
    return {
      OR: scope.deptPosLoc.map((d) => ({
        AND: [
          { locations: { some: { id: d.locationId } } },
          {
            OR: [
              { positions: { some: { id: { in: [...d.positionIds] } } } },
              { positions: { none: {} } },
            ],
          },
        ],
      })),
    };
  }
  return undefined;
}

/**
 * Prisma `where` fragment to narrow a Shift query by this scope.
 */
function shiftScopeWhere(scope) {
  if (!scope || scope.kind === 'all') return undefined;
  if (scope.kind === 'none') return { id: '__never__' };
  if (scope.kind === 'store') {
    return { locationId: { in: [...scope.locIds] } };
  }
  if (scope.kind === 'dept') {
    return {
      OR: scope.deptPosLoc.map((d) => ({
        locationId: d.locationId,
        OR: [
          { positionId: { in: [...d.positionIds] } },
          { positionId: null },
        ],
      })),
    };
  }
  return undefined;
}

module.exports = {
  loadScope,
  coversShift,
  coversUser,
  userScopeWhere,
  shiftScopeWhere,
};
