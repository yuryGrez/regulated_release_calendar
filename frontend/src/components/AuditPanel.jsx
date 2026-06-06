import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import client from '../api/client.js';
import RiskBadge from './RiskBadge.jsx';

/**
 * AuditPanel — shows full evaluation history for a release.
 * Fetches from the Audit Service (port 8084).
 */
export default function AuditPanel({ releaseId, releaseName }) {
  const [entries,  setEntries]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const AUDIT_BASE = import.meta.env.VITE_AUDIT_URL || 'http://localhost:8084';

  useEffect(() => {
    if (!releaseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    client.get(`${AUDIT_BASE}/api/v1/audit/${releaseId}`)
      .then((r) => { if (!cancelled) setEntries(r.data); })
      .catch(() => { if (!cancelled) setError('Could not load audit trail.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [releaseId]);

  async function downloadPdf() {
    const res = await client.get(`${AUDIT_BASE}/api/v1/audit/${releaseId}/export`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `audit-${releaseId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">
          Audit trail — {releaseName}
        </h3>
        <button
          onClick={downloadPdf}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200
                     text-gray-700 font-medium transition-colors"
        >
          Export PDF
        </button>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error   && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-gray-400 italic">No evaluations recorded yet.</p>
      )}

      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="border border-gray-100 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <RiskBadge level={e.level} score={e.score} size="sm" />
              <time className="text-xs text-gray-400">
                {format(parseISO(e.timestamp), 'd MMM yyyy HH:mm')}
              </time>
            </div>
            {e.reasons?.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {e.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-gray-600 flex justify-between">
                    <span>{r.window_name}</span>
                    <span className="font-mono text-gray-400">+{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
