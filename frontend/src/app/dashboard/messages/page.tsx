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
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
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

  // Append auth token to file URLs so <img src> and <a href> work
  const authUrl = (url: string) => {
    if (!token || !url) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${token}`;
  };

  // Conversation list
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  // Messages for active conversation
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

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
    if ((!input.trim() && !pendingFile) || !activeConvId || !token) return;
    const content = input.trim();
    const file = pendingFile;
    setInput('');
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
      let msg: ChatMsg;
      if (file) {
        // Use FormData for file uploads
        const fd = new FormData();
        fd.append('file', file);
        fd.append('content', content);
        const res = await fetch(`${API_BASE}/conversations/${activeConvId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!res.ok) throw new Error('Upload failed');
        msg = await res.json();
      } else {
        msg = await api<ChatMsg>(`/conversations/${activeConvId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content }),
          token,
        });
      }
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
      setPendingFile(file);
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
          {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER') && (
            <button
              onClick={openNewModal}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              New
            </button>
          )}
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
                  {c.lastMessage.content
                    ? c.lastMessage.content.slice(0, 80)
                    : c.lastMessage.fileUrl
                    ? (c.lastMessage.fileType?.startsWith('image/') ? '📷 Photo' : `📎 ${c.lastMessage.fileName || 'File'}`)
                    : ''}
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
                        {/* File attachment */}
                        {msg.fileUrl && msg.fileType?.startsWith('image/') && (
                          <a href={authUrl(msg.fileUrl)} target="_blank" rel="noopener noreferrer" className="block mb-1">
                            <img
                              src={authUrl(msg.fileUrl)}
                              alt={msg.fileName || 'Image'}
                              className="max-w-[240px] max-h-[240px] rounded-lg object-cover"
                            />
                          </a>
                        )}
                        {msg.fileUrl && !msg.fileType?.startsWith('image/') && (
                          <a
                            href={authUrl(msg.fileUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={clsx(
                              'flex items-center gap-2 mb-1 rounded-lg px-2.5 py-1.5 text-xs',
                              isMe
                                ? 'bg-indigo-500/30 hover:bg-indigo-500/50'
                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                            )}
                          >
                            <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span className="truncate max-w-[180px]">{msg.fileName || 'File'}</span>
                            {msg.fileSize && (
                              <span className="flex-shrink-0 opacity-70">
                                {msg.fileSize < 1024 ? `${msg.fileSize} B` : msg.fileSize < 1048576 ? `${(msg.fileSize / 1024).toFixed(0)} KB` : `${(msg.fileSize / 1048576).toFixed(1)} MB`}
                              </span>
                            )}
                          </a>
                        )}
                        {msg.content && <span>{msg.content}</span>}
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
              {/* Pending file preview */}
              {pendingFile && (
                <div className="flex items-center gap-2 mb-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2">
                  {pendingFile.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(pendingFile)}
                      alt="Preview"
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  )}
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{pendingFile.name}</span>
                  <button
                    type="button"
                    onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setPendingFile(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-gray-300 dark:border-gray-700 px-3 py-2 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition"
                  title="Attach file"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={pendingFile ? 'Add a caption...' : 'Type a message...'}
                  className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim() && !pendingFile}
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
