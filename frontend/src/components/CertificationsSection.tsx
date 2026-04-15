'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useTeam } from '@/hooks/useTeam';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Certification {
  id: string;
  userId: string;
  name: string;
  issuedAt: string | null;
  expiresAt: string | null;
  reference: string | null;
  user?: { id: string; firstName: string; lastName: string };
}

function certStatus(expiresAt: string | null): 'expired' | 'soon' | 'ok' | 'none' {
  if (!expiresAt) return 'none';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) return 'expired';
  if (ms < 30 * 24 * 3600 * 1000) return 'soon';
  return 'ok';
}

export function CertificationsSection() {
  const t = useT();
  const { token } = useAuth();
  const { members } = useTeam();
  const COMMON_CERTS = [
    t('certs.foodHandler'),
    t('certs.alcoholServer'),
    t('certs.firstAid'),
    t('certs.forklift'),
    t('certs.keyHolder'),
  ];
  const [items, setItems] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCert, setNewCert] = useState({ userId: '', name: '', issuedAt: '', expiresAt: '', reference: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api<Certification[]>('/certifications', { token })
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newCert.userId || !newCert.name.trim()) return;
    setSaving(true);
    try {
      await api('/certifications', {
        token,
        method: 'POST',
        body: JSON.stringify({
          userId: newCert.userId,
          name: newCert.name.trim(),
          issuedAt: newCert.issuedAt || null,
          expiresAt: newCert.expiresAt || null,
          reference: newCert.reference.trim() || null,
        }),
      });
      setNewCert({ userId: '', name: '', issuedAt: '', expiresAt: '', reference: '' });
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token) return;
    if (!confirm(t('certs.removeConfirm'))) return;
    await api(`/certifications/${id}`, { token, method: 'DELETE' });
    load();
  };

  return (
    <section>
      <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">{t('certs.title')}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('certs.desc')}
      </p>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {loading ? (
          <div className="px-4 py-3 text-sm text-gray-400">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-3 text-sm text-gray-400">{t('certs.noCerts')}</div>
        ) : (
          items.map((c) => {
            const s = certStatus(c.expiresAt);
            return (
              <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    <span className="font-medium">{c.name}</span>
                    {' — '}
                    {c.user ? `${c.user.firstName} ${c.user.lastName}` : '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {c.issuedAt && t('certs.issued', { date: new Date(c.issuedAt).toLocaleDateString() })}
                    {c.issuedAt && c.expiresAt && ' · '}
                    {c.expiresAt && t('certs.expires', { date: new Date(c.expiresAt).toLocaleDateString() })}
                    {c.reference && ` · #${c.reference}`}
                  </p>
                </div>
                <span
                  className={clsx(
                    'text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5',
                    s === 'expired' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                    s === 'soon' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                    s === 'ok' && 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
                    s === 'none' && 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  )}
                >
                  {s === 'expired' ? t('certs.expired') : s === 'soon' ? t('certs.expiring') : s === 'ok' ? t('certs.valid') : t('certs.noExpiry')}
                </span>
                <button onClick={() => remove(c.id)} className="text-xs text-red-500 hover:text-red-700">
                  {t('common.remove')}
                </button>
              </div>
            );
          })
        )}
        <form onSubmit={add} className="flex flex-wrap items-center gap-2 px-4 py-3">
          <select
            value={newCert.userId}
            onChange={(e) => setNewCert({ ...newCert, userId: e.target.value })}
            required
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
          >
            <option value="">{t('certs.employeePlaceholder')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </select>
          <input
            list="cert-name-suggestions"
            required
            value={newCert.name}
            onChange={(e) => setNewCert({ ...newCert, name: e.target.value })}
            placeholder={t('certs.credentialPlaceholder')}
            className="flex-1 min-w-[140px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          />
          <datalist id="cert-name-suggestions">
            {COMMON_CERTS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input
            type="date"
            value={newCert.issuedAt}
            onChange={(e) => setNewCert({ ...newCert, issuedAt: e.target.value })}
            title="Issued date"
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs"
          />
          <input
            type="date"
            value={newCert.expiresAt}
            onChange={(e) => setNewCert({ ...newCert, expiresAt: e.target.value })}
            title="Expires"
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs"
          />
          <input
            value={newCert.reference}
            onChange={(e) => setNewCert({ ...newCert, reference: e.target.value })}
            placeholder={t('certs.refPlaceholder')}
            className="w-28 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? t('certs.adding') : t('common.add')}
          </button>
        </form>
      </div>
    </section>
  );
}
