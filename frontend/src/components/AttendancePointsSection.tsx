'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface PointsIncident {
  kind: 'noShow' | 'late' | 'earlyOut';
  pts: number;
  shiftId: string;
  startTime?: string;
  endTime?: string;
  clockIn?: string;
  clockOut?: string;
  lateMinutes?: number;
  earlyMinutes?: number;
}

interface PointsRow {
  id: string;
  name: string;
  points: number;
  status: 'clear' | 'warn' | 'final';
  noShow: number;
  late: number;
  earlyOut: number;
  incidents: PointsIncident[];
}

interface PointsResponse {
  config: {
    windowDays: number;
    thresholdWarn: number;
    thresholdFinal: number;
    pointsNoShow: number;
    pointsLate: number;
    pointsEarlyOut: number;
  };
  windowStart: string;
  byEmployee: PointsRow[];
}

const statusStyles: Record<string, string> = {
  clear: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  final: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function AttendancePointsSection() {
  const { token } = useAuth();
  const t = useT();
  const [data, setData] = useState<PointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<PointsResponse>('/reports/attendance-points', { token })
      .then(setData)
      .catch((err) => console.error('Failed to load attendance points', err))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mt-4">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (!data) return null;

  const { config, windowStart, byEmployee } = data;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mt-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('attendancePoints.title')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('attendancePoints.desc', {
              window: config.windowDays,
              date: new Date(windowStart).toLocaleDateString(),
              noShow: config.pointsNoShow,
              late: config.pointsLate,
              early: config.pointsEarlyOut,
              warn: config.thresholdWarn,
              final: config.thresholdFinal,
            })}
          </p>
        </div>
      </div>

      {byEmployee.length === 0 ? (
        <p className="text-sm text-gray-400">{t('attendancePoints.cleanSheet')}</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {byEmployee.map((row) => {
            const isOpen = expanded === row.id;
            return (
              <div key={row.id} className="py-2">
                <button
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {row.name}
                    </span>
                    <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase', statusStyles[row.status])}>
                      {row.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    <span>{t('attendancePoints.noShowCount', { n: row.noShow })}</span>
                    <span>{t('attendancePoints.lateCount', { n: row.late })}</span>
                    <span>{t('attendancePoints.earlyCount', { n: row.earlyOut })}</span>
                    <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {row.points}
                    </span>
                  </div>
                </button>
                {isOpen && row.incidents.length > 0 && (
                  <ul className="mt-2 ml-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
                    {row.incidents.map((inc, i) => (
                      <li key={i} className="flex items-center justify-between">
                        <span>
                          <span className="font-mono text-[10px] bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 mr-2">
                            {inc.kind === 'noShow' ? t('attendance.noShowBadge') : inc.kind === 'late' ? t('attendance.lateBadge') : t('attendance.earlyOutBadge')}
                          </span>
                          {inc.kind === 'noShow' && inc.startTime && (
                            <>{t('attendance.shiftDate', { date: new Date(inc.startTime).toLocaleString() })}</>
                          )}
                          {inc.kind === 'late' && inc.lateMinutes !== undefined && (
                            <>{t('attendance.minLate', { n: inc.lateMinutes, date: new Date(inc.startTime!).toLocaleString() })}</>
                          )}
                          {inc.kind === 'earlyOut' && inc.earlyMinutes !== undefined && (
                            <>{t('attendance.leftEarly', { n: inc.earlyMinutes, date: new Date(inc.endTime!).toLocaleString() })}</>
                          )}
                        </span>
                        <span className="text-gray-400">+{inc.pts}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
