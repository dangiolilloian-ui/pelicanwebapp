'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Config {
  windowDays: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  pointsNoShow: number;
  pointsLate: number;
  pointsEarlyOut: number;
  thresholdWarn: number;
  thresholdFinal: number;
}

interface Response {
  defaults: Config;
  overrides: Partial<Config> | null;
  effective: Config;
}

export function AttendanceConfigSection() {
  const { token, user } = useAuth();
  const t = useT();
  const isOwner = user?.role === 'OWNER';
  const [data, setData] = useState<Response | null>(null);
  const [form, setForm] = useState<Partial<Config>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const FIELDS: { key: keyof Config; label: string; hint?: string }[] = [
    { key: 'windowDays', label: t('attendanceConfig.windowDays'), hint: t('attendanceConfig.windowHint') },
    { key: 'lateMinutes', label: t('attendanceConfig.lateGrace'), hint: t('attendanceConfig.lateHint') },
    { key: 'earlyOutMinutes', label: t('attendanceConfig.earlyOutGrace') },
    { key: 'pointsNoShow', label: t('attendanceConfig.pointsNoShow') },
    { key: 'pointsLate', label: t('attendanceConfig.pointsLate') },
    { key: 'pointsEarlyOut', label: t('attendanceConfig.pointsEarlyOut') },
    { key: 'thresholdWarn', label: t('attendanceConfig.warnAt'), hint: t('attendanceConfig.warnHint') },
    { key: 'thresholdFinal', label: t('attendanceConfig.finalAt'), hint: t('attendanceConfig.finalHint') },
  ];

  useEffect(() => {
    if (!token) return;
    api<Response>('/org/attendance-config', { token })
      .then((d) => {
        setData(d);
        setForm(d.overrides || { ...d.defaults });
      })
      .catch((err) => console.error('Failed to load attendance config', err));
  }, [token]);

  if (!data) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await api<Response>('/org/attendance-config', {
        token,
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setData(res);
      setForm(res.overrides || { ...res.defaults });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!token || !confirm(t('attendanceConfig.revertConfirm'))) return;
    setSaving(true);
    try {
      const res = await api<Response>('/org/attendance-config', {
        token,
        method: 'PUT',
        body: JSON.stringify({}),
      });
      setData(res);
      setForm({ ...res.defaults });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('attendanceConfig.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {data.overrides ? t('attendanceConfig.descCustom') : t('attendanceConfig.descDefault')}
        {!isOwner && ` ${t('attendanceConfig.ownerOnly')}`}
      </p>

      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {f.label}
              </label>
              <input
                type="number" min="0" step="1"
                disabled={!isOwner}
                value={form[f.key] ?? data.defaults[f.key]}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm disabled:opacity-50"
              />
              {f.hint && (
                <p className="text-[10px] text-gray-400 mt-1 leading-tight">{f.hint}</p>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit" disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('attendanceConfig.savePolicy')}
            </button>
            {data.overrides && (
              <button
                type="button" onClick={reset} disabled={saving}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t('attendanceConfig.revertToDefaults')}
              </button>
            )}
            {saved && <span className="text-xs text-green-600">{t('common.saved')}</span>}
          </div>
        )}
      </form>
    </section>
  );
}
