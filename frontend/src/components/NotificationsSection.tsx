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

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

function SetupInstructions({ status }: { status: PushStatus }) {
  const ios = isIOS();
  const android = isAndroid();

  // Already enabled — no instructions needed
  if (status === 'subscribed') return null;

  // Denied — show how to fix it
  if (status === 'denied') {
    if (ios) {
      return (
        <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
            Notifications are blocked. To fix this on iPhone:
          </p>
          <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 list-decimal list-inside">
            <li>Open your iPhone <strong>Settings</strong> app</li>
            <li>Scroll down and tap <strong>Pelican</strong></li>
            <li>Tap <strong>Notifications</strong></li>
            <li>Turn on <strong>Allow Notifications</strong></li>
            <li>Come back here and tap <strong>Enable</strong></li>
          </ol>
        </div>
      );
    }
    if (android) {
      return (
        <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
            Notifications are blocked. To fix this on Android:
          </p>
          <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 list-decimal list-inside">
            <li>Open your phone <strong>Settings</strong> app</li>
            <li>Tap <strong>Apps</strong> (or <strong>Apps & notifications</strong>)</li>
            <li>Find and tap your browser (Chrome, etc.)</li>
            <li>Tap <strong>Notifications</strong> and make sure they're on</li>
            <li>Come back here and tap <strong>Enable</strong></li>
          </ol>
        </div>
      );
    }
    // Desktop
    return (
      <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
          Notifications are blocked by your browser.
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Click the lock icon in your browser's address bar, find <strong>Notifications</strong>, and change it to <strong>Allow</strong>. Then refresh the page and try again.
        </p>
      </div>
    );
  }

  // Not yet enabled — show how to get started
  if (ios) {
    return (
      <div className="mt-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
          How to enable notifications on iPhone:
        </p>
        <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1.5 list-decimal list-inside">
          <li>Make sure Pelican is installed on your home screen (tap{' '}
            <span className="inline-flex items-center">
              <svg className="h-3.5 w-3.5 inline" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
              </svg>
            </span>{' '}
            Share → <strong>Add to Home Screen</strong>)
          </li>
          <li>Open the app from your home screen</li>
          <li>Go to iPhone <strong>Settings</strong> → <strong>Pelican</strong> → <strong>Notifications</strong> → turn on <strong>Allow Notifications</strong></li>
          <li>Come back here and tap the <strong>Enable</strong> button below</li>
        </ol>
      </div>
    );
  }

  if (android) {
    return (
      <div className="mt-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
          How to enable notifications on Android:
        </p>
        <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1.5 list-decimal list-inside">
          <li>Tap the <strong>Enable</strong> button below</li>
          <li>When the popup appears, tap <strong>Allow</strong></li>
          <li>That's it — you'll receive notifications for shifts, messages, and more</li>
        </ol>
      </div>
    );
  }

  // Desktop — brief instructions
  return null;
}

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

      <SetupInstructions status={status} />

      {flash && <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{flash}</p>}
    </section>
  );
}
