'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import type { Shift, User, Position, Location } from '@/types';
import type { ShiftTemplate } from '@/hooks/useTemplates';
import { getWeekDays, formatDate, formatTime, isSameDay, addDays, getWeekStart, to12h } from '@/lib/dates';
import { ShiftModal } from './ShiftModal';
import { detectConflicts, type ShiftConflict } from '@/lib/conflicts';
import { getCellStatus, type CellStatus } from '@/lib/availability';
import type { AvailabilityEntry, TimeOffEntry } from '@/hooks/useAvailability';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import clsx from 'clsx';
import { SearchableSelect } from './SearchableSelect';
import { exportSchedule } from '@/lib/exportXlsx';

interface WeekCalendarProps {
  weekStart: Date;
  shifts: Shift[];
  members: User[];
  positions: Position[];
  locations: Location[];
  onCreateShift: (data: any) => Promise<any>;
  onUpdateShift: (id: string, data: any) => Promise<any>;
  onDeleteShift: (id: string) => Promise<void>;
  onPublish: () => Promise<void | { count: number; coverageGaps: Array<{ date: string; startTime: string; endTime: string; shortfall: number }> } | undefined>;
  onCopyWeek: () => Promise<void>;
  onMaterializeRecurring?: () => Promise<{ created: number; skipped: number }>;
  onWeekChange: (date: Date) => void;
  onBulkDelete?: (ids: string[]) => Promise<void>;
  onBulkAssign?: (ids: string[], userId: string | null) => Promise<void>;
  onBulkPublish?: (ids: string[]) => Promise<void>;
  availabilities?: AvailabilityEntry[];
  timeOff?: TimeOffEntry[];
  templates?: ShiftTemplate[];
  holidays?: Map<string, string>;
}

interface DragData {
  shiftId: string;
  sourceUserId: string | null;
  sourceDate: string;
  isCopy: boolean;
}

