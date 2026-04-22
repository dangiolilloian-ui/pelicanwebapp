const { Router } = require('express');
const multer = require('multer');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { pushToUsers } = require('../lib/webpush');

const router = Router();

// ─── File upload config (memory storage → saved to DB) ─────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    // Allow images, PDFs, common docs, and text
    const allowed = /\.(jpe?g|png|gif|webp|heic|pdf|doc|docx|xls|xlsx|csv|txt|zip)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────

// For a STRUCTURAL conversation, compute who should be a member based on
// its position/location filters. A user must match ALL filter types (AND).
async function computeStructuralMembers(conversationId, organizationId) {
  const filters = await prisma.conversationFilter.findMany({
    where: { conversationId },
  });
  if (filters.length === 0) return [];

  const positionIds = filters.filter((f) => f.filterType === 'POSITION').map((f) => f.filterId);
  const locationIds = filters.filter((f) => f.filterType === 'LOCATION').map((f) => f.filterId);

  // Start with all org users, then narrow down
  let where = { organizationId };
  if (positionIds.length > 0) {
    where.positions = { some: { id: { in: positionIds } } };
  }
  if (locationIds.length > 0) {
    where.locations = { some: { id: { in: locationIds } } };
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true },
  });
  return users.map((u) => u.id);
}

// Sync membership for a structural conversation. Adds missing members and
// removes users who no longer match the filters.
async function syncStructuralMembers(conversationId, organizationId) {
  const targetIds = await computeStructuralMembers(conversationId, organizationId);
  const current = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, id: true },
  });
  const currentIds = current.map((m) => m.userId);

  const toAdd = targetIds.filter((id) => !currentIds.includes(id));
  const toRemove = current.filter((m) => !targetIds.includes(m.userId));

  if (toAdd.length > 0) {
    await prisma.conversationMember.createMany({
      data: toAdd.map((userId) => ({ conversationId, userId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.conversationMember.deleteMany({
      where: { id: { in: toRemove.map((m) => m.id) } },
    });
  }
  return targetIds;
}

// ─── List conversations ─────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  // Sync structural conversations lazily
  const structuralConvs = await prisma.conversation.findMany({
    where: { organizationId: req.user.organizationId, type: 'STRUCTURAL' },
    select: { id: true },
  });
  for (const c of structuralConvs) {
    await syncStructuralMembers(c.id, req.user.organizationId);
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      organizationId: req.user.organizationId,
      members: { some: { userId: req.user.id } },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      chatMessages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      filters: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Add unread count per conversation
  const result = conversations.map((c) => {
    const myMembership = c.members.find((m) => m.userId === req.user.id);
    const lastRead = myMembership?.lastReadAt || new Date(0);
    const lastMessage = c.chatMessages[0] || null;
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      members: c.members.map((m) => m.user),
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            content: lastMessage.content,
            sender: lastMessage.sender,
            createdAt: lastMessage.createdAt,
          }
        : null,
      unreadCount: 0, // We'll compute below
      filters: c.filters,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });

  // Batch unread counts
  for (const conv of result) {
    const myMembership = conversations
      .find((c) => c.id === conv.id)
      ?.members.find((m) => m.userId === req.user.id);
    const lastRead = myMembership?.lastReadAt || new Date(0);
    conv.unreadCount = await prisma.chatMessage.count({
      where: {
        conversationId: conv.id,
        createdAt: { gt: lastRead },
        senderId: { not: req.user.id },
      },
    });
  }

  res.json(result);
});

// ─── Create conversation ────────────────────────────────────────────

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { type, name, memberIds, filters } = req.body;

  // Validate type
  if (!['DIRECT', 'GROUP', 'STRUCTURAL'].includes(type)) {
    return res.status(400).json({ error: 'Invalid conversation type' });
  }

  // Only managers can create GROUP and STRUCTURAL conversations
  if ((type === 'GROUP' || type === 'STRUCTURAL') && !['OWNER', 'MANAGER'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only managers can create group chats' });
  }

  // For DIRECT: check if a DM already exists between these two users
  if (type === 'DIRECT') {
    if (!memberIds || memberIds.length !== 1) {
      return res.status(400).json({ error: 'Direct message requires exactly one other user' });
    }
    const otherId = memberIds[0];
    const existing = await prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        organizationId: req.user.organizationId,
        AND: [
          { members: { some: { userId: req.user.id } } },
          { members: { some: { userId: otherId } } },
        ],
      },
    });
    if (existing) {
      return res.json(existing);
    }
  }

  // Create the conversation
  const conversation = await prisma.conversation.create({
    data: {
      type,
      name: type === 'DIRECT' ? null : name || null,
      organizationId: req.user.organizationId,
      createdById: req.user.id,
      members: {
        create: [
          { userId: req.user.id },
          ...(type !== 'STRUCTURAL' && memberIds
            ? memberIds.filter((id) => id !== req.user.id).map((userId) => ({ userId }))
            : []),
        ],
      },
      ...(type === 'STRUCTURAL' && filters
        ? {
            filters: {
              create: filters.map((f) => ({
                filterType: f.filterType,
                filterId: f.filterId,
              })),
            },
          }
        : {}),
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      filters: true,
    },
  });

  // For structural conversations, sync membership now
  if (type === 'STRUCTURAL') {
    await syncStructuralMembers(conversation.id, req.user.organizationId);
  }

  // Notify members via Socket.IO
  const io = req.app.get('io');
  if (io) {
    const allMembers = await prisma.conversationMember.findMany({
      where: { conversationId: conversation.id },
      select: { userId: true },
    });
    for (const m of allMembers) {
      io.to(`user:${m.userId}`).emit('conversation-created', { conversationId: conversation.id });
    }
  }

  res.status(201).json(conversation);
});

