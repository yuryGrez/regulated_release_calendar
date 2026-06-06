import client from './client.js';

// Calendar Service runs on a different port in dev; proxy in Vite config handles /api/v1/windows
const CALENDAR_BASE = import.meta.env.VITE_CALENDAR_URL || 'http://localhost:8083';

export const windowsApi = {
  /** All windows for a jurisdiction + year (cached by Calendar Service) */
  list: (jurisdiction, year) =>
    client
      .get(`${CALENDAR_BASE}/api/v1/windows`, { params: { jurisdiction, year } })
      .then((r) => r.data),

  /** Windows active today or starting within 30 days */
  active: (jurisdiction) =>
    client
      .get(`${CALENDAR_BASE}/api/v1/windows/active`, { params: { jurisdiction } })
      .then((r) => r.data),
};
