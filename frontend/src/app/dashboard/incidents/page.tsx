'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useLocations } from '@/hooks/useLocations';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'RESOLVED';
  occurredAt: string;
  createdAt: string;
  locationId: string | null;
  locationName: string | null;
  reporterId: string;
  reporterName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
}

const sevColor: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function IncidentsPage() {
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const { locations } = useLocations();
  const t = useT();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'OPEN' | 'RESOLVED'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<Incident[]>('/incidents', { token });
      setIncidents(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? incidents : incidents.filter((i) => i.status === filter);
  const openCount = incidents.filter((i) => i.status === 'OPEN').length;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('incidents.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('incidents.desc')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 transition"
        >
          {t('incidents.reportIncident')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(['all', 'OPEN', 'RESOLVED'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              filter === f
                ? f === 'OPEN'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : f === 'RESOLVED'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200'
            )}
          >
            {f === 'all' ? t('incidents.all', { n: incidents.length }) : f === 'OPEN' ? t('incidents.open', { n: openCount }) : t('incidents.resolved', { n: incidents.length - openCount })}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-16">
          {incidents.length === 0 ? t('incidents.noIncidents') : t('incidents.noMatch')}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((inc) => (
            <IncidentCard
              key={inc.id}
              inc={inc}
              isManager={isManager}
              expanded={expanded === inc.id}
              onToggle={() => setExpanded(expanded === inc.id ? null : inc.id)}
              token={token}
              onUpdate={load}
            />
          ))}
        </div>
      )}

      {showForm && (
        <NewIncidentModal
          token={token}
          locations={locations}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function IncidentCard({
  inc, isManager, expanded, onToggle, token, onUpdate,
}: {
  inc: Incident;
  isManager: boolean;
  expanded: boolean;
  onToggle: () => void;
  token: string | null;
  onUpdate: () => void;
}) {
  const t = useT();
  const [resolveNote, setResolveNote] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api(`/incidents/${inc.id}/resolve`, {
        token, method: 'PUT',
        body: JSON.stringify({ note: resolveNote.trim() || null }),
      });
      onUpdate();
    } finally { setBusy(false); }
  };

  const reopen = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api(`/incidents/${inc.id}/reopen`, { token, method: 'PUT' });
      onUpdate();
    } finally { setBusy(false); }
  };

  return (
    <div className={clsx(
      'rounded-xl border bg-white dark:bg-gray-900 overflow-hidden',
      inc.status === 'OPEN'
        ? 'border-red-200 dark:border-red-800/50'
        : 'border-gray-200 dark:border-gray-800'
    )}>
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition">
        <span className={clsx('h-2.5 w-2.5 rounded-full shrink-0', inc.status === 'OPEN' ? 'bg-red-500' : 'bg-green-500')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{inc.title}</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase', sevColor[inc.severity])}>{inc.severity}</span>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {inc.reporterName || t('common.unknown')} · {new Date(inc.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {inc.locationName && ` · ${inc.locationName}`}
          </div>
        </div>
        <span className="text-gray-400 text-xs">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800 pt-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{inc.description}</p>

          {inc.status === 'RESOLVED' && (
            <div className="mt-3 rounded-lg bg-green-50 dark:bg-green-900/10 p-3">
              <div className="text-xs font-medium text-green-700 dark:text-green-400">
                {t('incidents.resolvedBy', { name: inc.resolvedByName || t('common.unknown'), date: new Date(inc.resolvedAt!).toLocaleDateString() })}
              </div>
              {inc.resolutionNote && (
                <p className="text-xs text-green-600 dark:text-green-300 mt-1">{inc.resolutionNote}</p>
              )}
            </div>
          )}

          {isManager && inc.status === 'OPEN' && (
            <div className="mt-3 space-y-2">
              <textarea
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder={t('incidents.resolutionPlaceholder')}
                rows={2}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
              />
              <button
                onClick={resolve}
                disabled={busy}
                className="rounded-lg bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? t('common.saving') : t('incidents.markResolved')}
              </button>
            </div>
          )}

          {isManager && inc.status === 'RESOLVED' && (
            <button
              onClick={reopen}
              disabled={busy}
              className="mt-2 text-xs text-amber-600 hover:underline disabled:opacity-50"
            >
              {t('incidents.reopen')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NewIncidentModal({
  token, locations, onClose, onCreated,
}: {
  token: string | null;
  locations: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('LOW');
  const [locationId, setLocationId] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !title.trim() || !description.trim()) return;
    setSaving(true);
    try {
      await api('/incidents', {
        token,
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          severity,
          locationId: locationId || null,
          occurredAt: new Date(occurredAt).toISOString(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 p-5 shadow-xl space-y-4"
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('incidents.reportTitle')}</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('incidents.titleLabel')}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder={t('incidents.titlePlaceholder')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('incidents.descriptionLabel')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            rows={4}
            placeholder={t('incidents.descriptionPlaceholder')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('incidents.severityLabel')}</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
            >
              <option value="LOW">{t('incidents.severityLow')}</option>
              <option value="MEDIUM">{t('incidents.severityMedium')}</option>
              <option value="HIGH">{t('incidents.severityHigh')}</option>
              <option value="CRITICAL">{t('incidents.severityCritical')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('incidents.locationLabel')}</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
            >
              <option value="">{t('incidents.notSpecified')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('incidents.whenLabel')}</label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim() || !description.trim()}
            className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? t('incidents.submitting') : t('incidents.submitReport')}
          </button>
        </div>
      </form>
    </div>
  );
}
