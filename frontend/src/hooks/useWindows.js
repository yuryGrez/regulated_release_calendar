import { useState, useEffect } from 'react';
import { windowsApi } from '../api/windows.js';

/**
 * Fetch regulatory windows for a jurisdiction + year.
 * Results are cached by the Calendar Service (Redis 24 h TTL).
 */
export function useWindows(jurisdiction, year) {
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!jurisdiction || !year) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    windowsApi.list(jurisdiction, year)
      .then((data) => { if (!cancelled) setWindows(data); })
      .catch((err) => {
        if (!cancelled)
          setError(err?.response?.data?.error?.message ?? 'Failed to load windows');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [jurisdiction, year]);

  return { windows, loading, error };
}