// ─── Get messages for a conversation ────────────────────────────────

router.get('/:id/messages', authenticate, async (req, res) => {
  const conversationId = req.params.id;

  // Verify membership
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
  });
  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before; // cursor-based pagination

  const where = { conversationId };
  if (before) {
    where.createdAt = { lt: new Date(before) };
  }

  const messages = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    omit: { fileData: true }, // don't send binary blobs in listing
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Mark as read
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
    data: { lastReadAt: new Date() },
  });

  res.json(messages.reverse());
});

// ─── Send a message ─────────────────────────────────────────────────

router.post('/:id/messages', authenticate, upload.single('file'), async (req, res) => {
  const conversationId = req.params.id;
  const content = req.body.content || '';

  // Must have either text or a file
  if (!content.trim() && !req.file) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  // Verify membership
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
  });
  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  const messageData = {
    conversationId,
    senderId: req.user.id,
    content: content.trim() || (req.file ? '' : ''),
  };

  // Attach file info if uploaded — binary stored in DB
  if (req.file) {
    messageData.fileName = req.file.originalname;
    messageData.fileType = req.file.mimetype;
    messageData.fileSize = req.file.size;
    messageData.fileData = req.file.buffer;
    // fileUrl will be set after we know the message ID
  }

  let message = await prisma.chatMessage.create({
    data: messageData,
    omit: { fileData: true },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Set the fileUrl now that we have the message ID
  if (req.file) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/api/conversations/${conversationId}/messages/${message.id}/file`;
    await prisma.chatMessage.update({
      where: { id: message.id },
      data: { fileUrl },
    });
    message = { ...message, fileUrl };
  }

  // Update conversation timestamp so it sorts to top
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // Update sender's read position
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
    data: { lastReadAt: new Date() },
  });

  // Broadcast via Socket.IO
  const io = req.app.get('io');
  if (io) {
    // Send to everyone in the conversation room
    io.to(`conv:${conversationId}`).emit('new-message', {
      conversationId,
      message,
    });
    // Also notify members who aren't viewing the conversation right now
    const allMembers = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: req.user.id } },
      select: { userId: true },
    });
    for (const m of allMembers) {
      io.to(`user:${m.userId}`).emit('conversation-updated', {
        conversationId,
        lastMessage: {
          id: message.id,
          content: message.content,
          fileUrl: message.fileUrl,
          fileName: message.fileName,
          fileType: message.fileType,
          sender: message.sender,
          createdAt: message.createdAt,
        },
      });
    }

    // Send push notifications to members who might not have the app open
    const pushUserIds = allMembers.map((m) => m.userId);
    if (pushUserIds.length > 0) {
      const senderName = `${message.sender.firstName} ${message.sender.lastName}`;
      const preview = message.fileUrl
        ? (message.content || `sent a file: ${message.fileName}`)
        : (message.content.length > 100 ? message.content.slice(0, 97) + '...' : message.content);
      pushToUsers(pushUserIds, {
        type: 'MESSAGE',
        title: senderName,
        body: preview.length > 100 ? preview.slice(0, 97) + '...' : preview,
        link: '/dashboard/messages',
      }).catch((err) => console.warn('[push] message notify failed:', err));
    }
  }

  res.status(201).json(message);
});

// ─── Serve a file attachment from the database ─────────────────────

router.get('/:id/messages/:msgId/file', authenticate, async (req, res) => {
  const { id: conversationId, msgId } = req.params;

  // Verify membership
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: req.user.id } },
  });
  if (!membership) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: msgId },
    select: { conversationId: true, fileData: true, fileName: true, fileType: true, fileSize: true },
  });

  if (!message || message.conversationId !== conversationId || !message.fileData) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.set('Content-Type', message.fileType || 'application/octet-stream');
  res.set('Content-Length', message.fileSize);
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(message.fileName || 'file')}"`);
  res.send(message.fileData);
});

// ─── Get conversation details ───────────────────────────────────────

router.get('/:id', authenticate, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      members: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
      filters: true,
    },
  });

  if (!conversation || conversation.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Verify membership
  const isMember = conversation.members.some((m) => m.userId === req.user.id);
  if (!isMember) {
    return res.status(403).json({ error: 'Not a member of this conversation' });
  }

  res.json(conversation);
});

module.exports = router;
