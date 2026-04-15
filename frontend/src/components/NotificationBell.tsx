'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const icons: Record<string, string> = {
  SHIFT_PUBLISHED: '📅',
  TIMEOFF_APPROVED: '✅',
  TIMEOFF_DENIED: '❌',
  TIMEOFF_REQUESTED: '📝',
  MESSAGE: '💬',
};

export function NotificationBell() {
  const { token } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadCount = async () => {
    if (!token) return;
    try {
      const res = await api<{ count: number }>('/notifications/unread-count', { token });
      setUnread(res.count);
    } catch {}
  };

  const loadList = async () => {
    if (!token) return;
    try {
      const data = await api<Notification[]>('/notifications', { token });
      setItems(data);
    } catch {}
  };

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (open) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const markAllRead = async () => {
    if (!token) return;
    await api('/notifications/read-all', { token, method: 'PUT' });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const handleClick = async (n: Notification) => {
    if (!token) return;
    if (!n.read) {
      await api(`/notifications/${n.id}/read`, { token, method: 'PUT' });
      setUnread((c) => Math.max(0, c - 1));
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
    }
    if (n.link) {
      window.location.href = n.link;
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition text-gray-600 dark:text-gray-400"
        aria-label={t('notifications.title')}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-50">
          <div className="sticky top-0 flex items-center justify-between bg-white dark:bg-gray-900 px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('notifications.title')}</h3>
            {items.some((n) => !n.read) && (
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">{t('notifications.empty')}</div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={clsx(
                    'px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition',
                    !n.read && 'bg-indigo-50/40'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{icons[n.type] || '🔔'}</span>
                    <div className="min-w-0 flex-1">
                      <p className={clsx('text-sm', !n.read ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300')}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-indigo-500 mt-1.5 shrink-0" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
