'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Certification {
  id: string;
  name: string;
  expiresAt: string | null;
  user?: { id: string; firstName: string; lastName: string };
}

// Manager-only heads-up: which credentials need chasing this month?
// Combines already-expired (red) + expiring within 30 days (amber) into one
// card so it's one glance, not two.
export function ExpiringCertsCard() {
  const t = useT();
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const [expired, setExpired] = useState<Certification[]>([]);
  const [soon, setSoon] = useState<Certification[]>([]);

  useEffect(() => {
    if (!token || !isManager) return;
    let cancelled = false;
    Promise.all([
      api<Certification[]>('/certifications?status=expired', { token }),
      api<Certification[]>('/certifications?status=expiring', { token }),
    ])
      .then(([e, s]) => {
        if (cancelled) return;
        setExpired(e);
        setSoon(s);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [token, isManager]);

  if (!isManager) return null;
  if (expired.length === 0 && soon.length === 0) return null;

  const fmt = (c: Certification) => {
    const who = c.user ? `${c.user.firstName} ${c.user.lastName}` : '—';
    const when = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '';
    return `${who} · ${c.name} · ${when}`;
  };

  return (
    <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {t('expiringCerts.title', { n: expired.length + soon.length })}
          </p>
          {expired.length > 0 && (
            <div className="mt-1">
              <p className="text-[11px] font-semibold text-red-700 dark:text-red-300 uppercase">{t('expiringCerts.expired')}</p>
              <ul className="text-xs text-red-800 dark:text-red-200 space-y-0.5">
                {expired.slice(0, 5).map((c) => (
                  <li key={c.id}>• {fmt(c)}</li>
                ))}
                {expired.length > 5 && <li className="opacity-70">{t('expiringCerts.more', { n: expired.length - 5 })}</li>}
              </ul>
            </div>
          )}
          {soon.length > 0 && (
            <div className="mt-1">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 uppercase">{t('expiringCerts.expiringSoon')}</p>
              <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
                {soon.slice(0, 5).map((c) => (
                  <li key={c.id}>• {fmt(c)}</li>
                ))}
                {soon.length > 5 && <li className="opacity-70">{t('expiringCerts.more', { n: soon.length - 5 })}</li>}
              </ul>
            </div>
          )}
        </div>
        <a href="/dashboard/settings" className="text-xs text-indigo-600 hover:underline shrink-0">
          {t('expiringCerts.manage')}
        </a>
      </div>
    </div>
  );
}
