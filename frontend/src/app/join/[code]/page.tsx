'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { loadSession } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [validating, setValidating] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ organizationName: string }>(`/auth/join/${code}`)
      .then((data) => {
        setOrgName(data.organizationName);
        setValidating(false);
      })
      .catch(() => {
        setInvalid(true);
        setValidating(false);
      });
  }, [code]);

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api<{ token: string; user: any }>('/auth/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode: code, ...form }),
      });
      localStorage.setItem('token', res.token);
      await loadSession();
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to join');
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </main>
    );
  }

  if (invalid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-3xl font-bold text-indigo-600 mb-4">Pelican</h1>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Invalid Invite Link</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              This invite link is no longer valid. Ask your manager for a new one.
            </p>
            <a href="/login" className="text-sm text-indigo-600 hover:underline">Go to login</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold text-center text-indigo-600 mb-8">Pelican</h1>
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Join {orgName}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Create your account to get started.</p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name</label>
              <input
                type="text" required value={form.firstName}
                onChange={(e) => update('firstName', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name</label>
              <input
                type="text" required value={form.lastName}
                onChange={(e) => update('lastName', e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email" required value={form.email}
              onChange={(e) => update('email', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone (optional)</label>
            <input
              type="tel" value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="+1 555-123-4567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password" required minLength={6} value={form.password}
              onChange={(e) => update('password', e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
          >
            {loading ? 'Joining...' : 'Join'}
          </button>

          <p className="text-sm text-center text-gray-500 dark:text-gray-400">
            Already have an account?{' '}
            <a href="/login" className="text-indigo-600 hover:underline">Sign in</a>
          </p>
        </form>
      </div>
    </main>
  );
}
