import type { Shift } from '@/types';

export function exportShiftsToCSV(shifts: Shift[], weekLabel: string) {
  const headers = ['Date', 'Start', 'End', 'Hours', 'Employee', 'Position', 'Location', 'Status', 'Notes'];

  const rows = shifts
    .slice()
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .map((s) => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      const hours = ((end.getTime() - start.getTime()) / 3600000).toFixed(2);
      return [
        start.toLocaleDateString('en-US'),
        start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        hours,
        s.user ? `${s.user.firstName} ${s.user.lastName}` : 'Unassigned',
        s.position?.name || '',
        s.location?.name || '',
        s.status,
        (s.notes || '').replace(/"/g, '""'),
      ];
    });

  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pelican-schedule-${weekLabel}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
