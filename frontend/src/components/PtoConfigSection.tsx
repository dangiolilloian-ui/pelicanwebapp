'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Config {
  enabled: boolean;
  accrualRatePerHour: number;
  annualCapHours: number;
  allowNegative: boolean;
}

interface Response {
  defaults: Config;
  overrides: Partial<Config> | null;
  effective: Config;
}

export function PtoConfigSection() {
  const { token, user } = useAuth();
  const t = useT();
  const isOwner = user?.role === 'OWNER';
  const [data, setData] = useState<Response | null>(null);
  const [form, setForm] = useState<Partial<Config>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<Response>('/pto/config', { token })
      .then((d) => {
        setData(d);
        setForm(d.overrides || { ...d.defaults });
      })
      .catch((err) => console.error('Failed to load PTO config', err));
  }, [token]);

  if (!data) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await api<Response>('/pto/config', {
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
    if (!token || !confirm(t('ptoConfig.revertConfirm'))) return;
    setSaving(true);
    try {
      const res = await api<Response>('/pto/config', {
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

  // Convenience: show the hours-per-worked-hour ratio as "1h per Nh worked"
  // since that's how retail orgs think about accrual.
  const rate = form.accrualRatePerHour ?? data.defaults.accrualRatePerHour;
  const hoursPerPtoHour = rate > 0 ? (1 / rate).toFixed(1) : '∞';

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('ptoConfig.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('ptoConfig.desc')}
        {!isOwner && ` ${t('ptoConfig.ownerOnly')}`}
      </p>

      <form onSubmit={save} className="space-y-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={!isOwner}
            checked={form.enabled ?? data.defaults.enabled}
            onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
            className="rounded"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">{t('ptoConfig.enabled')}</span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('ptoConfig.accrualRate')}
            </label>
            <input
              type="number" min="0" step="0.001"
              disabled={!isOwner}
              value={form.accrualRatePerHour ?? data.defaults.accrualRatePerHour}
              onChange={(e) => setForm((p) => ({ ...p, accrualRatePerHour: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <p className="text-[10px] text-gray-400 mt-1">{t('ptoConfig.accrualHint', { n: hoursPerPtoHour })}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ptoConfig.annualCap')}</label>
            <input
              type="number" min="0" step="1"
              disabled={!isOwner}
              value={form.annualCapHours ?? data.defaults.annualCapHours}
              onChange={(e) => setForm((p) => ({ ...p, annualCapHours: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <p className="text-[10px] text-gray-400 mt-1">{t('ptoConfig.capHint')}</p>
          </div>
          <div>
            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                disabled={!isOwner}
                checked={form.allowNegative ?? data.defaults.allowNegative}
                onChange={(e) => setForm((p) => ({ ...p, allowNegative: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t('ptoConfig.allowNegative')}</span>
            </label>
            <p className="text-[10px] text-gray-400 mt-1">{t('ptoConfig.negativeHint')}</p>
          </div>
        </div>

        {isOwner && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit" disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('ptoConfig.savePolicy')}
            </button>
            {data.overrides && (
              <button
                type="button" onClick={reset} disabled={saving}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t('ptoConfig.revertToDefaults')}
              </button>
            )}
            {saved && <span className="text-xs text-green-600">{t('common.saved')}</span>}
          </div>
        )}
      </form>
    </section>
  );
}
