import { format, parseISO } from 'date-fns';

const TYPE_STYLE = {
  BLACKOUT:        'bg-red-100 text-red-800 ring-red-300',
  FREEZE:          'bg-amber-100 text-amber-800 ring-amber-300',
  AUDIT_PROXIMITY: 'bg-yellow-100 text-yellow-800 ring-yellow-300',
};

const TYPE_LABEL = {
  BLACKOUT:        'Blackout',
  FREEZE:          'Freeze',
  AUDIT_PROXIMITY: 'Audit proximity',
};

/**
 * Sidebar listing all regulatory windows for the current view.
 */
export default function WindowSidebar({ windows = [], loading }) {
  if (loading) {
    return (
      <aside className="w-64 shrink-0 bg-white rounded-xl shadow p-4 space-y-3" aria-label="Regulatory windows">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
        ))}
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 bg-white rounded-xl shadow p-4" aria-label="Regulatory windows">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Regulatory Windows
      </h3>

      {windows.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No windows in this period.</p>
      ) : (
        <ul className="space-y-2">
          {windows.map((w) => (
            <li key={w.id}
              className="rounded-lg border border-gray-100 p-3 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ring-1 ${TYPE_STYLE[w.type] ?? TYPE_STYLE.FREEZE}`}>
                  {TYPE_LABEL[w.type] ?? w.type}
                </span>
                {w.is_manual && (
                  <span className="text-xs text-gray-400">manual</span>
                )}
              </div>
              <p className="text-sm font-medium text-gray-800 leading-tight">{w.name}</p>
              <p className="text-xs text-gray-500 mt-1">
                {format(parseISO(w.start_date), 'd MMM yyyy')}
                {w.start_date !== w.end_date && (
                  <> – {format(parseISO(w.end_date), 'd MMM yyyy')}</>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
