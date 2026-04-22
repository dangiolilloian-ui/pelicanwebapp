'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CertificationsSection } from '@/components/CertificationsSection';
import { ChecklistsSection } from '@/components/ChecklistsSection';
import { AttendanceConfigSection } from '@/components/AttendanceConfigSection';
import { PtoConfigSection } from '@/components/PtoConfigSection';
import { CoverageRequirementsSection } from '@/components/CoverageRequirementsSection';
import { HolidaysSection } from '@/components/HolidaysSection';
import { OnboardingSection } from '@/components/OnboardingSection';
import { DeptManagersSection } from '@/components/DeptManagersSection';
import type { Position, Location } from '@/types';

export default function AdminPage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const [positions, setPositions] = useState<Position[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [newPos, setNewPos] = useState({ name: '', color: '#6366f1', hourlyRate: 16 });
  const [newLoc, setNewLoc] = useState({ name: '', address: '' });

  const fetchAll = useCallback(async () => {
    if (!token) return;
    const [p, l] = await Promise.all([
      api<Position[]>('/positions', { token }),
      api<Location[]>('/locations', { token }),
    ]);
    setPositions(p);
    setLocations(l);
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newPos.name) return;
    await api('/positions', { token, method: 'POST', body: JSON.stringify(newPos) });
    setNewPos({ name: '', color: '#6366f1', hourlyRate: 16 });
    fetchAll();
  };

  const updatePositionRate = async (id: string, hourlyRate: number) => {
    if (!token) return;
    await api(`/positions/${id}`, { token, method: 'PUT', body: JSON.stringify({ hourlyRate }) });
    fetchAll();
  };

  const deletePosition = async (id: string) => {
    if (!token) return;
    await api(`/positions/${id}`, { token, method: 'DELETE' });
    fetchAll();
  };

  const addLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newLoc.name) return;
    await api('/locations', { token, method: 'POST', body: JSON.stringify(newLoc) });
    setNewLoc({ name: '', address: '' });
    fetchAll();
  };

  const deleteLocation = async (id: string) => {
    if (!token) return;
    await api(`/locations/${id}`, { token, method: 'DELETE' });
    fetchAll();
  };

  const updateLocation = async (id: string, data: Partial<Location>) => {
    if (!token) return;
    await api(`/locations/${id}`, { token, method: 'PUT', body: JSON.stringify(data) });
    fetchAll();
  };

  if (!isManager) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">{t('settings.managerOnly')}</div>;
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('admin.title')}</h1>

      {/* Positions */}
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3">{t('settings.positions')}</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {positions.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{p.name}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                $
                <input
                  type="number"
                  min="16"
                  step="0.5"
                  defaultValue={(p as any).hourlyRate ?? 16}
                  onBlur={(e) => {
                    const v = Math.max(parseFloat(e.target.value) || 16, 16);
                    e.target.value = String(v);
                    if (v !== ((p as any).hourlyRate ?? 16)) updatePositionRate(p.id, v);
                  }}
                  className="w-16 rounded border border-gray-300 dark:border-gray-700 px-1.5 py-0.5 text-xs text-right tabular-nums"
                />
                {t('settings.perHour')}
              </div>
              <button onClick={() => deletePosition(p.id)} className="text-xs text-red-500 hover:text-red-700">{t('common.remove')}</button>
            </div>
          ))}
          <form onSubmit={addPosition} className="flex items-center gap-2 px-4 py-3">
            <input type="color" value={newPos.color} onChange={(e) => setNewPos({ ...newPos, color: e.target.value })}
              className="h-8 w-8 rounded border border-gray-300 dark:border-gray-700 cursor-pointer" />
            <input type="text" required value={newPos.name} onChange={(e) => setNewPos({ ...newPos, name: e.target.value })}
              placeholder={t('settings.newPositionName')} className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="number" min="16" step="0.5" value={newPos.hourlyRate}
              onChange={(e) => setNewPos({ ...newPos, hourlyRate: Math.max(parseFloat(e.target.value) || 16, 16) })}
              placeholder={t('settings.dollarPerHour')} className="w-20 rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition">{t('common.add')}</button>
          </form>
        </div>
      </section>

      {/* Locations */}
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">{t('settings.locations')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('settings.locationsDesc')}
        </p>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {locations.map((l) => (
            <LocationRow key={l.id} location={l} onUpdate={updateLocation} onDelete={deleteLocation} />
          ))}
          <form onSubmit={addLocation} className="flex items-center gap-2 px-4 py-3">
            <input type="text" required value={newLoc.name} onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })}
              placeholder={t('settings.locationName')} className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <input type="text" value={newLoc.address} onChange={(e) => setNewLoc({ ...newLoc, address: e.target.value })}
              placeholder={t('settings.addressOptional')} className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition">{t('common.add')}</button>
          </form>
        </div>
      </section>

      <DeptManagersSection />
      <ChecklistsSection />
      <CertificationsSection />
      <AttendanceConfigSection />
      <PtoConfigSection />
      <CoverageRequirementsSection />
      <HolidaysSection />
      <OnboardingSection />
    </div>
  );
}

