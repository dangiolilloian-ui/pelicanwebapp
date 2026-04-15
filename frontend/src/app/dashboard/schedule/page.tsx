'use client';

import { useState, useMemo } from 'react';
import { WeekCalendar } from '@/components/WeekCalendar';
import { MonthCalendar } from '@/components/MonthCalendar';
import { CoverageGapsPanel } from '@/components/CoverageGapsPanel';
import { useShifts } from '@/hooks/useShifts';
import { useTeam } from '@/hooks/useTeam';
import { usePositions } from '@/hooks/usePositions';
import { useLocations } from '@/hooks/useLocations';
import { useAvailability } from '@/hooks/useAvailability';
import { useTemplates } from '@/hooks/useTemplates';
import { getWeekStart, addDays, getMonthGrid } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

type ViewMode = 'week' | 'month';

export default function SchedulePage() {
  const t = useT();
  const [view, setView] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => new Date());

  // Compute the active range based on view
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === 'week') {
      return { rangeStart: weekStart, rangeEnd: addDays(weekStart, 7) };
    }
    const grid = getMonthGrid(monthAnchor);
    return { rangeStart: grid[0], rangeEnd: addDays(grid[41], 1) };
  }, [view, weekStart, monthAnchor]);

  const { shifts, loading, createShift, updateShift, deleteShift, publishWeek, copyWeekToNext, materializeRecurring, bulkDelete, bulkAssign, bulkPublish } =
    useShifts(rangeStart, rangeEnd);
  const { members } = useTeam();
  const { positions } = usePositions();
  const { locations } = useLocations();
  const { availabilities, timeOff } = useAvailability();
  const { templates } = useTemplates();

  return (
    <div className="p-6">
      {/* View toggle */}
      <div className="mb-4 inline-flex rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        {(['week', 'month'] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium capitalize transition',
              view === v
                ? 'bg-indigo-600 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            )}
          >
            {v === 'week' ? t('schedule.week') : t('schedule.month')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : view === 'week' ? (
        <>
          <CoverageGapsPanel
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            refreshKey={shifts.length}
          />
          <WeekCalendar
          weekStart={weekStart}
          shifts={shifts}
          members={members}
          positions={positions}
          locations={locations}
          onCreateShift={createShift}
          onUpdateShift={updateShift}
          onDeleteShift={deleteShift}
          onPublish={publishWeek}
          onCopyWeek={copyWeekToNext}
          onMaterializeRecurring={async () => {
            const r = await materializeRecurring();
            return r ?? { created: 0, skipped: 0 };
          }}
          onWeekChange={setWeekStart}
          onBulkDelete={bulkDelete}
          onBulkAssign={bulkAssign}
          onBulkPublish={bulkPublish}
          availabilities={availabilities}
          timeOff={timeOff}
          templates={templates}
        />
        </>
      ) : (
        <MonthCalendar
          anchor={monthAnchor}
          shifts={shifts}
          members={members}
          positions={positions}
          locations={locations}
          onCreateShift={createShift}
          onUpdateShift={updateShift}
          onDeleteShift={deleteShift}
          onMonthChange={setMonthAnchor}
        />
      )}
    </div>
  );
}
