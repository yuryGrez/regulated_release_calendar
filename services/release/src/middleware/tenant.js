import pool from '../db/pool.js';

export function tenantMiddleware(req, res, next) {
  // tenant_id comes from Auth0 JWT custom claim, or X-Tenant-ID set by gateway
  const tenantId = req.user?.tenant_id
    || req.headers['x-tenant-id'];

  if (!tenantId) {
    return res.status(401).json({ error: { code: 'NO_TENANT', message: 'Tenant context required' } });
  }

  req.tenantId = tenantId;
  next();
}

// Call this before any DB query to enable RLS
export async function setTenantContext(client, tenantId) {
  await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
}
