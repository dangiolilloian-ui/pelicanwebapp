'use client';

import { useState, useEffect, useRef } from 'react';

// Extend the Window interface for the beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

const DISMISSED_KEY = 'pwa-install-dismissed';
const DISMISS_DAYS = 7; // Show again after 7 days if dismissed

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

function wasDismissedRecently(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const val = localStorage.getItem(DISMISSED_KEY);
  if (!val) return false;
  const dismissed = parseInt(val, 10);
  const daysSince = (Date.now() - dismissed) / (1000 * 60 * 60 * 24);
  return daysSince < DISMISS_DAYS;
}

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [dismissed, setDismissed] = useState(true); // Start hidden until we know
  const [installing, setInstalling] = useState(false);
  const prompted = useRef(false);

  useEffect(() => {
    // Already installed as PWA — never show
    if (isStandalone()) return;

    // User dismissed recently
    if (wasDismissedRecently()) return;

    // On iOS Safari, show the manual instructions guide
    if (isIOS()) {
      setShowIOSGuide(true);
      setDismissed(false);
      return;
    }

    // On Chrome/Edge/Android, listen for the install prompt event
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If the app gets installed while the banner is showing, hide it
    const installed = () => {
      setDeferredPrompt(null);
      setDismissed(true);
    };
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {}
  };

  const installNative = async () => {
    if (!deferredPrompt || prompted.current) return;
    prompted.current = true;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDismissed(true);
      } else {
        prompted.current = false;
      }
    } catch {
      prompted.current = false;
    } finally {
      setInstalling(false);
    }
  };

  if (dismissed) return null;

  // iOS instructions
  if (showIOSGuide) {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Install Pelican on your phone
            </p>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1 leading-relaxed">
              Tap the{' '}
              <span className="inline-flex items-center">
                <svg className="h-4 w-4 inline -mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
                </svg>
              </span>{' '}
              <strong>Share</strong> button, then tap <strong>"Add to Home Screen"</strong>.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="flex-shrink-0 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
            aria-label="Dismiss"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Chrome / Android / Edge native install
  if (deferredPrompt) {
    return (
      <div className="mx-4 mt-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 text-indigo-600 dark:text-indigo-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Install Pelican
            </p>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              Add to your home screen for quick access and push notifications.
            </p>
          </div>
          <button
            onClick={installNative}
            disabled={installing}
            className="flex-shrink-0 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
          <button
            onClick={dismiss}
            className="flex-shrink-0 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200"
            aria-label="Dismiss"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return null;
}
