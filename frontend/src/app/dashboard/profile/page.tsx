'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { AvailabilityModal } from '@/components/AvailabilityModal';
import { NotificationsSection } from '@/components/NotificationsSection';
import { TwoFactorSection } from '@/components/TwoFactorSection';
import type { User } from '@/types';
import { useT } from '@/lib/i18n';

interface PtoBalance {
  balance: number;
  ytdAccrued: number;
  annualCap: number;
  remainingAccrualHeadroom: number;
  enabled: boolean;
}

interface Me {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  icalToken: string | null;
}

export default function ProfilePage() {
  const { token } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [editAvailability, setEditAvailability] = useState(false);
  const [pto, setPto] = useState<PtoBalance | null>(null);
  const t = useT();

  const load = async () => {
    if (!token) return;
    try {
      const [meData, ptoData] = await Promise.all([
        api<Me>('/users/me', { token }),
        // PTO may be disabled per org — swallow any failure silently and just
        // hide the section instead of showing an error on the profile page.
        api<PtoBalance>('/pto/balance', { token }).catch(() => null),
      ]);
      setMe(meData);
      setPto(ptoData);
    } catch (e: any) {
      setError(e.message || t('profile.loadFailed'));
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const buildUrl = (tok: string) => {
    if (typeof window === 'undefined') return '';
    // /ical is proxied by Next.js rewrites to the backend, so it lives on the
    // same origin as the app — works locally and through any reverse proxy.
    return `${window.location.origin}/ical/${tok}.ics`;
  };

  const regenerate = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const resp = await api<{ icalToken: string }>('/users/me/ical-token', { token, method: 'POST' });
      setMe((m) => (m ? { ...m, icalToken: resp.icalToken } : m));
    } catch (e: any) {
      setError(e.message || t('profile.regenerateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  if (!me) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const url = me.icalToken ? buildUrl(me.icalToken) : '';

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('profile.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('profile.desc')}</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Account */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('profile.account')}</h2>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">{t('profile.name')}</dt>
          <dd className="col-span-2 text-gray-900 dark:text-gray-100">{me.firstName} {me.lastName}</dd>
          <dt className="text-gray-500 dark:text-gray-400">{t('profile.email')}</dt>
          <dd className="col-span-2 text-gray-900 dark:text-gray-100">{me.email}</dd>
          <dt className="text-gray-500 dark:text-gray-400">{t('profile.role')}</dt>
          <dd className="col-span-2 text-gray-900 dark:text-gray-100">{me.role}</dd>
        </dl>
      </section>

      {/* PTO balance */}
      {pto?.enabled && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('profile.paidTimeOff')}</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-2xl font-semibold text-indigo-600">{pto.balance.toFixed(1)}<span className="text-sm text-gray-500 ml-1">h</span></div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('profile.available')}</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{pto.ytdAccrued.toFixed(1)}<span className="text-sm text-gray-500 ml-1">h</span></div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('profile.earnedThisYear')}</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{pto.annualCap}<span className="text-sm text-gray-500 ml-1">h</span></div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('profile.annualCap')}</div>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            {t('profile.ptoInfo')}
          </p>
        </section>
      )}

      {/* Weekly availability */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('profile.weeklyAvailability')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
          {t('profile.availabilityDesc')}
        </p>
        <button
          onClick={() => setEditAvailability(true)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {t('profile.editAvailability')}
        </button>
      </section>

      {editAvailability && (
        <AvailabilityModal
          member={me as unknown as User}
          onClose={() => setEditAvailability(false)}
        />
      )}

      {/* Push notifications */}
      <NotificationsSection />

      {/* Two-factor authentication */}
      <TwoFactorSection />

      {/* iCal */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('profile.calendarFeed')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
          {t('profile.calendarDesc')}
        </p>

        {me.icalToken ? (
          <>
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs font-mono text-gray-700 dark:text-gray-300"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={() => copy(url)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t('profile.keepPrivate')}
              </p>
              <button
                onClick={regenerate}
                disabled={busy}
                className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {busy ? t('profile.regenerating') : t('profile.regenerate')}
              </button>
            </div>

            <details className="mt-4 text-xs text-gray-600 dark:text-gray-400">
              <summary className="cursor-pointer hover:text-gray-900 dark:hover:text-gray-200">{t('profile.howToSubscribe')}</summary>
              <ul className="mt-2 ml-4 list-disc space-y-1">
                <li>{t('profile.googleCalInstructions')}</li>
                <li>{t('profile.appleCalInstructions')}</li>
                <li>{t('profile.outlookInstructions')}</li>
              </ul>
            </details>
          </>
        ) : (
          <button
            onClick={regenerate}
            disabled={busy}
            className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? t('profile.generating') : t('profile.generateUrl')}
          </button>
        )}
      </section>
    </div>
  );
}
