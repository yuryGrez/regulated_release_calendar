import { useState, useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isSameDay,
  addMonths, subMonths, parseISO, isWithinInterval,
} from 'date-fns';
import RiskBadge from './RiskBadge.jsx';
import ReleaseForm from './ReleaseForm.jsx';
import WindowSidebar from './WindowSidebar.jsx';
import { useReleases } from '../hooks/useReleases.js';
import { useWindows } from '../hooks/useWindows.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const WINDOW_BAND = {
  BLACKOUT:        'bg-red-50 border-l-2 border-red-300',
  FREEZE:          'bg-amber-50 border-l-2 border-amber-300',
  AUDIT_PROXIMITY: 'ring-1 ring-inset ring-yellow-300 bg-yellow-50',
};

/**
 * Main calendar grid.
 *
 * Props:
 *   jurisdiction  string   e.g. 'FCA'
 */
export default function CalendarView({ jurisdiction = 'FCA' }) {
  const [viewDate,     setViewDate]     = useState(new Date());
  const [selected,     setSelected]     = useState(null);   // { release } | { date } | null
  const [drawerOpen,   setDrawerOpen]   = useState(false);

  const monthStart = startOfMonth(viewDate);
  const monthEnd   = endOfMonth(viewDate);

  // Date range for API calls — full month
  const from = format(monthStart, 'yyyy-MM-dd');
  const to   = format(monthEnd,   'yyyy-MM-dd');

  const { releases, loading: relLoading, refresh } = useReleases(from, to);
  const { windows,  loading: winLoading }          = useWindows(jurisdiction, viewDate.getFullYear());

  // Build calendar grid: 6-row × 7-col, padded with prev/next month days
  const gridDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const end   = endOfWeek(monthEnd,     { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [viewDate]);

  // Index releases by date string for O(1) lookup
  const releasesByDate = useMemo(() => {
    const map = {};
    for (const r of releases) {
      const key = r.planned_date instanceof Date
        ? format(r.planned_date, 'yyyy-MM-dd')
        : r.planned_date;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [releases]);

  // Determine which windows cover a given day
  function windowsForDay(day) {
    return windows.filter((w) => {
      try {
        return isWithinInterval(day, {
          start: parseISO(w.start_date),
          end:   parseISO(w.end_date),
        });
      } catch { return false; }
    });
  }

  // Dominant band class for a day (BLACKOUT > FREEZE > AUDIT_PROXIMITY)
  function bandClass(day) {
    const ww = windowsForDay(day);
    if (ww.some((w) => w.type === 'BLACKOUT'))        return WINDOW_BAND.BLACKOUT;
    if (ww.some((w) => w.type === 'FREEZE'))          return WINDOW_BAND.FREEZE;
    if (ww.some((w) => w.type === 'AUDIT_PROXIMITY')) return WINDOW_BAND.AUDIT_PROXIMITY;
    return '';
  }

  function openRelease(release) {
    setSelected({ release });
    setDrawerOpen(true);
  }

  function openNewRelease(date) {
    setSelected({ date: format(date, 'yyyy-MM-dd') });
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setSelected(null);
  }

  async function handleFormSuccess() {
    await refresh();
    closeDrawer();
  }

  const today = new Date();

  return (
    <div className="flex gap-4 p-4 h-full">
      {/* ── Calendar ─────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-white rounded-xl shadow overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <button
            onClick={() => setViewDate((d) => subMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 text-lg leading-none"
            aria-label="Previous month"
          >‹</button>

          <h2 className="text-base font-semibold text-gray-900">
            {format(viewDate, 'MMMM yyyy')}
          </h2>

          <button
            onClick={() => setViewDate((d) => addMonths(d, 1))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 text-lg leading-none"
            aria-label="Next month"
          >›</button>
        </div>

        {/* Loading bar */}
        {(relLoading || winLoading) && (
          <div className="h-0.5 bg-blue-100">
            <div className="h-full bg-blue-500 animate-pulse w-full" />
          </div>
        )}

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-gray-500">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 auto-rows-fr">
          {gridDays.map((day) => {
            const key        = format(day, 'yyyy-MM-dd');
            const inMonth    = isSameMonth(day, viewDate);
            const isToday    = isSameDay(day, today);
            const dayRels    = releasesByDate[key] ?? [];
            const band       = bandClass(day);

            return (
              <div
                key={key}
                onClick={() => inMonth && openNewRelease(day)}
                className={`
                  min-h-[90px] border-b border-r border-gray-100 p-1.5
                  ${inMonth ? 'calendar-day' : 'bg-gray-50/60 cursor-default'}
                  ${band}
                `}
                data-testid={`calendar-day-${key}`}
              >
                {/* Day number */}
                <div className={`
                  text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday  ? 'bg-blue-600 text-white' : ''}
                  ${!isToday && inMonth ? 'text-gray-700' : 'text-gray-400'}
                `}>
                  {format(day, 'd')}
                </div>

                {/* Release pills */}
                <div className="space-y-0.5">
                  {dayRels.map((r) => (
                    <div
                      key={r.release_id}
                      onClick={(e) => { e.stopPropagation(); openRelease(r); }}
                      className="truncate cursor-pointer"
                      title={r.name}
                    >
                      {r.risk_level ? (
                        <RiskBadge level={r.risk_level} score={r.risk_score} size="sm" />
                      ) : (
                        <span className="inline-block text-xs bg-gray-200 text-gray-600
                                         rounded px-1.5 py-0.5 truncate max-w-full">
                          {r.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <WindowSidebar
        windows={windows.filter((w) => {
          // Show only windows that overlap the current month
          try {
            const ms = monthStart, me = monthEnd;
            const ws = parseISO(w.start_date), we = parseISO(w.end_date);
            return ws <= me && we >= ms;
          } catch { return false; }
        })}
        loading={winLoading}
      />

      {/* ── Drawer / modal ────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-end"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={closeDrawer}
          />

          {/* Panel */}
          <div className="relative z-50 h-full w-full max-w-md bg-white shadow-2xl
                          overflow-y-auto p-6 flex flex-col gap-4">
            <ReleaseForm
              initialDate={selected?.date}
              release={selected?.release}
              onSuccess={handleFormSuccess}
              onCancel={closeDrawer}
            />
          </div>
        </div>
      )}
    </div>
  );
}
