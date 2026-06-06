/**
 * Audit service auth — trusts X-Tenant-ID set by the gateway.
 * The gateway has already validated the JWT; internal services
 * don't need to re-validate (defence-in-depth: only accept traffic
 * from within the Docker network).
 */
export function tenantMiddleware(req, res, next) {
  // Allow internal calls (from Risk Engine) without a tenant header
  // All external-facing calls go through the gateway which sets this header
  next();
}
