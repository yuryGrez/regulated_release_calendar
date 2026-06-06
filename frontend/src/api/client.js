import axios from 'axios';

// Token getter injected at app startup by Auth0Provider wrapper
let _getAccessToken = null;
export function setTokenGetter(fn) { _getAccessToken = fn; }

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8081',
  timeout: 15_000,
});

// ── Request interceptor: attach Bearer token ──────────────────────────────────
client.interceptors.request.use(async (config) => {
  if (_getAccessToken) {
    try {
      const token = await _getAccessToken({
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      });
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch {
      // Token fetch failed — request proceeds unauthenticated; 401 handler below fires
    }
  }
  return config;
});

// ── Response interceptor: error normalisation ────────────────────────────────
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;

    if (status === 401) {
      // Let the Auth0 SDK redirect — fire a custom event so App.jsx can react
      window.dispatchEvent(new CustomEvent('rrc:auth-required'));
    } else if (status === 429) {
      window.dispatchEvent(new CustomEvent('rrc:toast', {
        detail: { type: 'warn', message: 'Rate limit reached — please wait a moment.' },
      }));
    } else if (status >= 500) {
      window.dispatchEvent(new CustomEvent('rrc:toast', {
        detail: { type: 'error', message: 'Server error — please try again.' },
      }));
    }

    return Promise.reject(err);
  },
);

export default client;
