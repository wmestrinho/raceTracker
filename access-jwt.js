// Cloudflare Access JWT verification.
//
// Access authenticates browser navigation at the edge and forwards the signed
// identity in the `Cf-Access-Jwt-Assertion` header. That header alone is NOT
// proof of anything to this Worker: a request that reaches the Worker by some
// other path (a direct workers.dev URL, a misordered Access policy, a Bypass
// rule that grew too broad) could set it freely. So every /api/* call verifies
// the signature, issuer, audience and expiry here, independently, before any
// identity is trusted. This is the replacement for the Postgres RLS the
// abandoned Supabase plan relied on.
//
// Config lives in wrangler.jsonc vars — neither value is a secret:
//   ACCESS_TEAM_DOMAIN  e.g. "absolutelyplausible.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's AUD tag
// The AUD tag is an identifier we check, never a credential we present.

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

// Module-scope cache. Worker isolates are short-lived and per-colo, so this is
// a best-effort hit, not a shared cache — a miss just refetches the JWKS.
const jwksCache = new Map();

export class AccessError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function loadKeys(teamDomain, { force = false } = {}) {
  const cached = jwksCache.get(teamDomain);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new AccessError('Could not reach the Access identity service', 503);

  const body = await response.json();
  const keys = new Map();
  for (const jwk of body?.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    ));
  }
  if (!keys.size) throw new AccessError('Access identity service returned no usable keys', 503);

  jwksCache.set(teamDomain, { keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return keys;
}

/**
 * Verify the Access assertion on a request.
 * Resolves to { email, sub } — throws AccessError otherwise. Never returns a
 * partially-trusted result: an unverifiable token is indistinguishable from
 * no token at all.
 */
export async function verifyAccessJwt(request, env) {
  const teamDomain = env?.ACCESS_TEAM_DOMAIN;
  const audience = env?.ACCESS_AUD;
  if (!teamDomain || !audience) {
    // Fail closed. A missing binding must never read as "no auth required".
    throw new AccessError('Access is not configured on this deployment', 503);
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new AccessError('Not signed in', 401);

  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('Malformed Access token', 401);

  let header;
  let payload;
  try {
    header = base64UrlToJson(parts[0]);
    payload = base64UrlToJson(parts[1]);
  } catch {
    throw new AccessError('Malformed Access token', 401);
  }

  if (header.alg !== 'RS256' || !header.kid) throw new AccessError('Unsupported Access token', 401);

  let keys = await loadKeys(teamDomain);
  let key = keys.get(header.kid);
  if (!key) {
    // Access rotates signing keys; an unknown kid is a cache miss, not a forgery.
    keys = await loadKeys(teamDomain, { force: true });
    key = keys.get(header.kid);
  }
  if (!key) throw new AccessError('Unknown Access signing key', 401);

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, base64UrlToBytes(parts[2]), signed
  );
  if (!valid) throw new AccessError('Access token signature did not verify', 401);

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new AccessError('Access session expired — reload to sign in again', 401);
  }
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    throw new AccessError('Access token is not valid yet', 401);
  }
  if (payload.iss !== `https://${teamDomain}`) {
    throw new AccessError('Access token came from a different organization', 401);
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) {
    throw new AccessError('Access token was issued for a different application', 401);
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) throw new AccessError('Access token carries no email identity', 401);

  return { email, sub: payload.sub || '' };
}
