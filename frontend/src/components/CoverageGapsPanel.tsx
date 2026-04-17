'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Gap {
  requirementId: string;
  locationId: string | null;
  date: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  minStaff: number;
  actual: number;
  shortfall: number;
  notes: string | null;
}

interface Props {
  rangeStart: Date;
  rangeEnd: Date;
  // Bump this when the caller mutates shifts so we re-fetch.
  refreshKey?: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Only rendered for managers (route-gated on the backend anyway — we swallow
// 403s silently so the component doesn't flicker error text for employees).
export function CoverageGapsPanel({ rangeStart, rangeEnd, refreshKey = 0 }: Props) {
  const t = useT();
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasRules, setHasRules] = useState(true);

  useEffect(() => {
    if (!token || !isManager) return;
    const qs = new URLSearchParams({
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
    });
    setLoading(true);
    api<Gap[]>(`/coverage/gaps?${qs.toString()}`, { token })
      .then((data) => {
        setGaps(data);
        // If no gaps came back, check if the org has rules at all — keeps the
        // panel hidden for orgs that never configured coverage, instead of
        // showing "✓ covered" noise.
        if (data.length === 0) {
          api<unknown[]>('/coverage/requirements', { token })
            .then((reqs) => setHasRules(reqs.length > 0))
            .catch(() => setHasRules(false));
        } else {
          setHasRules(true);
        }
      })
      .catch(() => {
        setGaps([]);
        setHasRules(false);
      })
      .finally(() => setLoading(false));
  }, [token, isManager, rangeStart.getTime(), rangeEnd.getTime(), refreshKey]);

  if (!isManager || !hasRules) return null;
  if (loading && gaps.length === 0) return null;

  if (gaps.length === 0) {
    return (
      <div className="mb-4 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 px-3 py-2 text-xs text-green-700 dark:text-green-300">
        {t('coverageGaps.met')}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3">
      <div className="flex items-start gap-2">
        <svg className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <div className="flex-1">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            {t('coverageGaps.gapCount', { n: gaps.length })}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {gaps.slice(0, 10).map((g, i) => (
              <li key={i} className="text-xs text-amber-800 dark:text-amber-200">
                <span className="font-mono">{g.date}</span>
                {' '}{DAYS[g.dayOfWeek]}{' '}
                <span className="font-mono">{g.startTime}–{g.endTime}</span>
                {' · '}
                <span className={clsx('font-medium', g.actual === 0 && 'text-red-700 dark:text-red-300')}>
                  {g.actual}/{g.minStaff}
                </span>
                {' '}{t('coverageGaps.short', { n: g.shortfall })}
              </li>
            ))}
            {gaps.length > 10 && (
              <li className="text-[10px] text-amber-700 dark:text-amber-400">
                {t('coverageGaps.more', { n: gaps.length - 10 })}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
