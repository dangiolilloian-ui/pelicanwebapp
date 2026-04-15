'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface Message {
  id: string;
  content: string;
  channel: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string };
}

interface Channel {
  name: string;
  label?: string;
  messageCount: number;
}

export default function MessagesPage() {
  const { token, user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = useT();

  const fetchChannels = useCallback(async () => {
    if (!token) return;
    const data = await api<Channel[]>('/messages/channels', { token });
    setChannels(data);
  }, [token]);

  const fetchMessages = useCallback(async () => {
    if (!token) return;
    const data = await api<Message[]>(`/messages?channel=${activeChannel}`, { token });
    setMessages(data);
  }, [token, activeChannel]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchMessages(); }, [fetchMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Poll for new messages
  useEffect(() => {
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newMessage.trim()) return;
    await api('/messages', {
      token,
      method: 'POST',
      body: JSON.stringify({ channel: activeChannel, content: newMessage.trim() }),
    });
    setNewMessage('');
    fetchMessages();
  };

  const activeLabel = channels.find((c) => c.name === activeChannel)?.label || activeChannel;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / 3600000;
    if (diffH < 24) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Channel sidebar */}
      <div className="w-48 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 p-3 space-y-0.5 shrink-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-2 mb-2">{t('messages.channels')}</p>
        {channels.map((ch) => (
          <button
            key={ch.name}
            onClick={() => setActiveChannel(ch.name)}
            className={clsx(
              'w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition',
              activeChannel === ch.name ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            )}
          >
            <span className="truncate"># {ch.label || ch.name}</span>
            {ch.messageCount > 0 && <span className="text-xs text-gray-400 ml-2">{ch.messageCount}</span>}
          </button>
        ))}
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col">
        <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 bg-white dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100"># {activeLabel}</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50 dark:bg-gray-900">
          {messages.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">{t('messages.empty')}</p>
          )}
          {messages.map((msg) => {
            const isMe = msg.user.id === user?.id;
            return (
              <div key={msg.id} className="flex items-start gap-2">
                <div className={clsx(
                  'h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                  isMe ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-600 dark:text-gray-400'
                )}>
                  {msg.user.firstName[0]}{msg.user.lastName[0]}
                </div>
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {msg.user.firstName} {msg.user.lastName}
                    </span>
                    <span className="text-[11px] text-gray-400">{formatTime(msg.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{msg.content}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={t('messages.placeholder', { channel: activeLabel })}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {t('messages.send')}
          </button>
        </form>
      </div>
    </div>
  );
}
