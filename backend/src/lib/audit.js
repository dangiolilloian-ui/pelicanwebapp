const prisma = require('../config/db');

// Fire-and-forget audit writer. Never throws into the caller — a failed audit
// write shouldn't roll back a successful business operation. We log the
// failure instead so it surfaces in container logs without breaking UX.
//
// Usage:
//   await audit(req, 'SHIFT_ASSIGN', 'SHIFT', shift.id, `Assigned shift to ${name}`, { before, after });
//
// The req-based signature pulls organizationId + actorId off the JWT payload
// so callers don't have to repeat themselves.
async function audit(req, action, entityType, entityId, summary, metadata = null) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: req.user.organizationId,
        actorId: req.user.id,
        action,
        entityType,
        entityId: entityId || null,
        summary,
        metadata: metadata || undefined,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write log:', err.message);
  }
}

module.exports = { audit };
