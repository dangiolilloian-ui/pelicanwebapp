'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Pending {
  userId: string;
  name: string;
  hiredAt: string;
  remaining: number;
}

interface ProgressRow {
  id: string;
  taskId: string;
  title: string;
  completedAt: string | null;
  notes: string | null;
}

// Dashboard widget: shows new hires with incomplete onboarding.  Clicking
// a hire expands an inline checklist the manager can tick through without
// leaving the dashboard.
export function OnboardingPendingWidget() {
  const t = useT();
  const { token } = useAuth();
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  const loadPending = async () => {
    if (!token) return;
    try {
      const data = await api<Pending[]>('/onboarding/pending', { token });
      setPending(data);
    } catch {
      // silent — widget just hides itself on error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPending(); /* eslint-disable-next-line */ }, [token]);

  const expand = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    if (!token) return;
    setExpandedUserId(userId);
    setProgressLoading(true);
    try {
      const rows = await api<ProgressRow[]>(`/onboarding/users/${userId}`, { token });
      setProgress(rows);
    } finally {
      setProgressLoading(false);
    }
  };

  const toggleTask = async (row: ProgressRow) => {
    if (!token) return;
    const newState = !row.completedAt;
    // Optimistic update.
    setProgress((p) =>
      p.map((r) => (r.id === row.id ? { ...r, completedAt: newState ? new Date().toISOString() : null } : r))
    );
    try {
      await api(`/onboarding/progress/${row.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ completed: newState }),
      });
      // Update the count on the outer list, and drop the user entirely if
      // they just cleared their last task.
      setPending((list) =>
        list
          .map((p) => (p.userId === expandedUserId ? { ...p, remaining: p.remaining + (newState ? -1 : 1) } : p))
          .filter((p) => p.remaining > 0 || p.userId !== expandedUserId)
      );
    } catch {
      // Revert optimistic on failure.
      setProgress((p) =>
        p.map((r) => (r.id === row.id ? { ...r, completedAt: row.completedAt } : r))
      );
    }
  };

  if (loading || pending.length === 0) return null;

  const fmtHired = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
    if (days === 0) return t('onboardingWidget.hiredToday');
    if (days === 1) return t('onboardingWidget.hiredYesterday');
    if (days < 14) return t('onboardingWidget.hiredDaysAgo', { n: days });
    return `hired ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('onboardingWidget.title')}</h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t('onboardingWidget.subtitle', { n: pending.length })}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {pending.map((p) => (
          <li key={p.userId}>
            <button
              onClick={() => expand(p.userId)}
              className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition"
            >
              <div>
                <div className="text-sm text-gray-900 dark:text-gray-100">{p.name}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">{fmtHired(p.hiredAt)}</div>
              </div>
              <span className="inline-flex items-center gap-2">
                <span className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 rounded-full px-2 py-0.5">
                  {t('onboardingWidget.remaining', { n: p.remaining })}
                </span>
                <span className="text-gray-400 text-xs">{expandedUserId === p.userId ? '▾' : '▸'}</span>
              </span>
            </button>

            {expandedUserId === p.userId && (
              <div className="px-4 pb-3 bg-gray-50 dark:bg-gray-900/50">
                {progressLoading ? (
                  <div className="py-3 text-center text-xs text-gray-400">{t('common.loading')}</div>
                ) : (
                  <ul className="space-y-1 mt-1">
                    {progress.map((row) => (
                      <li key={row.id}>
                        <label className="flex items-start gap-2 cursor-pointer py-1">
                          <input
                            type="checkbox"
                            checked={!!row.completedAt}
                            onChange={() => toggleTask(row)}
                            className="mt-0.5 rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className={clsx(
                            'text-sm',
                            row.completedAt
                              ? 'text-gray-400 line-through'
                              : 'text-gray-900 dark:text-gray-100'
                          )}>
                            {row.title}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
