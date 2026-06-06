import { useState } from 'react';

const CONFIG = {
  SAFE: {
    label: 'SAFE',
    pill:  'bg-green-100 text-green-800 ring-1 ring-green-300',
    dot:   'bg-green-500',
    pulse: false,
  },
  AT_RISK: {
    label: 'AT RISK',
    pill:  'bg-amber-100 text-amber-800 ring-1 ring-amber-300',
    dot:   'bg-amber-500',
    pulse: false,
  },
  BLOCKED: {
    label: 'BLOCKED',
    pill:  'bg-red-100 text-red-800 ring-1 ring-red-400 badge-blocked-pulse',
    dot:   'bg-red-500',
    pulse: true,
  },
};

const SIZE = {
  sm: { pill: 'text-xs px-2 py-0.5 gap-1', dot: 'w-1.5 h-1.5' },
  md: { pill: 'text-sm px-2.5 py-1 gap-1.5', dot: 'w-2 h-2' },
};

/**
 * RiskBadge — displays SAFE / AT_RISK / BLOCKED with score.
 *
 * @param {{ level: string, score: number, reasons?: Array, size?: 'sm'|'md' }} props
 */
export default function RiskBadge({ level, score, reasons = [], size = 'md' }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const cfg  = CONFIG[level] ?? CONFIG.SAFE;
  const sz   = SIZE[size]   ?? SIZE.md;

  return (
    <div className="relative inline-flex" data-testid="risk-badge">
      <span
        className={`inline-flex items-center rounded-full font-semibold cursor-default
                    ${cfg.pill} ${sz.pill}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-label={`Risk level: ${cfg.label}, score ${score}`}
      >
        {/* Animated dot */}
        <span
          className={`rounded-full flex-shrink-0 ${cfg.dot} ${sz.dot}
                      ${cfg.pulse ? 'animate-pulse' : ''}`}
          aria-hidden="true"
        />
        {cfg.label}
        {score !== undefined && (
          <span className="ml-1 opacity-70">({score})</span>
        )}
      </span>

      {/* Tooltip */}
      {showTooltip && reasons.length > 0 && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
                     w-64 rounded-lg bg-gray-900 text-white text-xs shadow-xl p-3"
          role="tooltip"
        >
          <p className="font-semibold mb-1.5 text-gray-300">Contributing factors</p>
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{r.window_name}</span>
                <span className="font-mono text-amber-300 flex-shrink-0">+{r.points}</span>
              </li>
            ))}
          </ul>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2
                          border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
