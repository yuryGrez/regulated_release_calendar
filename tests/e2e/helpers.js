/**
 * E2E test helpers.
 * Run against a live docker-compose stack: `docker-compose up`
 * then `npm test` from this directory.
 */
import axios from 'axios';

export const RELEASE_SVC  = process.env.RELEASE_SVC_URL  || 'http://localhost:8081';
export const CALENDAR_SVC = process.env.CALENDAR_SVC_URL || 'http://localhost:8083';
export const AUDIT_SVC    = process.env.AUDIT_SVC_URL    || 'http://localhost:8084';

export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_OWNER_ID  = '99999999-9999-9999-9999-999999999999';

// Axios client that mimics the gateway's tenant header injection
// (In full E2E you'd go through :8080 with a real JWT; here we call services directly
//  with x-tenant-id and SKIP_AUTH to keep tests self-contained)
export const api = axios.create({
  headers: {
    'Content-Type':  'application/json',
    'x-tenant-id':   TEST_TENANT_ID,
    'x-test-user':   JSON.stringify({ sub: 'user1', tenant_id: TEST_TENANT_ID }),
  },
  validateStatus: () => true,   // never throw on HTTP errors — we assert manually
});

/**
 * Poll a URL until the predicate passes or timeout is reached.
 * @param {function} fn        Async function returning a value to test
 * @param {function} predicate Returns true when done
 * @param {number}   timeout   Max ms to wait
 * @param {number}   interval  Poll interval ms
 */
export async function pollUntil(fn, predicate, timeout = 15_000, interval = 1_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (predicate(result)) return result;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`pollUntil timed out after ${timeout}ms`);
}

/** Wait for a service health endpoint to return 200. */
export async function waitForService(url, maxMs = 30_000) {
  return pollUntil(
    () => api.get(`${url}/health`).catch(() => ({ status: 0 })),
    (res) => res.status === 200,
    maxMs,
    1_000
  );
}
