'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  authorId: string;
  locationId: string | null;
  positionId: string | null;
  author: { id: string; firstName: string; lastName: string } | null;
  location: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  ackCount: number;
  totalAudience: number;
  ackedByMe: boolean;
}

export function AnnouncementsBar() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [items, setItems] = useState<Announcement[]>([]);

  const load = useCallback(() => {
    if (!token) return;
    api<Announcement[]>('/announcements', { token }).then(setItems).catch(console.error);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const now = Date.now();
  const visible = items.filter((a) => {
    if (!isManager) return true;
    if (!a.pinned) return false;
    if (a.expiresAt && new Date(a.expiresAt).getTime() < now) return false;
    return true;
  });

  if (!token) return null;
  if (visible.length === 0 && !isManager) return null;

  return (
    <div className="space-y-2">
      {visible.map((a) => (
        <div
          key={a.id}
          className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-gray-900 px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                  📢 {a.title}
                </p>
                {a.location && (
                  <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                    {a.location.name}
                  </span>
                )}
                {a.position && (
                  <span className="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">
                    {a.position.name}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">
                {a.body}
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                {a.author ? `${a.author.firstName} ${a.author.lastName}` : t('announcements.manager')}
                {' · '}
                {new Date(a.createdAt).toLocaleDateString()}
              </p>

              {user && a.authorId !== user.id && (
                <div className="mt-1.5">
                  {a.ackedByMe ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400 font-medium">
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {t('announcements.acknowledged')}
                    </span>
                  ) : (
                    <AckButton annId={a.id} token={token} onDone={load} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {isManager && (
        <a
          href="/dashboard/announcements"
          className="inline-block text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {t('announcements.newAnnouncement')}
        </a>
      )}
    </div>
  );
}

function AckButton({ annId, token, onDone }: { annId: string; token: string; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const ack = async () => {
    setBusy(true);
    try {
      await api(`/announcements/${annId}/ack`, { token, method: 'POST' });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={ack}
      disabled={busy}
      className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium px-2.5 py-1 disabled:opacity-50"
    >
      {t('announcements.gotIt')}
    </button>
  );
}
