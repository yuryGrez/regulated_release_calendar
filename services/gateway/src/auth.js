/**
 * JWT validation middleware for the MVP gateway.
 * Verifies Auth0 RS256 tokens via JWKS endpoint.
 * Extracts tenant_id from the token's custom claim and sets X-Tenant-ID header.
 */
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import logger from './logger.js';

const jwksClient = jwksRsa({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000,  // 10 min
  rateLimit: true,
});

function getKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function authMiddleware(req, res, next) {
  // Skip auth for health check and webhook (webhook uses HMAC)
  if (req.path === '/health' || req.path.startsWith('/webhooks/')) {
    return next();
  }

  // SKIP_AUTH=true bypasses JWT validation — for dev/staging only.
  // Requires x-tenant-id header to be set manually by the caller.
  if (process.env.SKIP_AUTH === 'true') {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return res.status(401).json({
        error: { code: 'MISSING_TENANT', message: 'x-tenant-id header required when SKIP_AUTH=true' },
      });
    }
    logger.warn({ msg: 'auth_skipped', tenant_id: tenantId, path: req.path });
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> required' },
    });
  }

  const token = header.slice(7);
  jwt.verify(
    token,
    getKey,
    { algorithms: ['RS256'], audience: process.env.AUTH0_AUDIENCE },
    (err, decoded) => {
      if (err) {
        logger.warn({ msg: 'jwt_verification_failed', error: err.message });
        return res.status(401).json({
          error: { code: 'INVALID_TOKEN', message: 'Token verification failed' },
        });
      }

      // Extract tenant_id from custom claim (set in Auth0 rule/action)
      // Convention: https://rrc.dev/tenant_id custom claim
      const tenantId =
        decoded['https://rrc.dev/tenant_id'] ??
        decoded.org_id ??
        decoded.sub;

      // Downstream services trust this header — they don't re-validate the JWT
      req.headers['x-tenant-id'] = tenantId;
      req.headers['x-user-sub']  = decoded.sub;

      // Remove Authorization so internal services don't accidentally accept it
      // (they only trust x-tenant-id from the gateway)
      // Keep it so internal services can optionally inspect it
      next();
    }
  );
}
