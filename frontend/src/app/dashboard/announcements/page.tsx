'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Author {
  id: string;
  firstName: string;
  lastName: string;
}

interface LocationLabel {
  id: string;
  name: string;
}

interface PositionLabel {
  id: string;
  name: string;
}

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
  author: Author | null;
  location: LocationLabel | null;
  position: PositionLabel | null;
  ackCount: number;
  totalAudience: number;
  ackedByMe: boolean;
}

export default function AnnouncementsPage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const [items, setItems] = useState<Announcement[]>([]);
  const [locations, setLocations] = useState<LocationLabel[]>([]);
  const [positions, setPositions] = useState<PositionLabel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    api<Announcement[]>('/announcements', { token })
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
    if (!token) return;
    // Load locations + positions for targeting dropdowns
    api<LocationLabel[]>('/locations', { token }).then(setLocations).catch(() => {});
    api<PositionLabel[]>('/positions', { token }).then(setPositions).catch(() => {});
  }, [load, token]);

  const pinned = items.filter((a) => a.pinned);
  const unpinned = items.filter((a) => !a.pinned);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('announcements.pageTitle')}
          </h1>
          {isManager && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('announcements.pageDesc')}
            </p>
          )}
        </div>
        {isManager && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 transition"
          >
            {t('announcements.newAnnouncement')}
          </button>
        )}
      </div>

      {showForm && (
        <NewAnnouncementForm
          token={token!}
          locations={locations}
          positions={positions}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">{t('announcements.noAnnouncements')}</div>
      ) : (
        <div className="space-y-3">
          {pinned.map((a) => (
            <AnnouncementCard
              key={a.id}
              ann={a}
              canManage={isManager}
              canAck={!!user && a.authorId !== user.id}
              onChange={load}
              token={token!}
            />
          ))}
          {unpinned.length > 0 && pinned.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 my-4" />
          )}
          {unpinned.map((a) => (
            <AnnouncementCard
              key={a.id}
              ann={a}
              canManage={isManager}
              canAck={!!user && a.authorId !== user.id}
              onChange={load}
              token={token!}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({
  ann,
  canManage,
  canAck,
  onChange,
  token,
}: {
  ann: Announcement;
  canManage: boolean;
  canAck: boolean;
  onChange: () => void;
  token: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [ackedLocal, setAckedLocal] = useState(ann.ackedByMe);
  const expires = ann.expiresAt ? new Date(ann.expiresAt) : null;

  const ack = async () => {
    setBusy(true);
    setAckedLocal(true);
    try {
      await api(`/announcements/${ann.id}/ack`, { token, method: 'POST' });
      onChange();
    } catch {
      setAckedLocal(false);
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async () => {
    setBusy(true);
    try {
      await api(`/announcements/${ann.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ pinned: !ann.pinned }),
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
    <div className={clsx(
      'rounded-xl border px-5 py-4 transition',
      ann.pinned
        ? 'border-indigo-200 dark:border-indigo-800 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-gray-900'
        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {ann.pinned && '📌 '}{ann.title}
            </p>
            {/* Targeting badges */}
            {ann.location && (
              <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                {ann.location.name}
              </span>
            )}
            {ann.position && (
              <span className="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">
                {ann.position.name}
              </span>
            )}
            {!ann.locationId && !ann.positionId && (
              <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {t('announcements.orgWide')}
              </span>
            )}
          </div>

          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5 whitespace-pre-wrap">
            {ann.body}
          </p>

          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
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
                  className="rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium px-3 py-1 disabled:opacity-50 transition"
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
              onClick={togglePin}
              disabled={busy}
              className="text-[11px] text-gray-600 dark:text-gray-400 hover:underline disabled:opacity-50"
            >
              {ann.pinned ? t('announcements.unpin') : t('announcements.pin')}
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
  locations,
  positions,
  onClose,
  onCreated,
}: {
  token: string;
  locations: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [locationId, setLocationId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [pinned, setPinned] = useState(true);
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
          pinned,
          expiresAt: expiresAt || null,
          locationId: locationId || null,
          positionId: positionId || null,
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
      className="mb-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-3 shadow-sm"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('announcements.titlePlaceholder')}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('announcements.messagePlaceholder')}
        rows={4}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="grid grid-cols-2 gap-3">
        {locations.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('announcements.location')}
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('announcements.allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}
        {positions.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('announcements.position')}
            </label>
            <select
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('announcements.allPositions')}</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('announcements.expiresLabel')}</label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          {t('announcements.pin')}
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim() || !body.trim()}
          className="rounded-lg bg-indigo-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {saving ? t('common.saving') : t('common.post')}
        </button>
      </div>
    </form>
  );
}
