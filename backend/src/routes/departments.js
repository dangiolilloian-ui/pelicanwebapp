const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

/**
 * Department CRUD
 * ================
 *
 * A Department is a named grouping of Positions at one Location. It's the
 * unit that dept-scoped managers are assigned to via managedDepartments.
 *
 * Only OWNER/ADMIN can create/edit/delete departments (they are an org-level
 * setting, like Positions and Locations). Every query is scoped by
 * organizationId so a compromised admin in Org A can't enumerate Org B.
 */

// List departments for this org, optionally filtered by location.
router.get('/', authenticate, async (req, res) => {
  const { locationId } = req.query;
  const departments = await prisma.department.findMany({
    where: {
      organizationId: req.user.organizationId,
      ...(locationId ? { locationId } : {}),
    },
    include: {
      location: { select: { id: true, name: true } },
      positions: { select: { id: true, name: true, color: true } },
      managers: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ location: { name: 'asc' } }, { name: 'asc' }],
  });
  res.json(departments);
});

// Create a department.
router.post('/', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, locationId, positionIds, managerIds } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!locationId) {
    return res.status(400).json({ error: 'Location is required' });
  }

  // Cross-org protection: the referenced location must belong to the caller's org.
  const loc = await prisma.location.findFirst({
    where: { id: locationId, organizationId: req.user.organizationId },
    select: { id: true },
  });
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  // Same for positions (all must belong to the org).
  if (Array.isArray(positionIds) && positionIds.length > 0) {
    const n = await prisma.position.count({
      where: { id: { in: positionIds }, organizationId: req.user.organizationId },
    });
    if (n !== positionIds.length) {
      return res.status(400).json({ error: 'One or more positions are invalid' });
    }
  }

  // Managers must be users in this org with a manager-tier role.
  if (Array.isArray(managerIds) && managerIds.length > 0) {
    const n = await prisma.user.count({
      where: {
        id: { in: managerIds },
        organizationId: req.user.organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
      },
    });
    if (n !== managerIds.length) {
      return res.status(400).json({ error: 'One or more managers are invalid' });
    }
  }

  try {
    const dept = await prisma.department.create({
      data: {
        name: name.trim(),
        organizationId: req.user.organizationId,
        locationId,
        ...(Array.isArray(positionIds) && positionIds.length > 0
          ? { positions: { connect: positionIds.map((id) => ({ id })) } }
          : {}),
        ...(Array.isArray(managerIds) && managerIds.length > 0
          ? { managers: { connect: managerIds.map((id) => ({ id })) } }
          : {}),
      },
      include: {
        location: { select: { id: true, name: true } },
        positions: { select: { id: true, name: true, color: true } },
        managers: {
          select: {
            id: true, firstName: true, lastName: true, email: true, role: true, isActive: true,
          },
        },
      },
    });
    res.status(201).json(dept);
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'A department with that name already exists at this location' });
    }
    throw e;
  }
});

// Update a department. Can change name, positions, managers. Location is
// intentionally immutable once set — moving a dept between stores doesn't
// map cleanly to the notion of "same department" and is almost always a
// delete+recreate from the user's point of view.
router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, positionIds, managerIds } = req.body;

  const existing = await prisma.department.findFirst({
    where: { id: req.params.id, organizationId: req.user.organizationId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'Department not found' });

  if (Array.isArray(positionIds)) {
    if (positionIds.length > 0) {
      const n = await prisma.position.count({
        where: { id: { in: positionIds }, organizationId: req.user.organizationId },
      });
      if (n !== positionIds.length) {
        return res.status(400).json({ error: 'One or more positions are invalid' });
      }
    }
  }
  if (Array.isArray(managerIds)) {
    if (managerIds.length > 0) {
      const n = await prisma.user.count({
        where: {
          id: { in: managerIds },
          organizationId: req.user.organizationId,
          role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
        },
      });
      if (n !== managerIds.length) {
        return res.status(400).json({ error: 'One or more managers are invalid' });
      }
    }
  }

  try {
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: {
        ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
        ...(Array.isArray(positionIds)
          ? { positions: { set: positionIds.map((id) => ({ id })) } }
          : {}),
        ...(Array.isArray(managerIds)
          ? { managers: { set: managerIds.map((id) => ({ id })) } }
          : {}),
      },
      include: {
        location: { select: { id: true, name: true } },
        positions: { select: { id: true, name: true, color: true } },
        managers: {
          select: {
            id: true, firstName: true, lastName: true, email: true, role: true, isActive: true,
          },
        },
      },
    });
    res.json(dept);
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'A department with that name already exists at this location' });
    }
    throw e;
  }
});

// Dedicated endpoint for just swapping managers — used by the Settings page
// where the rest of the department stays stable and only the roster of who
// oversees it changes. Keeps the PUT payload surface tiny.
router.put('/:id/managers', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { managerIds } = req.body;
  if (!Array.isArray(managerIds)) {
    return res.status(400).json({ error: 'managerIds must be an array' });
  }

  const existing = await prisma.department.findFirst({
    where: { id: req.params.id, organizationId: req.user.organizationId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'Department not found' });

  if (managerIds.length > 0) {
    const n = await prisma.user.count({
      where: {
        id: { in: managerIds },
        organizationId: req.user.organizationId,
        role: { in: ['OWNER', 'ADMIN', 'MANAGER'] },
      },
    });
    if (n !== managerIds.length) {
      return res.status(400).json({ error: 'One or more managers are invalid' });
    }
  }

  const dept = await prisma.department.update({
    where: { id: req.params.id },
    data: { managers: { set: managerIds.map((id) => ({ id })) } },
    include: {
      location: { select: { id: true, name: true } },
      positions: { select: { id: true, name: true, color: true } },
      managers: {
        select: {
          id: true, firstName: true, lastName: true, email: true, role: true, isActive: true,
        },
      },
    },
  });
  res.json(dept);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const existing = await prisma.department.findFirst({
    where: { id: req.params.id, organizationId: req.user.organizationId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'Department not found' });

  // Cascade delete via schema onDelete handles the join tables; managers
  // themselves are untouched.
  await prisma.department.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