export function WeekCalendar({
  weekStart,
  shifts,
  members,
  positions,
  locations,
  onCreateShift,
  onUpdateShift,
  onDeleteShift,
  onPublish,
  onCopyWeek,
  onMaterializeRecurring,
  onWeekChange,
  onBulkDelete,
  onBulkAssign,
  onBulkPublish,
  availabilities = [],
  timeOff = [],
  templates = [],
  holidays = new Map(),
}: WeekCalendarProps) {
  const t = useT();
  const { token: authToken } = useAuth();
  const days = getWeekDays(weekStart);

  // Holiday lookup helper
  const isHoliday = (day: Date): string | undefined => {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    return holidays.get(key);
  };

  const [modal, setModal] = useState<{ shift?: Shift; date?: Date; userId?: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dragDataRef = useRef<DragData | null>(null);
  const [isDraggingCopy, setIsDraggingCopy] = useState(false);
  // Track Ctrl/Cmd key globally — drag events don't always expose modifier keys
  const ctrlHeldRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeldRef.current = true; setIsDraggingCopy(true); } };
    const up = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { ctrlHeldRef.current = false; setIsDraggingCopy(false); } };
    const blur = () => { ctrlHeldRef.current = false; setIsDraggingCopy(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  // Empty-cell quick-add popover. Managers with templates defined can drop a
  // shift in one click instead of tabbing through the full modal.
  const [quickAdd, setQuickAdd] = useState<{ cellKey: string; date: Date; userId?: string } | null>(null);

  useEffect(() => {
    if (!quickAdd) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuickAdd(null); };
    const onDocClick = () => setQuickAdd(null);
    window.addEventListener('keydown', onKey);
    // Fire on next tick so the click that opened the popover isn't the one
    // that closes it.
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [quickAdd]);

  const applyTemplate = async (tpl: ShiftTemplate, date: Date, userId?: string) => {
    const [sh, sm] = tpl.startTime.split(':').map(Number);
    const [eh, em] = tpl.endTime.split(':').map(Number);
    const start = new Date(date);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(date);
    end.setHours(eh, em, 0, 0);
    // Handles templates that cross midnight (e.g. 22:00–02:00 closer shift).
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
    setQuickAdd(null);

    // Auto-fill position/location from the employee if the template doesn't
    // specify one and the employee has exactly one assigned.
    let posId = tpl.position?.id ?? null;
    let locId = tpl.location?.id ?? null;
    if (userId) {
      const member = members.find((m) => m.id === userId);
      if (!posId && member?.positions?.length === 1) posId = member.positions[0].id;
      if (!locId && member?.locations?.length === 1) locId = member.locations[0].id;
    }

    await handleSave({
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      userId: userId ?? null,
      positionId: posId,
      locationId: locId,
      notes: tpl.notes ?? null,
      status: 'DRAFT',
    });
  };

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const onClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey); };
  }, [exportOpen]);

  const doExport = async (weeks: 1 | 2 | 3, format: 'excel' | 'pdf' | 'print') => {
    if (!authToken || exporting) return;
    setExporting(true);
    setExportOpen(false);
    try {
      await exportSchedule({
        weekStart,
        weeks,
        format,
        token: authToken,
        members,
        positions,
        locations,
        filterUser,
        filterPosition,
        filterLocation,
      });
    } catch (err) {
      console.error('Export failed', err);
      showToast('warn', ['Export failed — please try again.']);
    } finally {
      setExporting(false);
    }
  };

  // Toast / warnings
  const [toast, setToast] = useState<{ kind: 'warn' | 'info'; lines: string[] } | null>(null);
  const showToast = (kind: 'warn' | 'info', lines: string[]) => {
    setToast({ kind, lines });
    setTimeout(() => setToast(null), 6000);
  };

  const handleSave = async (data: any, shiftId?: string) => {
    const res = shiftId ? await onUpdateShift(shiftId, data) : await onCreateShift(data);
    if (res?._warnings?.length) {
      showToast('warn', res._warnings);
    }
  };

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [filterLocation, setFilterLocation] = useState('');

  const hasDrafts = shifts.some((s) => s.status === 'DRAFT');
  const conflicts = useMemo(() => detectConflicts(shifts), [shifts]);
  const conflictCount = conflicts.size;
  const [conflictsOpen, setConflictsOpen] = useState(false);

  // Auto-close the panel when all conflicts are resolved
  useEffect(() => {
    if (conflictCount === 0) setConflictsOpen(false);
  }, [conflictCount]);

  // Build rows: one per member + unassigned
  const unassignedRow = { id: '__unassigned__', firstName: 'Unassigned', lastName: '', email: '', role: 'EMPLOYEE' as const };
  const allRows = [...members, unassignedRow];

  // Filter shifts
  const filteredShifts = shifts.filter((s) => {
    if (filterUser && s.user?.id !== filterUser) return false;
    if (filterPosition && s.position?.id !== filterPosition) return false;
    if (filterLocation && s.location?.id !== filterLocation) return false;
    return true;
  });

  // Filter rows: narrow the roster down to employees whose own tags match
  // the selected position/location. The "unassigned" pseudo-row is always
  // kept so shifts without an assignee are still visible. When no
  // position/location filter is active, everyone shows.
  const visibleRows = useMemo(() => {
    return allRows.filter((r) => {
      if (r.id === '__unassigned__') return true;
      if (filterUser && r.id !== filterUser) return false;
      const member = r as User;
      if (filterPosition) {
        const has = (member.positions ?? []).some((p) => p.id === filterPosition);
        if (!has) return false;
      }
      if (filterLocation) {
        const has = (member.locations ?? []).some((l) => l.id === filterLocation);
        if (!has) return false;
      }
      return true;
    });
  }, [allRows, filterUser, filterPosition, filterLocation]);

  const getShiftsForCell = (userId: string, day: Date) =>
    filteredShifts.filter((s) => {
      const shiftUserId = s.user?.id || '__unassigned__';
      return shiftUserId === userId && isSameDay(new Date(s.startTime), day);
    });

  // Drag handlers
  
  const handleDragStart = (e: React.DragEvent, shift: Shift, day: Date) => {
    dragDataRef.current = {
      shiftId: shift.id,
      sourceUserId: shift.user?.id || null,
      sourceDate: day.toISOString(),
      isCopy: false, // will be determined on drop
    };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', shift.id);
  };

  const handleDragEnd = () => {
    setIsDraggingCopy(false);
  };

  const handleDragOver = (e: React.DragEvent, cellKey: string) => {
    e.preventDefault();
    // Detect Ctrl/Cmd — use drag event props OR global keyboard listener as fallback
    const isCopy = !!(e.ctrlKey || e.metaKey || ctrlHeldRef.current);
    e.dataTransfer.dropEffect = isCopy ? 'copy' : 'move';
    setIsDraggingCopy((prev) => (prev !== isCopy ? isCopy : prev));
    setDragOver((prev) => (prev !== cellKey ? cellKey : prev));
  };

  const handleDragLeave = () => setDragOver(null);

  const handleDrop = async (e: React.DragEvent, targetUserId: string, targetDay: Date) => {
    e.preventDefault();
    setDragOver(null);
    setIsDraggingCopy(false);
    const drag = dragDataRef.current;
    if (!drag) return;
    dragDataRef.current = null;

    // Check Ctrl/Cmd at the moment of drop — use event props OR global ref
    const isCopy = e.ctrlKey || e.metaKey || ctrlHeldRef.current;

    const shift = shifts.find((s) => s.id === drag.shiftId);
    if (!shift) return;

    const oldStart = new Date(shift.startTime);
    const oldEnd = new Date(shift.endTime);
    const duration = oldEnd.getTime() - oldStart.getTime();

    const newStart = new Date(targetDay);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    const newEnd = new Date(newStart.getTime() + duration);

    const newUserId = targetUserId === '__unassigned__' ? null : targetUserId;

    if (isCopy) {
      await onCreateShift({
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
        userId: newUserId,
        positionId: shift.position?.id ?? null,
        locationId: shift.location?.id ?? null,
        notes: shift.notes ?? null,
        status: 'DRAFT',
      });
    } else {
      await onUpdateShift(drag.shiftId, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
        userId: newUserId,
      });
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onWeekChange(addDays(weekStart, -7))}
            className="rounded-lg border border-gray-300 dark:border-gray-700 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <ChevronLeftIcon />
          </button>
          <button
            onClick={() => onWeekChange(addDays(weekStart, 7))}
            className="rounded-lg border border-gray-300 dark:border-gray-700 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            <ChevronRightIcon />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {formatDate(days[0])} — {formatDate(days[6])}
          </h2>
          <button
            onClick={() => onWeekChange(getWeekStart(new Date()))}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition"
          >
            {t('common.today')}
          </button>
          <button
            onClick={() => {
              if (authUser?.id) {
                setFilterUser((prev) => prev === authUser.id ? '' : authUser.id);
              }
            }}
            className={clsx(
              'rounded-lg border px-3 py-1.5 text-sm font-medium transition',
              filterUser === authUser?.id
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-600'
                : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            )}
          >
            My Schedule
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Export dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={exporting}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {exporting ? 'Exporting\u2026' : 'Export'}
              <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
                {([1, 2, 3] as const).map((w) => (
                  <div key={w}>
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800">
                      {w} Week{w > 1 ? 's' : ''}
                    </div>
                    <button
                      onClick={() => doExport(w, 'excel')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                    >
                      <span className="text-base leading-none">📊</span>
                      <span className="text-gray-800 dark:text-gray-200">Excel (.xlsx)</span>
                    </button>
                    <button
                      onClick={() => doExport(w, 'pdf')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                    >
                      <span className="text-base leading-none">📄</span>
                      <span className="text-gray-800 dark:text-gray-200">PDF (Save as PDF)</span>
                    </button>
                    <button
                      onClick={() => doExport(w, 'print')}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                    >
                      <span className="text-base leading-none">🖨️</span>
                      <span className="text-gray-800 dark:text-gray-200">Print</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onCopyWeek}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            title={t('schedule.copyTitle')}
          >
            {t('schedule.copyToNextWeek')}
          </button>
          {onMaterializeRecurring && (
            <button
              onClick={async () => {
                const res = await onMaterializeRecurring();
                showToast(
                  'info',
                  res.created > 0
                    ? [t('schedule.recurringAdded', { n: res.created }), ...(res.skipped ? [t('schedule.recurringSkipped', { n: res.skipped })] : [])]
                    : [t('schedule.recurringNone')]
                );
              }}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title={t('schedule.fromRecurringTitle')}
            >
              {t('schedule.fromRecurring')}
            </button>
          )}
          <button
            onClick={() => { setSelectMode((v) => !v); clearSelection(); }}
            className={clsx(
              'rounded-lg border px-3 py-2 text-sm font-medium transition',
              selectMode
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            )}
          >
            {selectMode ? t('schedule.exitSelect') : t('schedule.select')}
          </button>
          {hasDrafts && (
            <button
              onClick={async () => {
                const res = await onPublish();
                if (res && 'coverageGaps' in res && res.coverageGaps.length > 0) {
                  const top = res.coverageGaps
                    .slice(0, 5)
                    .map((g) => `• ${g.date} ${to12h(g.startTime)}–${to12h(g.endTime)} (short ${g.shortfall})`)
                    .join('\n');
                  const more = res.coverageGaps.length > 5 ? `\n…and ${res.coverageGaps.length - 5} more` : '';
                  alert(t('schedule.publishedWithGaps', { published: res.count, gaps: res.coverageGaps.length }) + ':\n\n' + top + more);
                }
              }}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition"
            >
              {t('schedule.publishWeek')}
            </button>
          )}
          <button
            onClick={() => setModal({})}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            {t('schedule.newShift')}
          </button>
        </div>
      </div>
      {isDraggingCopy && dragOver && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 animate-pulse">
          <span>📋</span>
          <span>Copy mode — drop on any cell to duplicate this shift there</span>
        </div>
      )}
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
            className="text-sm text-indigo-600 hover:underline"
          >
            {t('schedule.clear')}
          </button>
        )}
        {(availabilities.length > 0 || timeOff.length > 0) && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-green-200 border border-green-300" /> {t('schedule.available')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-red-200 border border-red-300" /> {t('schedule.unavailable')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-amber-200 border border-amber-300" /> {t('schedule.timeOff')}
            </span>
          </div>
        )}
      </div>
<div className="mb-3 text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
  <span>💡</span>
  <span>Hold <kbd className="rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 font-mono text-[10px]">Ctrl</kbd> (or <kbd className="rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-1 py-0.5 font-mono text-[10px]">⌘</kbd> on Mac) while dragging a shift to copy it to another day or employee.</span>
</div>
      {/* Sling-style Grid: employees as rows, days as columns */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto bg-white dark:bg-gray-900">
        <div className="min-w-[900px]">
        {/* Header row */}
        <div className="grid grid-cols-[140px_repeat(7,minmax(110px,1fr))] bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
          <div className="px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-800">
            {t('schedule.employee')}
          </div>
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            const hName = isHoliday(day);
            return (
              <div
                key={day.toISOString()}
                className={clsx(
                  'px-2 py-2 text-sm font-medium text-center border-r border-gray-200 dark:border-gray-800 last:border-r-0',
                  hName
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : isToday ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 dark:text-gray-400'
                )}
              >
                {formatDate(day)}
                {hName && (
                  <div className="text-[10px] font-semibold text-red-600 dark:text-red-400 truncate mt-0.5">
                    {hName}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Employee rows */}
        {visibleRows.map((member) => {
          const weekHours = filteredShifts
            .filter((s) => (s.user?.id || '__unassigned__') === member.id)
            .reduce((acc, s) => acc + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000, 0);

          return (
            <div
              key={member.id}
              className="grid grid-cols-[140px_repeat(7,minmax(110px,1fr))] border-b border-gray-100 dark:border-gray-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              {/* Employee name cell */}
              <div className="px-3 py-2 border-r border-gray-200 dark:border-gray-800 flex items-start gap-2">
                <div
                  className={clsx(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 mt-0.5',
                    member.id === '__unassigned__'
                      ? 'bg-gray-200 text-gray-500 dark:text-gray-400'
                      : 'bg-indigo-100 text-indigo-700'
                  )}
                >
                  {member.id === '__unassigned__' ? '?' : `${member.firstName[0]}${member.lastName[0]}`}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {member.id === '__unassigned__' ? t('common.unassigned') : `${member.firstName} ${member.lastName}`}
                  </p>
                  <p className="text-[11px] text-gray-400">{t('schedule.thisWeekHours', { n: weekHours.toFixed(1) })}</p>
                </div>
              </div>

              {/* Day cells */}
              {days.map((day) => {
                const cellShifts = getShiftsForCell(member.id, day);
                const cellKey = `${member.id}-${day.toISOString()}`;
                const isOver = dragOver === cellKey;
                const status: CellStatus = getCellStatus(member.id, day, availabilities, timeOff);
                // Drag preview: red tint if dropping here would conflict with
                // the employee's declared availability/time-off.
                const dropConflict = isOver && (status === 'unavailable' || status === 'time-off');

                const holidayName = isHoliday(day);

                return (
                  <div
                    key={day.toISOString()}
                    title={
                      holidayName
                        ? `🚫 ${holidayName} — scheduling blocked`
                        : status === 'time-off'
                        ? t('schedule.approvedTimeOff')
                        : status === 'unavailable'
                        ? t('schedule.markedUnavailable')
                        : status === 'available'
                        ? t('schedule.declaredAvailable')
                        : undefined
                    }
                    className={clsx(
                      'relative px-1 py-1 border-r border-gray-200 dark:border-gray-800 last:border-r-0 min-h-[60px] transition-colors',
                      // Holiday blocking — takes precedence
                      holidayName && 'bg-red-50/80 dark:bg-red-900/20 cursor-not-allowed',
                      // Base overlay tint by status (only if not a holiday)
                      !holidayName && status === 'time-off' && 'bg-amber-50/60 dark:bg-amber-900/10',
                      !holidayName && status === 'unavailable' && 'bg-red-50/60 dark:bg-red-900/10',
                      !holidayName && status === 'available' && 'bg-green-50/40 dark:bg-green-900/10',
                      // Drag-over feedback overrides base tint
                      !holidayName && isOver && !dropConflict && isDraggingCopy && 'bg-emerald-50 ring-2 ring-emerald-400 ring-inset',
                      !holidayName && isOver && !dropConflict && !isDraggingCopy && 'bg-indigo-50 ring-2 ring-indigo-300 ring-inset',
                      !holidayName && dropConflict && 'bg-red-100 ring-2 ring-red-400 ring-inset'
                    )}
                    onDragOver={(e) => !holidayName && handleDragOver(e, cellKey)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => !holidayName && handleDrop(e, member.id, day)}
                    onClick={() => {
                      if (holidayName) return; // Block scheduling on holidays
                      if (cellShifts.length === 0) {
                        const userId = member.id === '__unassigned__' ? undefined : member.id;
                        // With templates defined, show the quick-add popover
                        // first so one-click template apply is the default.
                        // Without templates, fall straight through to the
                        // full modal (no reason to show an empty menu).
                        if (templates.length > 0) {
                          setQuickAdd({ cellKey, date: day, userId });
                        } else {
                          setModal({ date: day, userId });
                        }
                      }
                    }}
                  >
                    {cellShifts.map((shift) => {
                      const shiftConflicts = conflicts.get(shift.id);
                      // Hard conflicts = overlap, short rest, or >50h week.
                      // Overtime (>40h) is a soft warning so it doesn't scream
                      // red at every retail manager who's normal 40+h weeks.
                      const hardConflict = shiftConflicts?.some(
                        (c) => c.type === 'OVERLAP' || c.type === 'OVER_HOURS' || c.type === 'SHORT_REST'
                      );
                      const softConflict =
                        shiftConflicts?.some((c) => c.type === 'OVERTIME' || c.type === 'BREAK_MISSING') &&
                        !hardConflict;
                      const isSelected = selected.has(shift.id);
                      return (
                      <div
                        key={shift.id}
                        draggable={!selectMode}
                        onDragStart={(e) => handleDragStart(e, shift, day)}
                        onDragEnd={handleDragEnd}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selectMode) toggleSelected(shift.id);
                          else setModal({ shift });
                        }}
                        title={shiftConflicts?.map((c) => c.message).join(' · ')}
                        className={clsx(
                          'group/shift relative rounded px-1.5 py-1 text-[11px] mb-0.5 transition',
                          selectMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-indigo-300',
                          isSelected && 'ring-2 ring-indigo-500',
                          hardConflict
                            ? 'bg-red-50 border border-red-300 text-red-800'
                            : softConflict
                            ? 'bg-amber-50 border border-amber-300 text-amber-800'
                            : shift.status === 'DRAFT'
                            ? 'bg-amber-50 border border-dashed border-amber-300 text-amber-800'
                            : 'bg-indigo-50 border border-indigo-200 text-indigo-800'
                        )}
                      >
                        {selectMode && (
                          <span className={clsx(
                            'absolute -top-1 -left-1 h-3.5 w-3.5 rounded-sm border flex items-center justify-center text-[9px] font-bold',
                            isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-400'
                          )}>
                            {isSelected ? '✓' : ''}
                          </span>
                        )}
                        {hardConflict && (
                          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold">!</span>
                        )}
                        {softConflict && (
                          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-500 text-white text-[8px] flex items-center justify-center font-bold" title="Overtime">⏱</span>
                        )}
                        {!selectMode && !hardConflict && !softConflict && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Delete this shift?')) onDeleteShift(shift.id);
                            }}
                            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] items-center justify-center font-bold opacity-0 group-hover/shift:opacity-100 transition-opacity hidden group-hover/shift:flex"
                            title="Delete shift"
                          >
                            ✕
                          </button>
                        )}
                        <div className="font-medium">
                          {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                        </div>
                        {shift.position && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: shift.position.color }} />
                            <span className="truncate">{shift.position.name}</span>
                          </div>
                        )}
                        {shift.notes && (
                          <div className="opacity-60 truncate mt-0.5">{shift.notes}</div>
                        )}
                      </div>
                      );
                    })}

                    {cellShifts.length === 0 && (
                      <div className="flex items-center justify-center h-full min-h-[44px] rounded border-2 border-dashed border-transparent hover:border-gray-200 dark:border-gray-800 text-gray-300 hover:text-gray-400 text-xs cursor-pointer transition">
                        +
                      </div>
                    )}

                    {quickAdd?.cellKey === cellKey && (
                      <div
                        className="absolute z-30 top-full left-0 mt-1 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">
                          {t('schedule.quickAdd')}
                        </div>
                        <ul className="max-h-56 overflow-y-auto py-1">
                          {templates.map((tpl) => (
                            <li key={tpl.id}>
                              <button
                                onClick={() => applyTemplate(tpl, day, member.id === '__unassigned__' ? undefined : member.id)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                              >
                                {tpl.position && (
                                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: tpl.position.color }} />
                                )}
                                <span className="flex-1 min-w-0">
                                  <span className="block text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{tpl.name}</span>
                                  <span className="block text-[10px] text-gray-500">
                                    {to12h(tpl.startTime)}–{to12h(tpl.endTime)}
                                    {tpl.location ? ` · ${tpl.location.name}` : ''}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="border-t border-gray-100 dark:border-gray-800">
                          <button
                            onClick={() => {
                              const userId = member.id === '__unassigned__' ? undefined : member.id;
                              setQuickAdd(null);
                              setModal({ date: day, userId });
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs text-indigo-600 dark:text-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                          >
                            {t('schedule.blankShift')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        </div>
      </div>

      {/* Stats bar */}
      {(() => {
        const totalHours = filteredShifts.reduce(
          (a, s) => a + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000,
          0
        );
        // Labor cost = Σ hours × position.hourlyRate. Shifts with no position
        // (or no rate) contribute 0 — we flag how many are missing so the
        // manager knows the number is an underestimate.
        let laborCost = 0;
        let unpricedShifts = 0;
        for (const s of filteredShifts) {
          const hours = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
          const rate = s.position?.hourlyRate;
          if (rate != null && rate > 0) laborCost += hours * rate;
          else unpricedShifts += 1;
        }
        const money = laborCost.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        });

        // Budget: only when a single location is selected OR when exactly one
        // location has a budget set (sum of budgets makes no sense if only some
        // stores have caps declared). The pill turns amber at >=90% and red at
        // >=100% so an owner sees overruns from across the room.
        const budgetLoc = filterLocation
          ? locations.find((l) => l.id === filterLocation)
          : null;
        const weeklyBudget = budgetLoc?.weeklyBudget ?? null;
        const pct = weeklyBudget && weeklyBudget > 0 ? laborCost / weeklyBudget : 0;
        const budgetColor =
          pct >= 1
            ? 'text-red-600 dark:text-red-400'
            : pct >= 0.9
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-gray-500 dark:text-gray-400';

        return (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
            <span>{t('schedule.statsShifts', { n: filteredShifts.length })}</span>
            <span>{t('schedule.statsTotalHours', { n: totalHours.toFixed(1) })}</span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400" title={unpricedShifts ? `${unpricedShifts} shifts without a rate not counted` : 'Σ hours × position rate'}>
              {t('schedule.statsLabor', { money })}{unpricedShifts > 0 ? ' *' : ''}
            </span>
            {weeklyBudget != null && weeklyBudget > 0 && (
              <span
                className={clsx('font-medium', budgetColor)}
                title={`${budgetLoc!.name} weekly budget: ${weeklyBudget.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`}
              >
                {t('schedule.statsBudget', { pct: Math.round(pct * 100), budget: `$${Math.round(weeklyBudget).toLocaleString()}` })}
              </span>
            )}
            <span>{t('schedule.statsDrafts', { n: filteredShifts.filter((s) => s.status === 'DRAFT').length })}</span>
            <span>{t('schedule.statsUnassigned', { n: filteredShifts.filter((s) => !s.user).length })}</span>
            {conflictCount > 0 && (
              <button
                onClick={() => setConflictsOpen((v) => !v)}
                className="flex items-center gap-1 text-red-600 font-medium hover:text-red-700 hover:underline transition"
              >
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {t('schedule.statsConflicts', { n: conflictCount })}
              </button>
            )}
          </div>
        );
      })()}

      {/* Conflicts Panel */}
      {conflictsOpen && conflictCount > 0 && (() => {
        // Build a list of conflict entries grouped by employee
        type ConflictEntry = { shift: Shift; conflicts: ShiftConflict[] };
        type EmployeeGroup = { name: string; entries: ConflictEntry[] };
        const groupMap = new Map<string, EmployeeGroup>();

        for (const [shiftId, shiftConflicts] of conflicts) {
          const shift = shifts.find((s) => s.id === shiftId);
          if (!shift) continue;
          const uid = shift.user?.id || '__unassigned__';
          const name = shift.user ? `${shift.user.firstName} ${shift.user.lastName}` : 'Unassigned';
          if (!groupMap.has(uid)) groupMap.set(uid, { name, entries: [] });
          // Dedupe — the same shift might appear in the map once already
          const group = groupMap.get(uid)!;
          if (!group.entries.some((e) => e.shift.id === shiftId)) {
            group.entries.push({ shift, conflicts: shiftConflicts });
          }
        }

        const groups = [...groupMap.values()].sort((a, b) => a.name.localeCompare(b.name));

        const typeLabel = (t: ShiftConflict['type']) => {
          switch (t) {
            case 'OVERLAP': return 'Overlap';
            case 'SHORT_REST': return 'Short Rest';
            case 'OVER_HOURS': return 'Over 50h';
            case 'OVERTIME': return 'Overtime';
            case 'BREAK_MISSING': return 'No Break';
          }
        };
        const typeBadgeClass = (t: ShiftConflict['type']) => {
          switch (t) {
            case 'OVERLAP':
            case 'SHORT_REST':
            case 'OVER_HOURS':
              return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
            case 'OVERTIME':
            case 'BREAK_MISSING':
              return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
          }
        };

        return (
          <div className="mt-4 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-sm font-semibold text-red-800 dark:text-red-200">
                  {conflictCount} Conflict{conflictCount !== 1 ? 's' : ''} Found
                </span>
              </div>
              <button
                onClick={() => setConflictsOpen(false)}
                className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              {groups.map((group) => (
                <div key={group.name}>
                  <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                    {group.name}
                  </div>
                  {group.entries.map(({ shift: s, conflicts: cs }) => (
                    <div key={s.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatDate(new Date(s.startTime))}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {formatTime(s.startTime)} – {formatTime(s.endTime)}
                          </span>
                          {s.position && (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.position.color }} />
                              {s.position.name}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {cs.map((c, i) => (
                            <span key={i} className="inline-flex items-center gap-1">
                              <span className={clsx('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', typeBadgeClass(c.type))}>
                                {typeLabel(c.type)}
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">{c.message}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        <button
                          onClick={() => { setConflictsOpen(false); setModal({ shift: s }); }}
                          className="rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => { if (confirm('Delete this shift?')) await onDeleteShift(s.id); }}
                          className="rounded-lg border border-red-300 dark:border-red-700 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Modal */}
      {modal && (
        <ShiftModal
          shift={modal.shift}
          defaultDate={modal.date}
          defaultUserId={modal.userId}
          members={members}
          positions={positions}
          locations={locations}
          onSave={async (data) => {
            await handleSave(data, modal.shift?.id);
          }}
          onDelete={modal.shift ? () => onDeleteShift(modal.shift!.id) : undefined}
          onClose={() => setModal(null)}
        />
      )}

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl bg-gray-900 text-white shadow-2xl px-4 py-3 border border-gray-700">
          <span className="text-sm font-medium mr-2">{t('schedule.selected', { n: selected.size })}</span>
          <select
            onChange={async (e) => {
              const val = e.target.value;
              if (!val || !onBulkAssign) return;
              const userId = val === '__unassigned__' ? null : val;
              await onBulkAssign(Array.from(selected), userId);
              clearSelection();
              e.target.value = '';
            }}
            defaultValue=""
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs"
          >
            <option value="">{t('schedule.assignTo')}</option>
            <option value="__unassigned__">{t('common.unassigned')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
            ))}
          </select>
          {onBulkPublish && (
            <button
              onClick={async () => { await onBulkPublish(Array.from(selected)); clearSelection(); }}
              className="rounded bg-green-600 hover:bg-green-700 px-3 py-1 text-xs font-medium"
            >
              {t('schedule.publish')}
            </button>
          )}
          {onBulkDelete && (
            <button
              onClick={async () => {
                if (!confirm(t('schedule.deleteConfirm', { n: selected.size }))) return;
                await onBulkDelete(Array.from(selected));
                clearSelection();
              }}
              className="rounded bg-red-600 hover:bg-red-700 px-3 py-1 text-xs font-medium"
            >
              {t('common.delete')}
            </button>
          )}
          <button
            onClick={clearSelection}
            className="rounded border border-gray-600 px-3 py-1 text-xs font-medium hover:bg-gray-800"
          >
            {t('schedule.clear')}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            'fixed top-6 right-6 z-50 max-w-sm rounded-xl border shadow-lg p-4',
            toast.kind === 'warn'
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700'
              : 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100 dark:border-indigo-700'
          )}
        >
          <div className="flex items-start gap-2">
            <span className="text-lg leading-none">{toast.kind === 'warn' ? '⚠' : 'ℹ'}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold mb-1">
                {toast.kind === 'warn' ? t('schedule.availabilityWarnings') : t('common.done')}
              </p>
              <ul className="text-xs space-y-0.5">
                {toast.lines.map((l, i) => <li key={i}>• {l}</li>)}
              </ul>
            </div>
            <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100 text-sm leading-none">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}
