import { useState, useEffect, useRef } from 'react';
import { releasesApi } from '../api/releases.js';
import RiskBadge from './RiskBadge.jsx';

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS  = 30_000;

/**
 * ReleaseForm — create or edit a release.
 *
 * Props:
 *   initialDate  string?     Pre-fill planned_date (YYYY-MM-DD) when clicking an empty day
 *   release      object?     Existing release for edit mode
 *   onSuccess    fn          Called after successful create/update with the release object
 *   onCancel     fn          Called when user dismisses the form
 */
export default function ReleaseForm({ initialDate, release: existingRelease, onSuccess, onCancel }) {
  const isEdit = Boolean(existingRelease);

  const [name,        setName]        = useState(existingRelease?.name        ?? '');
  const [plannedDate, setPlannedDate] = useState(existingRelease?.planned_date ?? initialDate ?? '');
  const [ownerId,     setOwnerId]     = useState(existingRelease?.owner_id     ?? '');
  const [status,      setStatus]      = useState(existingRelease?.status       ?? 'draft');

  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);

  // Risk evaluation state
  const [evaluating,   setEvaluating]   = useState(false);
  const [riskResult,   setRiskResult]   = useState(existingRelease?.risk ?? null);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const pollRef      = useRef(null);
  const pollStartRef = useRef(null);

  // Populate risk from existing release on open
  useEffect(() => {
    if (existingRelease?.risk) setRiskResult(existingRelease.risk);
  }, [existingRelease]);

  // Cleanup poll on unmount
  useEffect(() => () => clearTimeout(pollRef.current), []);

  async function pollRisk(releaseId) {
    setEvaluating(true);
    setPollTimedOut(false);
    pollStartRef.current = Date.now();

    async function attempt() {
      if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) {
        setEvaluating(false);
        setPollTimedOut(true);
        return;
      }
      try {
        const risk = await releasesApi.getRisk(releaseId);
        setRiskResult(risk);
        setEvaluating(false);
      } catch (err) {
        if (err?.response?.status === 404) {
          // Not ready yet — keep polling
          pollRef.current = setTimeout(attempt, POLL_INTERVAL_MS);
        } else {
          setEvaluating(false);
        }
      }
    }

    pollRef.current = setTimeout(attempt, POLL_INTERVAL_MS);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setRiskResult(null);

    try {
      if (isEdit) {
        await releasesApi.update(existingRelease.release_id, {
          planned_date: plannedDate,
          status,
        });
        pollRisk(existingRelease.release_id);
        onSuccess?.(existingRelease.release_id);
      } else {
        if (!ownerId.match(/^[0-9a-f-]{36}$/i)) {
          setError('Owner ID must be a valid UUID.');
          setSubmitting(false);
          return;
        }
        const created = await releasesApi.create({ name, planned_date: plannedDate, owner_id: ownerId });
        pollRisk(created.release_id);
        onSuccess?.(created.release_id);
      }
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">
          {isEdit ? 'Edit Release' : 'New Release'}
        </h2>
        {onCancel && (
          <button onClick={onCancel} aria-label="Close"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Name */}
        {!isEdit && (
          <Field label="Release name" required htmlFor="rf-name">
            <input
              id="rf-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Payments v2.3"
              className={inputCls}
            />
          </Field>
        )}

        {/* Date */}
        <Field label="Planned date" required htmlFor="rf-date">
          <input
            id="rf-date"
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
            required
            className={inputCls}
          />
        </Field>

        {/* Owner (create only) */}
        {!isEdit && (
          <Field label="Owner ID (UUID)" htmlFor="rf-owner">
            <input
              id="rf-owner"
              type="text"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={inputCls}
            />
          </Field>
        )}

        {/* Status (edit only) */}
        {isEdit && (
          <Field label="Status" htmlFor="rf-status">
            <select id="rf-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="deployed">Deployed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2" role="alert">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                     text-white font-medium rounded-lg transition-colors"
        >
          {submitting ? 'Saving…' : isEdit ? 'Update Release' : 'Create Release'}
        </button>
      </form>

      {/* Risk evaluation result */}
      {evaluating && (
        <div className="mt-5 flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
          <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent
                           rounded-full animate-spin" />
          Evaluating regulatory risk…
        </div>
      )}

      {pollTimedOut && !riskResult && (
        <p className="mt-4 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          Risk evaluation is taking longer than expected. Refresh the calendar to see the result.
        </p>
      )}

      {riskResult && !evaluating && (
        <div className="mt-5 p-4 rounded-lg border border-gray-100 bg-gray-50">
          <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
            Regulatory risk assessment
          </p>
          <RiskBadge level={riskResult.level} score={riskResult.score} reasons={riskResult.reasons} size="md" />
          {riskResult.reasons?.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {riskResult.reasons.map((r, i) => (
                <li key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700 truncate mr-2">{r.window_name}</span>
                  <span className="font-mono text-xs text-gray-500 flex-shrink-0">+{r.points} pts</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = `w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  disabled:bg-gray-100`;

function Field({ label, required, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
