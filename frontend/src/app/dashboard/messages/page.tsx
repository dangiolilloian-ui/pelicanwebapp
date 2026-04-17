'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import clsx from 'clsx';

// ─── Types ──────────────────────────────────────────────────────────

interface MemberInfo {
  id: string;
  firstName: string;
  lastName: string;
}

interface ChatMsg {
  id: string;
  content: string;
  createdAt: string;
  sender: MemberInfo;
}

interface ConvSummary {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'STRUCTURAL';
  name: string | null;
  members: MemberInfo[];
  lastMessage: ChatMsg | null;
  unreadCount: number;
  filters: { filterType: string; filterId: string }[];
  updatedAt: string;
}

interface Position { id: string; name: string; color: string; }
interface Location { id: string; name: string; }
interface UserOption { id: string; firstName: string; lastName: string; email: string; }

// ─── Component ──────────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  // Conversation list
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // Messages for active conversation
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newType, setNewType] = useState<'DIRECT' | 'GROUP' | 'STRUCTURAL'>('DIRECT');
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedPositionIds, setSelectedPositionIds] = useState<Set<string>>(new Set());
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [newError, setNewError] = useState('');

  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';

  // ─── Fetch conversations ───────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<ConvSummary[]>('/conversations', { token });
      setConversations(data);
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // ─── Fetch messages when conversation changes ──────────────────────

  useEffect(() => {
    if (!activeConvId || !token) { setMessages([]); return; }
    let cancelled = false;

    (async () => {
      const msgs = await api<ChatMsg[]>(`/conversations/${activeConvId}/messages`, { token });
      if (!cancelled) setMessages(msgs);
    })();

    // Join socket room
    const socket = getSocket();
    if (socket) {
      socket.emit('join-conversation', activeConvId);
    }

    return () => {
      cancelled = true;
      if (socket) socket.emit('leave-conversation', activeConvId);
    };
  }, [activeConvId, token]);

  // ─── Socket.IO real-time ───────────────────────────────────────────

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = ({ conversationId, message }: { conversationId: string; message: ChatMsg }) => {
      if (conversationId === activeConvId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        });
      }
    };

    const handleConvUpdated = ({ conversationId, lastMessage }: { conversationId: string; lastMessage: ChatMsg }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, lastMessage, unreadCount: c.id === activeConvId ? 0 : c.unreadCount + 1, updatedAt: lastMessage.createdAt }
            : c
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
    };

    const handleConvCreated = () => {
      fetchConversations();
    };

    socket.on('new-message', handleNewMessage);
    socket.on('conversation-updated', handleConvUpdated);
    socket.on('conversation-created', handleConvCreated);

    return () => {
      socket.off('new-message', handleNewMessage);
      socket.off('conversation-updated', handleConvUpdated);
      socket.off('conversation-created', handleConvCreated);
    };
  }, [activeConvId, fetchConversations]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Send message ──────────────────────────────────────────────────

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeConvId || !token) return;
    const content = input.trim();
    setInput('');
    try {
      const msg = await api<ChatMsg>(`/conversations/${activeConvId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
        token,
      });
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Update conversation list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, lastMessage: msg, updatedAt: msg.createdAt }
            : c
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
    } catch {
      setInput(content);
    }
  };

  // ─── New conversation modal logic ──────────────────────────────────

  const openNewModal = async () => {
    setShowNewModal(true);
    setNewError('');
    setSelectedUserIds(new Set());
    setSelectedPositionIds(new Set());
    setSelectedLocationIds(new Set());
    setGroupName('');
    setNewType('DIRECT');
    if (!token) return;
    try {
      const [users, positions, locations] = await Promise.all([
        api<UserOption[]>('/users', { token }),
        api<Position[]>('/positions', { token }),
        api<Location[]>('/locations', { token }),
      ]);
      setAllUsers(users.filter((u) => u.id !== user?.id));
      setAllPositions(positions);
      setAllLocations(locations);
    } catch {}
  };

  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePosition = (id: string) => {
    setSelectedPositionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleLocation = (id: string) => {
    setSelectedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createConversation = async () => {
    setNewError('');
    if (!token) return;

    try {
      if (newType === 'DIRECT') {
        if (selectedUserIds.size !== 1) { setNewError('Select one person for a direct message'); return; }
        const res = await api<any>('/conversations', {
          method: 'POST',
          body: JSON.stringify({ type: 'DIRECT', memberIds: [...selectedUserIds] }),
          token,
        });
        setShowNewModal(false);
        await fetchConversations();
        setActiveConvId(res.id);
      } else if (newType === 'GROUP') {
        if (selectedUserIds.size === 0) { setNewError('Select at least one person'); return; }
        const res = await api<any>('/conversations', {
          method: 'POST',
          body: JSON.stringify({ type: 'GROUP', name: groupName || null, memberIds: [...selectedUserIds] }),
          token,
        });
        setShowNewModal(false);
        await fetchConversations();
        setActiveConvId(res.id);
      } else {
        // STRUCTURAL
        if (selectedPositionIds.size === 0 && selectedLocationIds.size === 0) {
          setNewError('Select at least one position or location');
          return;
        }
        const filters = [
          ...[...selectedPositionIds].map((id) => ({ filterType: 'POSITION', filterId: id })),
          ...[...selectedLocationIds].map((id) => ({ filterType: 'LOCATION', filterId: id })),
        ];
        const res = await api<any>('/conversations', {
          method: 'POST',
          body: JSON.stringify({ type: 'STRUCTURAL', name: groupName || null, filters }),
          token,
        });
        setShowNewModal(false);
        await fetchConversations();
        setActiveConvId(res.id);
      }
    } catch (err: any) {
      setNewError(err.message || 'Failed to create conversation');
    }
  };

  // ─── Display helpers ───────────────────────────────────────────────

  const convDisplayName = (c: ConvSummary) => {
    if (c.name) return c.name;
    if (c.type === 'DIRECT') {
      const other = c.members.find((m) => m.id !== user?.id);
      return other ? `${other.firstName} ${other.lastName}` : 'Direct Message';
    }
    return c.members.map((m) => m.firstName).join(', ');
  };

  const convIcon = (c: ConvSummary) => {
    if (c.type === 'DIRECT') return null;
    if (c.type === 'STRUCTURAL') return '⚙';
    return '👥';
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Sidebar — conversation list */}
      <div className="w-80 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-900">
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Messages</h2>
          <button
            onClick={openNewModal}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center mt-8">No conversations yet</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={clsx(
                'w-full text-left px-3 py-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition',
                activeConvId === c.id && 'bg-indigo-50 dark:bg-indigo-950/30'
              )}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                  {convIcon(c) && <span className="text-xs">{convIcon(c)}</span>}
                  {convDisplayName(c)}
                </span>
                <div className="flex items-center gap-1.5">
                  {c.unreadCount > 0 && (
                    <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {c.unreadCount}
                    </span>
                  )}
                  {c.lastMessage && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {formatTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
              </div>
              {c.lastMessage && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  <span className="font-medium">{c.lastMessage.sender.firstName}:</span>{' '}
                  {c.lastMessage.content.slice(0, 80)}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main — message thread */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-950">
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400 dark:text-gray-500">Select a conversation or start a new one</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {convDisplayName(activeConv)}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {activeConv.members.length} member{activeConv.members.length !== 1 ? 's' : ''}
                {activeConv.type === 'STRUCTURAL' && ' · Auto-synced'}
              </p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((msg) => {
                const isMe = msg.sender.id === user?.id;
                return (
                  <div key={msg.id} className={clsx('flex', isMe ? 'justify-end' : 'justify-start')}>
                    <div className={clsx('max-w-[70%]', isMe ? 'order-2' : '')}>
                      {!isMe && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 ml-1">
                          {msg.sender.firstName} {msg.sender.lastName}
                        </p>
                      )}
                      <div
                        className={clsx(
                          'rounded-2xl px-3 py-2 text-sm',
                          isMe
                            ? 'bg-indigo-600 text-white rounded-br-md'
                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-md'
                        )}
                      >
                        {msg.content}
                      </div>
                      <p className={clsx('text-[10px] text-gray-400 dark:text-gray-500 mt-0.5', isMe ? 'text-right mr-1' : 'ml-1')}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40 transition"
                >
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {/* New conversation modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewModal(false)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">New Conversation</h2>

            {newError && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-3">{newError}</p>}

            {/* Type selector */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setNewType('DIRECT')}
                className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  newType === 'DIRECT' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                )}
              >
                Direct Message
              </button>
              {isManager && (
                <>
                  <button
                    onClick={() => setNewType('GROUP')}
                    className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      newType === 'GROUP' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    )}
                  >
                    Group Chat
                  </button>
                  <button
                    onClick={() => setNewType('STRUCTURAL')}
                    className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium transition',
                      newType === 'STRUCTURAL' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                    )}
                  >
                    By Position / Location
                  </button>
                </>
              )}
            </div>

            {/* Group name for GROUP / STRUCTURAL */}
            {(newType === 'GROUP' || newType === 'STRUCTURAL') && (
              <input
                type="text"
                placeholder="Group name (optional)"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}

            {/* User picker for DIRECT and GROUP */}
            {(newType === 'DIRECT' || newType === 'GROUP') && (
              <div>
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {newType === 'DIRECT' ? 'Select a person' : 'Select people'}
                </p>
                <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {allUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    >
                      <input
                        type={newType === 'DIRECT' ? 'radio' : 'checkbox'}
                        name="user-select"
                        checked={selectedUserIds.has(u.id)}
                        onChange={() => {
                          if (newType === 'DIRECT') {
                            setSelectedUserIds(new Set([u.id]));
                          } else {
                            toggleUser(u.id);
                          }
                        }}
                        className="accent-indigo-600"
                      />
                      <div>
                        <p className="text-sm text-gray-900 dark:text-gray-100">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Position / Location picker for STRUCTURAL */}
            {newType === 'STRUCTURAL' && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Positions</p>
                  <div className="flex flex-wrap gap-2">
                    {allPositions.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => togglePosition(p.id)}
                        className={clsx(
                          'rounded-full px-3 py-1 text-xs font-medium transition border',
                          selectedPositionIds.has(p.id)
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                        )}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Locations</p>
                  <div className="flex flex-wrap gap-2">
                    {allLocations.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => toggleLocation(l.id)}
                        className={clsx(
                          'rounded-full px-3 py-1 text-xs font-medium transition border',
                          selectedLocationIds.has(l.id)
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                        )}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowNewModal(false)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={createConversation}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
