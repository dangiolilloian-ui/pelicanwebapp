'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface ChecklistItem {
  id: string;
  label: string;
  position: number;
  completedAt: string | null;
  completedByUserId: string | null;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  locationId: string | null;
  items: ChecklistItem[];
}

interface ActiveEntry {
  id: string;
  shiftId: string | null;
}

// Employee-facing card: surfaces the checklists attached to the location of
// the shift they're currently clocked in to. Hides itself when the employee
// isn't clocked in or the shift has no checklist items.
export function ShiftChecklistCard() {
  const t = useT();
  const { token } = useAuth();
  const [active, setActive] = useState<ActiveEntry | null>(null);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const loadChecklist = useCallback(
    async (shiftId: string) => {
      if (!token) return;
      try {
        const data = await api<ChecklistTemplate[]>(`/shifts/${shiftId}/checklist`, { token });
        setTemplates(data);
      } catch (err) {
        console.error(err);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<ActiveEntry | null>('/timeclock/active', { token })
      .then((entry) => {
        if (cancelled) return;
        setActive(entry);
        if (entry?.shiftId) loadChecklist(entry.shiftId);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [token, loadChecklist]);

  if (!active || !active.shiftId) return null;
  const items = templates.flatMap((t) => t.items);
  if (items.length === 0) return null;

  const total = items.length;
  const done = items.filter((i) => i.completedAt).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const toggle = async (item: ChecklistItem) => {
    if (!token || !active.shiftId) return;
    setBusyItem(item.id);
    try {
      if (item.completedAt) {
        await api(`/shifts/${active.shiftId}/checklist/${item.id}`, { token, method: 'DELETE' });
      } else {
        await api(`/shifts/${active.shiftId}/checklist/${item.id}`, { token, method: 'POST' });
      }
      await loadChecklist(active.shiftId);
    } finally {
      setBusyItem(null);
    }
  };

  return (
    <div className="rounded-xl border border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-white dark:from-green-900/20 dark:to-gray-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">
            {t('shiftChecklist.title')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('shiftChecklist.progress', { done, total, pct })}
          </p>
        </div>
        <div className="h-2 w-32 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
          <div
            className={clsx(
              'h-full transition-all',
              pct >= 100 ? 'bg-green-500' : 'bg-green-400'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {templates.map((t) => (
          <div key={t.id}>
            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">
              {t.name}
            </p>
            <ul className="space-y-1">
              {t.items.map((i) => {
                const isDone = !!i.completedAt;
                return (
                  <li key={i.id}>
                    <button
                      onClick={() => toggle(i)}
                      disabled={busyItem === i.id}
                      className={clsx(
                        'w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 text-sm transition',
                        isDone
                          ? 'bg-green-50 dark:bg-green-900/30 text-gray-500 dark:text-gray-400 line-through'
                          : 'hover:bg-white dark:hover:bg-gray-800 text-gray-900 dark:text-gray-100'
                      )}
                    >
                      <span
                        className={clsx(
                          'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                          isDone
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-400'
                        )}
                      >
                        {isDone && <span className="text-[10px] leading-none">✓</span>}
                      </span>
                      <span>{i.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
