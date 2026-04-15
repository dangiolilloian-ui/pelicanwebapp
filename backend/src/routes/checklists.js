const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// List templates for the org, with item counts for the overview row.
// Managers create/edit, everyone can read so the frontend can show counts
// in the schedule and on the employee dashboard.
router.get('/', authenticate, async (req, res) => {
  const templates = await prisma.checklistTemplate.findMany({
    where: { organizationId: req.user.organizationId },
    include: { items: { orderBy: { position: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(templates);
});

router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { name, locationId, items } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const tpl = await prisma.checklistTemplate.create({
    data: {
      organizationId: req.user.organizationId,
      locationId: locationId || null,
      name: name.trim(),
      items: Array.isArray(items) && items.length
        ? {
            create: items
              .filter((i) => i && typeof i.label === 'string' && i.label.trim())
              .map((i, idx) => ({ label: i.label.trim(), position: idx })),
          }
        : undefined,
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  res.status(201).json(tpl);
});

router.put('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.checklistTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Template not found' });
  }
  const { name, locationId } = req.body;
  const tpl = await prisma.checklistTemplate.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: String(name).trim() }),
      ...(locationId !== undefined && { locationId: locationId || null }),
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
  res.json(tpl);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.checklistTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Template not found' });
  }
  await prisma.checklistTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Add an item to a template.
router.post('/:id/items', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const tpl = await prisma.checklistTemplate.findUnique({
    where: { id: req.params.id },
    include: { items: { select: { position: true } } },
  });
  if (!tpl || tpl.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Template not found' });
  }
  const { label } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'label required' });

  const nextPos = tpl.items.reduce((max, i) => Math.max(max, i.position), -1) + 1;
  const item = await prisma.checklistItem.create({
    data: { templateId: tpl.id, label: label.trim(), position: nextPos },
  });
  res.status(201).json(item);
});

router.delete('/:id/items/:itemId', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const item = await prisma.checklistItem.findUnique({
    where: { id: req.params.itemId },
    include: { template: { select: { id: true, organizationId: true } } },
  });
  if (
    !item ||
    item.templateId !== req.params.id ||
    item.template.organizationId !== req.user.organizationId
  ) {
    return res.status(404).json({ error: 'Item not found' });
  }
  await prisma.checklistItem.delete({ where: { id: item.id } });
  res.status(204).end();
});

module.exports = router;
