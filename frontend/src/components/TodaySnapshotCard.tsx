'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Snapshot {
  date: string;
  shiftsScheduled: number;
  plannedHours: number;
  plannedLaborCost: number;
  clockedInNow: number;
  onBreakNow: number;
  salesToday: number;
  salesEntered: boolean;
}

// One-glance "how's today" card for managers. Polls at the same cadence as
// the live roster so they stay visually in sync.
export function TodaySnapshotCard() {
  const t = useT();
  const { token } = useAuth();
  const [data, setData] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => {
      api<Snapshot>('/dashboard/today', { token })
        .then((d) => { if (alive) setData(d); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  if (!data) return null;

  const money = (v: number) =>
    v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  const laborPct =
    data.salesEntered && data.salesToday > 0
      ? (data.plannedLaborCost / data.salesToday) * 100
      : null;

  return (
    <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-100">{t('todaySnapshot.title')}</h3>
        <span className="text-[11px] text-indigo-200">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={t('todaySnapshot.shifts')} value={String(data.shiftsScheduled)} sub={t('todaySnapshot.planned', { n: data.plannedHours })} />
        <Stat label={t('todaySnapshot.onNow')} value={String(data.clockedInNow)} sub={data.onBreakNow > 0 ? t('todaySnapshot.onBreak', { n: data.onBreakNow }) : t('todaySnapshot.inService')} />
        <Stat label={t('todaySnapshot.laborCost')} value={money(data.plannedLaborCost)} sub={t('todaySnapshot.plannedCost')} />
        <Stat
          label={t('todaySnapshot.laborPct')}
          value={laborPct != null ? `${laborPct.toFixed(0)}%` : '—'}
          sub={data.salesEntered ? t('todaySnapshot.vsSales', { money: money(data.salesToday) }) : t('todaySnapshot.noSales')}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-indigo-200 tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-0.5">{value}</div>
      <div className="text-[11px] text-indigo-200 mt-0.5">{sub}</div>
    </div>
  );
}
