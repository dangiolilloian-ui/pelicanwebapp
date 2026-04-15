'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface AuditActor {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: AuditActor | null;
}

interface ListResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface Facets {
  actions: string[];
  entityTypes: string[];
  actors: AuditActor[];
}

// Group actions by their verb color so scanning the feed is fast. Anything
// destructive gets red, decisions get green/amber, create/update stay neutral.
const actionColor = (action: string): string => {
  if (action.includes('DELETE')) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  if (action.includes('APPROVED') || action.includes('PUBLISH')) return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (action.includes('DENIED')) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  if (action.includes('CREATE')) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
};

const PAGE_SIZE = 50;

export default function AuditPage() {
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<Facets>({ actions: [], entityTypes: [], actors: [] });

  const [entityType, setEntityType] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const t = useT();

  // Build the query string once so list, count, and export all agree.
  const queryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (entityType) qs.set('entityType', entityType);
    if (actionFilter) qs.set('action', actionFilter);
    if (actorFilter) qs.set('actorId', actorFilter);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (q.trim()) qs.set('q', q.trim());
    return qs.toString();
  }, [entityType, actionFilter, actorFilter, from, to, q]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams(queryString);
      qs.set('limit', String(PAGE_SIZE));
      qs.set('offset', String(offset));
      const data = await api<ListResponse>(`/audit-logs?${qs.toString()}`, { token });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load audit log', err);
    } finally {
      setLoading(false);
    }
  }, [token, queryString, offset]);

  // Reset to page 1 whenever filters change so users don't end up on an
  // empty page after narrowing a search.
  useEffect(() => {
    setOffset(0);
  }, [queryString]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    api<Facets>('/audit-logs/facets', { token })
      .then(setFacets)
      .catch(() => {});
  }, [token]);

  const exportCsv = async () => {
    if (!token) return;
    // Fetch directly rather than through api() so we can handle the blob.
    const res = await fetch(`/api/audit-logs/export.csv?${queryString}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert(t('audit.exportFailed'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setEntityType('');
    setActionFilter('');
    setActorFilter('');
    setFrom('');
    setTo('');
    setQ('');
  };

  if (!isManager) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('audit.managerRequired')}</p>
      </div>
    );
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('audit.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('audit.desc', { n: total.toLocaleString() })}
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {t('audit.exportCsv')}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('audit.searchPlaceholder')}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          />
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          >
            <option value="">{t('audit.allEntities')}</option>
            {facets.entityTypes.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          >
            <option value="">{t('audit.allActions')}</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          >
            <option value="">{t('audit.anyActor')}</option>
            {facets.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.firstName} {a.lastName}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={resetFilters}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {t('common.reset')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('audit.noEntries')}
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((e) => {
              const isExpanded = expanded === e.id;
              const hasMeta = e.metadata && Object.keys(e.metadata).length > 0;
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-mono font-medium', actionColor(e.action))}>
                          {e.action}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : t('audit.system')}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-1 break-words">{e.summary}</p>
                    </div>
                    {hasMeta && (
                      <button
                        onClick={() => setExpanded(isExpanded ? null : e.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 shrink-0"
                      >
                        {isExpanded ? t('audit.hide') : t('audit.details')}
                      </button>
                    )}
                  </div>
                  {isExpanded && hasMeta && (
                    <pre className="mt-2 text-[11px] bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg p-2 overflow-x-auto text-gray-700 dark:text-gray-300">
                      {JSON.stringify(e.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-600 dark:text-gray-400">
            <span>
              {t('audit.page', { current: page, total: totalPages })}
            </span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 disabled:opacity-40"
              >
                {t('audit.previous')}
              </button>
              <button
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 disabled:opacity-40"
              >
                {t('audit.next')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
