'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

// TOTP 2FA setup flow.  Visible to every authenticated user — an employee
// who wants the extra protection on their own account can enable it too,
// even though managers are the primary audience.

interface Status {
  enabled: boolean;
  pending: boolean;
}

interface SetupPayload {
  otpauthUrl: string;
  secret: string;
  qrDataUrl: string;
}

export function TwoFactorSection() {
  const { token } = useAuth();
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [code, setCode] = useState('');
  const [disablePwd, setDisablePwd] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      const s = await api<Status>('/auth/2fa/status', { token });
      setStatus(s);
    } catch {}
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const startSetup = async () => {
    if (!token) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await api<SetupPayload>('/auth/2fa/setup', {
        token,
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSetup(res);
    } catch (err: any) {
      setFlash({ kind: 'err', msg: err?.message || t('twoFactor.setupFailed') });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async () => {
    if (!token) return;
    setBusy(true);
    setFlash(null);
    try {
      await api('/auth/2fa/enable', {
        token,
        method: 'POST',
        body: JSON.stringify({ totp: code }),
      });
      setSetup(null);
      setCode('');
      setFlash({ kind: 'ok', msg: t('twoFactor.enabledFlash') });
      load();
    } catch (err: any) {
      setFlash({ kind: 'err', msg: err?.message || t('twoFactor.verifyFailed') });
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async () => {
    if (!token) return;
    if (!confirm(t('twoFactor.disableConfirm'))) return;
    setBusy(true);
    setFlash(null);
    try {
      await api('/auth/2fa/disable', {
        token,
        method: 'POST',
        body: JSON.stringify({ password: disablePwd, totp: disableCode }),
      });
      setDisablePwd('');
      setDisableCode('');
      setFlash({ kind: 'ok', msg: t('twoFactor.disabledFlash') });
      load();
    } catch (err: any) {
      setFlash({ kind: 'err', msg: err?.message || t('twoFactor.disableFailed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('twoFactor.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('twoFactor.desc')}
      </p>

      {flash && (
        <div
          className={
            flash.kind === 'ok'
              ? 'mb-3 rounded-lg bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-sm px-3 py-2'
              : 'mb-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-sm px-3 py-2'
          }
        >
          {flash.msg}
        </div>
      )}

      {status?.enabled ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">{t('twoFactor.enabled')}</span>
          </div>
          <details className="mt-3">
            <summary className="text-sm text-red-600 hover:text-red-800 cursor-pointer">
              {t('twoFactor.disableSection')}
            </summary>
            <div className="mt-3 space-y-2">
              <input
                type="password"
                value={disablePwd}
                onChange={(e) => setDisablePwd(e.target.value)}
                placeholder={t('twoFactor.currentPassword')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
              />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('twoFactor.sixDigitCode')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm font-mono text-center tracking-widest"
              />
              <button
                onClick={disable2fa}
                disabled={busy || !disablePwd || disableCode.length !== 6}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t('pushNotifications.disable')}
              </button>
            </div>
          </details>
        </div>
      ) : setup ? (
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            {t('twoFactor.step1')}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qrDataUrl}
            alt={t('twoFactor.scanAlt')}
            className="rounded-lg bg-white p-2 border border-gray-200 dark:border-gray-700"
            style={{ width: 192, height: 192 }}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {t('twoFactor.manualEntry')}{' '}
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              {setup.secret}
            </code>
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-4 mb-2">
            {t('twoFactor.step2')}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('twoFactor.codePlaceholder')}
              className="w-40 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-base font-mono text-center tracking-widest"
            />
            <button
              onClick={confirmEnable}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {t('pushNotifications.enable')}
            </button>
            <button
              onClick={() => { setSetup(null); setCode(''); }}
              disabled={busy}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2 w-2 rounded-full bg-gray-400" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{t('twoFactor.notEnabled')}</span>
          <button
            onClick={startSetup}
            disabled={busy}
            className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('twoFactor.setUp')}
          </button>
        </div>
      )}
    </section>
  );
}
