'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // We always show the same "check your inbox" confirmation, regardless of
  // whether the email matched an account — mirrors the backend behavior so
  // the UI doesn't leak account existence either.
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch (err: any) {
      // Most likely a network / rate-limit error. Show a gentle message
      // without revealing anything about whether the email exists.
      setError(err.message || t('auth.forgotErrorGeneric'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pelican-logo.png" alt="Pelican Shops" className="h-20 w-auto mb-3" />
        </div>

        {done ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4 text-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('auth.checkYourInbox')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('auth.resetSentHint')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {t('auth.resetSentSpam')}
            </p>
            <a
              href="/login"
              className="inline-block text-sm text-indigo-600 hover:underline pt-2"
            >
              {t('auth.backToLogin')}
            </a>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4"
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('auth.forgotTitle')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
              {t('auth.forgotSub')}
            </p>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('auth.email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="you@company.com"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {submitting ? t('auth.sending') : t('auth.sendResetLink')}
            </button>

            <p className="text-sm text-center text-gray-500 dark:text-gray-400 pt-1">
              <a href="/login" className="text-indigo-600 hover:underline">
                {t('auth.backToLogin')}
              </a>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
