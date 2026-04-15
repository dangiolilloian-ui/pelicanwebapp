'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { User } from '@/types';

interface AvailabilityEntry {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  available: boolean;
}

export function AvailabilityModal({ member, onClose }: { member: User; onClose: () => void }) {
  const { token } = useAuth();
  const t = useT();
  const DAYS = [t('availability.sun'), t('availability.mon'), t('availability.tue'), t('availability.wed'), t('availability.thu'), t('availability.fri'), t('availability.sat')];
  const [entries, setEntries] = useState<AvailabilityEntry[]>(
    DAYS.map((_, i) => ({ dayOfWeek: i, startTime: '09:00', endTime: '17:00', available: true }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<AvailabilityEntry[]>(`/availability/${member.id}`, { token })
      .then((data) => {
        if (data.length > 0) {
          const map = new Map(data.map((d) => [d.dayOfWeek, d]));
          setEntries(
            DAYS.map((_, i) =>
              map.get(i) || { dayOfWeek: i, startTime: '09:00', endTime: '17:00', available: true }
            )
          );
        }
      })
      .finally(() => setLoading(false));
  }, [token, member.id]);

  const update = (day: number, field: keyof AvailabilityEntry, value: any) => {
    setEntries((prev) => prev.map((e) => (e.dayOfWeek === day ? { ...e, [field]: value } : e)));
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await api(`/availability/${member.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ entries }),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('availability.title', { name: `${member.firstName} ${member.lastName}` })}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('availability.desc')}</p>

        {loading ? (
          <div className="py-8 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.dayOfWeek} className="flex items-center gap-3">
                <div className="w-12 text-sm font-medium text-gray-700 dark:text-gray-300">{DAYS[e.dayOfWeek]}</div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={e.available}
                    onChange={(ev) => update(e.dayOfWeek, 'available', ev.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('availability.available')}</span>
                </label>
                <input
                  type="time"
                  disabled={!e.available}
                  value={e.startTime}
                  onChange={(ev) => update(e.dayOfWeek, 'startTime', ev.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 dark:bg-gray-900 disabled:text-gray-400"
                />
                <span className="text-xs text-gray-400">—</span>
                <input
                  type="time"
                  disabled={!e.available}
                  value={e.endTime}
                  onChange={(ev) => update(e.dayOfWeek, 'endTime', ev.target.value)}
                  className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 dark:bg-gray-900 disabled:text-gray-400"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
