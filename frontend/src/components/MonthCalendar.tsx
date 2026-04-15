'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { Shift, User, Position, Location } from '@/types';
import { getMonthGrid, getMonthStart, isSameDay, formatMonth, formatTime } from '@/lib/dates';
import { ShiftModal } from './ShiftModal';
import clsx from 'clsx';

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
}: MonthCalendarProps) {
  const t = useT();
  const WEEKDAY_LABELS = [t('monthCal.mon'), t('monthCal.tue'), t('monthCal.wed'), t('monthCal.thu'), t('monthCal.fri'), t('monthCal.sat'), t('monthCal.sun')];
  const monthStart = getMonthStart(anchor);
  const days = getMonthGrid(anchor);
  const [modal, setModal] = useState<{ shift?: Shift; date?: Date } | null>(null);

  const goPrev = () => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1));
  const goNext = () => onMonthChange(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1));
  const goToday = () => onMonthChange(new Date());

  const shiftsForDay = (day: Date) =>
    shifts.filter((s) => isSameDay(new Date(s.startTime), day));

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
            const visible = dayShifts.slice(0, 3);
            const extra = dayShifts.length - visible.length;
            return (
              <div
                key={day.toISOString()}
                onClick={() => setModal({ date: day })}
                className={clsx(
                  'border-r border-b border-gray-100 dark:border-gray-800 last-of-type:border-r-0 p-1.5 cursor-pointer transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 overflow-hidden',
                  !inMonth && 'bg-gray-50/60 dark:bg-gray-950/40'
                )}
              >
                <div
                  className={clsx(
                    'text-xs font-medium mb-1 inline-flex items-center justify-center rounded-full h-5 min-w-[20px] px-1',
                    today && 'bg-indigo-600 text-white',
                    !today && inMonth && 'text-gray-700 dark:text-gray-300',
                    !today && !inMonth && 'text-gray-400 dark:text-gray-600'
                  )}
                >
                  {day.getDate()}
                </div>
                <div className="space-y-0.5">
                  {visible.map((s) => (
                    <div
                      key={s.id}
                      onClick={(e) => { e.stopPropagation(); setModal({ shift: s }); }}
                      className={clsx(
                        'rounded px-1 py-0.5 text-[10px] truncate border',
                        s.status === 'DRAFT'
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
