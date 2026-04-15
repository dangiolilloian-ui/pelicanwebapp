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
  author: { id: string; firstName: string; lastName: string } | null;
  ackCount: number;
  totalAudience: number;
  ackedByMe: boolean;
}

export function AnnouncementsBar() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const [items, setItems] = useState<Announcement[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    api<Announcement[]>('/announcements', { token }).then(setItems).catch(console.error);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Employees only see what the backend already filtered (pinned + non-expired).
  // Managers see everything; we still surface pinned+active ones at the top.
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
        <AnnouncementCard
          key={a.id}
          ann={a}
          canManage={isManager}
          canAck={!!user && a.authorId !== user.id}
          onChange={load}
          token={token}
        />
      ))}

      {isManager && (
        <div>
          {showForm ? (
            <NewAnnouncementForm
              token={token}
              onClose={() => setShowForm(false)}
              onCreated={() => {
                setShowForm(false);
                load();
              }}
            />
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="text-xs text-indigo-600 hover:underline"
            >
              {t('announcements.newAnnouncement')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({
  ann,
  canManage,
  onChange,
  token,
  canAck,
}: {
  ann: Announcement;
  canManage: boolean;
  onChange: () => void;
  token: string;
  canAck: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [ackedLocal, setAckedLocal] = useState(ann.ackedByMe);
  const expires = ann.expiresAt ? new Date(ann.expiresAt) : null;

  const ack = async () => {
    setBusy(true);
    setAckedLocal(true); // optimistic
    try {
      await api(`/announcements/${ann.id}/ack`, { token, method: 'POST' });
      onChange();
    } catch {
      setAckedLocal(false); // revert on failure
    } finally {
      setBusy(false);
    }
  };

  const unpin = async () => {
    setBusy(true);
    try {
      await api(`/announcements/${ann.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ pinned: false }),
      });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(t('announcements.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api(`/announcements/${ann.id}`, { token, method: 'DELETE' });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-gray-900 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            📢 {ann.title}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 whitespace-pre-wrap">
            {ann.body}
          </p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
            {ann.author ? `${ann.author.firstName} ${ann.author.lastName}` : t('announcements.manager')}
            {' · '}
            {new Date(ann.createdAt).toLocaleDateString()}
            {expires && ` · ${t('announcements.expires', { date: expires.toLocaleDateString() })}`}
            {canManage && ann.totalAudience > 0 && (
              <>
                {' · '}
                <span className={clsx(
                  'font-medium',
                  ann.ackCount >= ann.totalAudience
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-indigo-600 dark:text-indigo-400'
                )}>
                  {t('announcements.readCount', { read: ann.ackCount, total: ann.totalAudience })}
                </span>
              </>
            )}
          </p>

          {canAck && (
            <div className="mt-2">
              {ackedLocal ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400 font-medium">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {t('announcements.acknowledged')}
                </span>
              ) : (
                <button
                  onClick={ack}
                  disabled={busy}
                  className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium px-2.5 py-1 disabled:opacity-50"
                >
                  {t('announcements.gotIt')}
                </button>
              )}
            </div>
          )}
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={unpin}
              disabled={busy}
              className="text-[11px] text-gray-600 dark:text-gray-400 hover:underline disabled:opacity-50"
            >
              {t('announcements.unpin')}
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
            >
              {t('common.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAnnouncementForm({
  token,
  onClose,
  onCreated,
}: {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await api('/announcements', {
        token,
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          pinned: true,
          expiresAt: expiresAt || null,
        }),
      });
      onCreated();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('announcements.titlePlaceholder')}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('announcements.messagePlaceholder')}
        rows={3}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400">{t('announcements.expiresLabel')}</label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs"
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim() || !body.trim()}
          className={clsx(
            'rounded-lg bg-indigo-600 text-white px-3 py-1 text-xs font-medium hover:bg-indigo-700',
            'disabled:opacity-50'
          )}
        >
          {saving ? t('common.posting') : t('common.post')}
        </button>
      </div>
    </form>
  );
}
