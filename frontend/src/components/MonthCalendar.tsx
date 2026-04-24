'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { Shift, User, Position, Location } from '@/types';
import { getMonthGrid, getMonthStart, isSameDay, formatMonth, formatTime } from '@/lib/dates';
import { ShiftModal } from './ShiftModal';
import clsx from 'clsx';
import { SearchableSelect } from './SearchableSelect';

interface MonthCalendarProps {
  anchor: Date;
  shifts: Shift[];
  members: User[];
  positions: Position[];
  locations: Location[];
  onCreateShift: (data: any) => Promise<any>;
  onUpdateShift: (id: string, data: any) => Promise<any>;
  onDeleteShift: (id: string) => Promise<void>;
  onMonthChange: (date: Date) => void;
  holidays?: Map<string, string>;
}

export function MonthCalendar({
  anchor,
  shifts,
  members,
  positions,
  locations,
  onCreateShift,
  onUpdateShift,
  onDeleteShift,
  onMonthChange,
  holidays = new Map(),
}: MonthCalendarProps) {
  const t = useT();

  const isHoliday = (day: Date): string | undefined => {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return holidays.get(key);
  };
  const WEEKDAY_LABELS = [t('monthCal.sun'), t('monthCal.mon'), t('monthCal.tue'), t('monthCal.wed'), t('monthCal.thu'), t('monthCal.fri'), t('monthCal.sat')];
  const monthStart = getMonthStart(anchor);
  const days = getMonthGrid(anchor);
  const [modal, setModal] = useState<{ shift?: Shift; date?: Date } | null>(null);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [filterLocation, setFilterLocation] = useState('');

  const filteredShifts = shifts.filter((s) => {
    if (filterUser && s.user?.id !== filterUser) return false;
    if (filterPosition && s.position?.id !== filterPosition) return false;
    if (filterLocation && s.location?.id !== filterLocation) return false;
    return true;
  });

  const goPrev = () => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1));
  const goNext = () => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1));
  const goToday = () => onMonthChange(new Date());

  const shiftsForDay = (day: Date) =>
    filteredShifts.filter((s) => isSameDay(new Date(s.startTime), day));

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={goPrev}
            className="rounded-lg border border-gray-300 dark:border-gray-700 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={goNext}
            className="rounded-lg border border-gray-300 dark:border-gray-700 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{formatMonth(monthStart)}</h2>
          <button
            onClick={goToday}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {t('common.today')}
          </button>
        </div>
        <button
          onClick={() => setModal({})}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
        >
          {t('schedule.newShift')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('schedule.filters')}</span>
        <SearchableSelect
          options={members.map((m) => ({ value: m.id, label: `${m.firstName} ${m.lastName}` }))}
          value={filterUser}
          onChange={setFilterUser}
          placeholder={t('schedule.allMembers')}
        />
        {positions.length > 0 && (
          <select
            value={filterPosition}
            onChange={(e) => setFilterPosition(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('schedule.allPositions')}</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        {locations.length > 0 && (
          <select
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('schedule.allLocations')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        {(filterUser || filterPosition || filterLocation) && (
          <button
            onClick={() => { setFilterUser(''); setFilterPosition(''); setFilterLocation(''); }}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {t('schedule.clear')}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
        <div className="grid grid-cols-7 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="px-2 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-center">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 grid-rows-6 min-h-[600px]">
          {days.map((day) => {
            const dayShifts = shiftsForDay(day);
            const inMonth = day.getMonth() === monthStart.getMonth();
            const today = isSameDay(day, new Date());
            const hName = isHoliday(day);
            const visible = dayShifts.slice(0, 3);
            const extra = dayShifts.length - visible.length;
            return (
              <div
                key={day.toISOString()}
                onClick={() => !hName && setModal({ date: day })}
                title={hName ? `${hName} — scheduling blocked` : undefined}
                className={clsx(
                  'border-r border-b border-gray-100 dark:border-gray-800 last-of-type:border-r-0 p-1.5 transition overflow-hidden',
                  hName
                    ? 'bg-red-50/80 dark:bg-red-900/20 cursor-not-allowed'
                    : 'cursor-pointer hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30',
                  !inMonth && !hName && 'bg-gray-50/60 dark:bg-gray-950/40'
                )}
              >
                <div className="flex items-center gap-1">
                  <div
                    className={clsx(
                      'text-xs font-medium mb-1 inline-flex items-center justify-center rounded-full h-5 min-w-[20px] px-1',
                      hName && 'bg-red-600 text-white',
                      !hName && today && 'bg-indigo-600 text-white',
                      !hName && !today && inMonth && 'text-gray-700 dark:text-gray-300',
                      !hName && !today && !inMonth && 'text-gray-400 dark:text-gray-600'
                    )}
                  >
                    {day.getDate()}
                  </div>
                  {hName && (
                    <span className="text-[9px] font-semibold text-red-600 dark:text-red-400 truncate mb-1">{hName}</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {visible.map((s) => (
                    <div
                      key={s.id}
                      onClick={(e) => { e.stopPropagation(); setModal({ shift: s }); }}
                      title={!s.position ? t('schedule.noPositionAssigned') : undefined}
                      className={clsx(
                        'rounded px-1 py-0.5 text-[10px] truncate border',
                        !s.position
                          ? 'bg-orange-50 dark:bg-orange-950/40 border-orange-300 dark:border-orange-800 text-orange-800 dark:text-orange-300'
                          : s.status === 'DRAFT'
                          ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                          : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300'
                      )}
                    >
                      <span className="font-medium">{formatTime(s.startTime)}</span>{' '}
                      {s.user ? `${s.user.firstName} ${s.user.lastName[0]}.` : t('common.unassigned')}
                    </div>
                  ))}
                  {extra > 0 && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 px-1">{t('monthCal.moreShifts', { n: extra })}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {modal && (
        <ShiftModal
          shift={modal.shift}
          defaultDate={modal.date}
          members={members}
          positions={positions}
          locations={locations}
          onSave={async (data) => {
            if (modal.shift) await onUpdateShift(modal.shift.id, data);
            else await onCreateShift(data);
          }}
          onDelete={modal.shift ? () => onDeleteShift(modal.shift!.id) : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
