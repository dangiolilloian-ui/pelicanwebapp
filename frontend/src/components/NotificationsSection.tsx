'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import {
  getPushStatus,
  subscribePush,
  unsubscribePush,
  sendTestPush,
  pushSupported,
  type PushStatus,
} from '@/lib/push';

// Per-user push notification controls.  Visible to everyone (employees need
// push just as much as managers do).  The section auto-hides on browsers
// that can't do web-push at all (desktop Safari before 16.4, some private
// modes, etc.) rather than showing a disabled button that's just noise.

export function NotificationsSection() {
  const { token } = useAuth();
  const t = useT();
  const [status, setStatus] = useState<PushStatus>('unknown');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    getPushStatus().then(setStatus);
  }, []);

  if (!pushSupported()) return null;

  const enable = async () => {
    if (!token) return;
    setBusy(true);
    setFlash(null);
    try {
      const s = await subscribePush(token);
      setStatus(s);
      if (s === 'denied') setFlash(t('pushNotifications.permissionDenied'));
    } catch (err: any) {
      setFlash(err?.message || t('pushNotifications.enableFailed'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!token) return;
    setBusy(true);
    setFlash(null);
    try {
      const s = await unsubscribePush(token);
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!token) return;
    setBusy(true);
    setFlash(null);
    try {
      const r = await sendTestPush(token);
      if (r.sent > 0) {
        setFlash(t('pushNotifications.testSent', { n: r.sent }));
      } else if ((r as any).subscriptions === 0) {
        setFlash('No push subscriptions found for your account. Try disabling and re-enabling.');
      } else {
        const errs = (r as any).errors?.join('; ') || 'unknown error';
        setFlash(`Push failed: ${errs}`);
      }
    } catch (err: any) {
      setFlash(err?.message || t('pushNotifications.testFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('pushNotifications.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('pushNotifications.desc')}
      </p>

      <div className="flex items-center gap-3">
        <span
          className={
            status === 'subscribed'
              ? 'inline-flex h-2 w-2 rounded-full bg-green-500'
              : status === 'denied'
              ? 'inline-flex h-2 w-2 rounded-full bg-red-500'
              : 'inline-flex h-2 w-2 rounded-full bg-gray-400'
          }
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {status === 'subscribed'
            ? t('pushNotifications.enabled')
            : status === 'denied'
            ? t('pushNotifications.blocked')
            : t('pushNotifications.notEnabled')}
        </span>

        <div className="ml-auto flex gap-2">
          {status === 'subscribed' ? (
            <>
              <button
                onClick={test}
                disabled={busy}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {t('pushNotifications.sendTest')}
              </button>
              <button
                onClick={disable}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t('pushNotifications.disable')}
              </button>
            </>
          ) : (
            <button
              onClick={enable}
              disabled={busy || status === 'denied'}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {t('pushNotifications.enable')}
            </button>
          )}
        </div>
      </div>

      {flash && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{flash}</p>}
    </section>
  );
}