function LocationRow({
  location,
  onUpdate,
  onDelete,
}: {
  location: Location;
  onUpdate: (id: string, data: Partial<Location>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState(location.latitude != null ? String(location.latitude) : '');
  const [lng, setLng] = useState(location.longitude != null ? String(location.longitude) : '');
  const [radius, setRadius] = useState(String(location.radiusMeters ?? 150));
  const [budget, setBudget] = useState(location.weeklyBudget != null ? String(location.weeklyBudget) : '');
  const [msg, setMsg] = useState('');

  const hasGeofence = location.latitude != null && location.longitude != null;
  const hasBudget = location.weeklyBudget != null && location.weeklyBudget > 0;

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setMsg(t('settings.geolocationUnavailable'));
      return;
    }
    setMsg(t('settings.gettingLocation'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setMsg(t('settings.captured', { n: Math.round(pos.coords.accuracy) }));
      },
      (err) => setMsg(t('settings.geolocationDenied', { msg: err.message })),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const save = async () => {
    await onUpdate(location.id, {
      latitude: lat === '' ? null : Number(lat),
      longitude: lng === '' ? null : Number(lng),
      radiusMeters: Number(radius) || 150,
      weeklyBudget: budget === '' ? null : Number(budget),
    });
    setMsg(t('common.saved'));
    setTimeout(() => setMsg(''), 2000);
  };

  const clearGeofence = async () => {
    setLat('');
    setLng('');
    await onUpdate(location.id, { latitude: null, longitude: null });
  };

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-900 dark:text-gray-100">{location.name}</span>
            {hasGeofence ? (
              <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded px-1.5 py-0.5">
                {t('settings.geofenced')}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400">{t('settings.noGeofence')}</span>
            )}
            {hasBudget && (
              <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 rounded px-1.5 py-0.5">
                ${Math.round(location.weeklyBudget!).toLocaleString()}/wk
              </span>
            )}
          </div>
          {location.address && <p className="text-xs text-gray-400">{location.address}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={`/kiosk/${location.id}`} target="_blank" rel="noopener"
            className="text-xs text-indigo-600 hover:underline"
          >
            {t('settings.openKiosk')}
          </a>
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600">
            {open ? t('common.close') : t('common.edit')}
          </button>
          <button onClick={() => onDelete(location.id)} className="text-xs text-red-500 hover:text-red-700">{t('common.remove')}</button>
        </div>
      </div>

      {open && (
        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-14">{t('settings.budget')}</label>
            <span className="text-xs text-gray-500 dark:text-gray-400">$</span>
            <input
              type="number" min="0" step="50"
              value={budget} onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 4000"
              className="w-32 rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs bg-white dark:bg-gray-900"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.perWeek')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-14">{t('settings.lat')}</label>
            <input
              type="text" value={lat} onChange={(e) => setLat(e.target.value)}
              placeholder="40.6378"
              className="flex-1 min-w-[120px] rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs font-mono bg-white dark:bg-gray-900"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-14">{t('settings.lng')}</label>
            <input
              type="text" value={lng} onChange={(e) => setLng(e.target.value)}
              placeholder="-74.7713"
              className="flex-1 min-w-[120px] rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs font-mono bg-white dark:bg-gray-900"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-14">{t('settings.radius')}</label>
            <input
              type="number" min="10" max="2000" step="10"
              value={radius} onChange={(e) => setRadius(e.target.value)}
              className="w-24 rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs bg-white dark:bg-gray-900"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t('settings.meters')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button" onClick={useMyLocation}
              className="text-xs rounded border border-gray-300 dark:border-gray-700 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('settings.useMyLocation')}
            </button>
            <button
              type="button" onClick={save}
              className="text-xs rounded bg-indigo-600 text-white px-2 py-1 hover:bg-indigo-700"
            >
              {t('common.save')}
            </button>
            {hasGeofence && (
              <button
                type="button" onClick={clearGeofence}
                className="text-xs text-red-500 hover:text-red-700"
              >
                {t('settings.clearGeofence')}
              </button>
            )}
            {msg && <span className="text-xs text-gray-500 dark:text-gray-400">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
