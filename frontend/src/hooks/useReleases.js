import { useState, useEffect, useCallback } from 'react';
import { releasesApi } from '../api/releases.js';

/**
 * Fetch and manage releases for a date window.
 * @param {string} from  YYYY-MM-DD
 * @param {string} to    YYYY-MM-DD
 */
export function useReleases(from, to) {
  const [releases, setReleases] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const data = await releasesApi.list(from, to);
      setReleases(data);
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? 'Failed to load releases');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const createRelease = useCallback(async (body) => {
    const created = await releasesApi.create(body);
    await load();          // refresh list
    return created;
  }, [load]);

  const updateRelease = useCallback(async (id, body) => {
    const updated = await releasesApi.update(id, body);
    await load();
    return updated;
  }, [load]);

  const removeRelease = useCallback(async (id) => {
    await releasesApi.remove(id);
    setReleases((prev) => prev.filter((r) => r.release_id !== id));
  }, []);

  return { releases, loading, error, refresh: load, createRelease, updateRelease, removeRelease };
}
