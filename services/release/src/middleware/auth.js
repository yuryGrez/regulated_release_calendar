import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

const jwksClient = jwksRsa({
  jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

function getKey(header, callback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

export function authMiddleware(req, res, next) {
  // In dev/test skip auth if explicitly disabled
  if (process.env.NODE_ENV === 'test' && process.env.SKIP_AUTH === 'true') {
    req.user = req.headers['x-test-user']
      ? JSON.parse(req.headers['x-test-user'])
      : { sub: '00000000-0000-0000-0000-000000000001', tenant_id: '00000000-0000-0000-0000-000000000001' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });
  }

  const token = authHeader.slice(7);
  jwt.verify(token, getKey, { algorithms: ['RS256'], audience: process.env.AUTH0_AUDIENCE }, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token verification failed' } });
    }
    req.user = decoded;
    next();
  });
}
