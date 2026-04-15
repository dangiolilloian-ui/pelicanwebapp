'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { api } from '@/lib/api';
import clsx from 'clsx';

interface KioskLocation {
  id: string;
  name: string;
  organizationId: string;
  hasGeofence: boolean;
  radiusMeters: number;
  latitude: number | null;
  longitude: number | null;
}

interface VerifyResp {
  firstName: string;
  lastName: string;
  clockedIn: boolean;
  activeEntry: { clockIn: string } | null;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'verified'; user: VerifyResp }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function KioskPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = use(params);
  const [loc, setLoc] = useState<KioskLocation | null>(null);
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [clockTick, setClockTick] = useState(Date.now());
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoError, setGeoError] = useState('');

  // Load location info
  useEffect(() => {
    (async () => {
      try {
        const data = await api<KioskLocation>(`/kiosk/locations/${locationId}`, {});
        setLoc(data);
      } catch {
        setStatus({ kind: 'error', message: 'Location not found' });
      }
    })();
  }, [locationId]);

  // Wall clock
  useEffect(() => {
    const id = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Geolocation watcher — refresh every minute so fichajes siempre tengan coords frescas
  useEffect(() => {
    if (!loc?.hasGeofence || !navigator.geolocation) return;
    let cancelled = false;
    const request = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setGeoError('');
        },
        (err) => {
          if (cancelled) return;
          setGeoError(err.message || 'Location permission required');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    };
    request();
    const id = setInterval(request, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [loc?.hasGeofence]);

  const flash = useCallback((kind: 'success' | 'error', message: string) => {
    setStatus({ kind, message });
    setTimeout(() => {
      setStatus({ kind: 'idle' });
      setPin('');
    }, 3500);
  }, []);

  const onDigit = (d: string) => {
    if (status.kind !== 'idle' && status.kind !== 'verified') return;
    if (pin.length >= 6) return;
    setPin(pin + d);
  };

  const onBackspace = () => setPin((p) => p.slice(0, -1));
  const onClear = () => { setPin(''); setStatus({ kind: 'idle' }); };

  const verifyPin = async () => {
    if (pin.length < 4) return;
    setStatus({ kind: 'verifying' });
    try {
      const resp = await api<VerifyResp>(`/kiosk/locations/${locationId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      setStatus({ kind: 'verified', user: resp });
    } catch (err: any) {
      flash('error', err.message || 'PIN not recognized');
    }
  };

  const doClock = async (action: 'clock-in' | 'clock-out') => {
    try {
      const body: any = { pin };
      if (coords) {
        body.latitude = coords.latitude;
        body.longitude = coords.longitude;
      }
      const resp = await api<{ firstName: string }>(`/kiosk/locations/${locationId}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      flash('success', action === 'clock-in' ? `Welcome, ${resp.firstName}! Clocked in.` : `Goodbye, ${resp.firstName}! Clocked out.`);
    } catch (err: any) {
      flash('error', err.message || 'Failed');
    }
  };

  if (!loc && status.kind !== 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </div>
    );
  }

  if (!loc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white p-6">
        <p className="text-xl">Location not found.</p>
      </div>
    );
  }

  const now = new Date(clockTick);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-gray-950 to-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between border-b border-white/10">
        <div>
          <p className="text-xs uppercase tracking-wider text-indigo-300">Pelican Kiosk</p>
          <h1 className="text-2xl font-bold">{loc.name}</h1>
        </div>
        <div className="text-right">
          <p className="text-4xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-xs text-indigo-300">
            {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </header>

      {/* Geofence warning */}
      {loc.hasGeofence && geoError && (
        <div className="bg-amber-600/30 border-b border-amber-500/50 px-6 py-2 text-sm text-amber-100">
          ⚠ Location access is required at this store. {geoError}
        </div>
      )}
      {loc.hasGeofence && !geoError && !coords && (
        <div className="bg-indigo-900/40 px-6 py-2 text-sm text-indigo-200">
          Waiting for location permission…
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* PIN display */}
          <div className="text-center mb-6">
            {status.kind === 'verified' ? (
              <div className="mb-4">
                <p className="text-indigo-300 text-sm uppercase tracking-wider">Hello</p>
                <p className="text-4xl font-bold mt-1">
                  {status.user.firstName} {status.user.lastName}
                </p>
                <p className="text-sm text-indigo-300 mt-2">
                  {status.user.clockedIn
                    ? `On the clock since ${new Date(status.user.activeEntry!.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Not currently clocked in'}
                </p>
              </div>
            ) : (
              <p className="text-indigo-300 text-sm uppercase tracking-wider mb-3">Enter your PIN</p>
            )}

            {status.kind !== 'verified' && (
              <div className="flex justify-center gap-3 mb-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={clsx(
                      'h-5 w-5 rounded-full border-2 transition',
                      i < pin.length ? 'bg-indigo-400 border-indigo-400' : 'border-white/30'
                    )}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action buttons for verified */}
          {status.kind === 'verified' && (
            <div className="space-y-3 mb-6">
              {!status.user.clockedIn ? (
                <button
                  onClick={() => doClock('clock-in')}
                  className="w-full rounded-2xl bg-green-500 hover:bg-green-600 py-5 text-xl font-bold text-white transition active:scale-[0.98]"
                >
                  🟢 Clock In
                </button>
              ) : (
                <button
                  onClick={() => doClock('clock-out')}
                  className="w-full rounded-2xl bg-red-500 hover:bg-red-600 py-5 text-xl font-bold text-white transition active:scale-[0.98]"
                >
                  🔴 Clock Out
                </button>
              )}
              <button
                onClick={onClear}
                className="w-full rounded-xl border border-white/20 py-3 text-sm text-white/80 hover:bg-white/10 transition"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Number pad */}
          {status.kind !== 'verified' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    onClick={() => onDigit(d)}
                    className="h-16 rounded-xl bg-white/10 hover:bg-white/20 text-2xl font-semibold transition active:scale-95"
                  >
                    {d}
                  </button>
                ))}
                <button
                  onClick={onClear}
                  className="h-16 rounded-xl bg-white/5 hover:bg-white/10 text-sm transition active:scale-95"
                >
                  Clear
                </button>
                <button
                  onClick={() => onDigit('0')}
                  className="h-16 rounded-xl bg-white/10 hover:bg-white/20 text-2xl font-semibold transition active:scale-95"
                >
                  0
                </button>
                <button
                  onClick={onBackspace}
                  className="h-16 rounded-xl bg-white/5 hover:bg-white/10 text-xl transition active:scale-95"
                >
                  ⌫
                </button>
              </div>

              <button
                onClick={verifyPin}
                disabled={pin.length < 4 || status.kind === 'verifying'}
                className="mt-4 w-full rounded-xl bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 py-4 font-semibold transition active:scale-[0.98]"
              >
                {status.kind === 'verifying' ? 'Checking…' : 'Continue'}
              </button>
            </>
          )}

          {/* Flash messages */}
          {(status.kind === 'success' || status.kind === 'error') && (
            <div
              className={clsx(
                'mt-6 rounded-xl p-4 text-center font-semibold',
                status.kind === 'success' ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'
              )}
            >
              {status.message}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
