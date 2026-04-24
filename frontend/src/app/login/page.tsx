'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { LocaleToggle } from '@/components/LocaleToggle';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await login(email, password, needsTotp ? totp : undefined);
      if (res.requires2fa) {
        // Server says we need a second factor. Switch UI to the code prompt
        // and let the user submit again.
        setNeedsTotp(true);
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      // Friendly override for the deactivated-account case — the raw backend
      // string is fine, but the translated copy is clearer and doesn't look
      // like a typo/network error.
      if (err.code === 'DEACTIVATED') {
        setError(t('auth.accountDeactivated'));
      } else {
        setError(err.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pelican-logo.png"
            alt="Pelican Shops"
            className="h-20 w-auto mb-3"
          />
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('app.tagline')}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('auth.welcome')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">{t('auth.welcomeSub')}</p>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('auth.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('auth.password')}</label>
              <a href="/forgot-password" className="text-xs text-indigo-600 hover:underline">
                {t('auth.forgotPassword')}
              </a>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {needsTotp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Authentication code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoFocus
                required
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-base tracking-widest text-center font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Open your authenticator app and enter the 6-digit code.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {loading ? t('auth.signingIn') : t('auth.signIn')}
          </button>

          <div className="flex justify-center pt-1">
            <LocaleToggle />
          </div>

          <p className="text-sm text-center text-gray-500 dark:text-gray-400">
            Don&apos;t have an account?{' '}
            <a href="/register" className="text-indigo-600 hover:underline">Get started</a>
          </p>
        </form>
      </div>
    </main>
  );
}
