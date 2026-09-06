// Contract tests for Cloudflare Access verification and the ops API's
// authorization rules — the checks that replaced Postgres RLS.
//
// Run: node --test scripts/test_ops.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJwt, AccessError } from '../access-jwt.js';
import { handleOps } from '../ops-api.js';
import worker from '../worker.js';

// ── Test rig ──────────────────────────────────────────────────────────────

const b64url = bytes => Buffer.from(bytes).toString('base64url');

// access-jwt.js caches the JWKS per team domain at module scope. Giving each
// keypair its own kid means a new test's token is a cache miss rather than a
// stale hit — which is exactly the key-rotation path, so this exercises it too.
let kidCounter = 0;

async function makeKeypair(kid = `test-kid-${++kidCounter}`) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, kid, jwk: { ...jwk, kid, alg: 'RS256' } };
}

async function mintToken({ pair, kid }, claims) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** Serve the JWKS for one team domain; every other fetch is a hard failure. */
function stubJwks(keys) {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/cdn-cgi/access/certs')) {
      return Response.json({ keys: keys.map(k => k.jwk) });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/**
 * Fake D1. Records every statement so a test can assert on the SQL the
 * authorization rules produce, and returns canned rows by SQL fingerprint.
 */
function fakeDb({ profile, entities = [], signoffs = [], profiles = [] } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const stmt = { sql, binds: [] };
      calls.push(stmt);
      const api = {
        bind(...binds) { stmt.binds = binds; return api; },
        async first() {
          if (sql.includes('FROM profiles WHERE email')) return profile ?? null;
          return null;
        },
        async all() {
          if (sql.includes('FROM profile_entities')) return { results: entities.map(id => ({ entity_id: id })) };
          if (sql.includes('FROM pretech_signoffs')) return { results: signoffs };
          if (sql.includes('FROM profiles WHERE active')) return { results: profiles };
          return { results: [] };
        },
        async run() { return { success: true }; }
      };
      return api;
    }
  };
}

const TEAM = 'test-team.cloudflareaccess.com';
const AUD = 'aud-tag-for-racetracker';
const now = () => Math.floor(Date.now() / 1000);

function claims(overrides = {}) {
  return { iss: `https://${TEAM}`, aud: [AUD], email: 'luiz@example.com', sub: 'sub-1', exp: now() + 600, iat: now(), ...overrides };
}

function env(db, overrides = {}) {
  return { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OPS_DB: db, ...overrides };
}

const req = (path, { token, method = 'GET', body } = {}) => new Request(`https://tracker.example${path}`, {
  method,
  headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  ...(body ? { body: JSON.stringify(body) } : {})
});

const ops = (request, environment) => handleOps(request, environment, new URL(request.url));

// ── Token verification ────────────────────────────────────────────────────

test('a valid Access token resolves to a lowercased email identity', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims({ email: 'Luiz@Example.com' }));
  const identity = await verifyAccessJwt(req('/api/me', { token }), env(fakeDb()));
  assert.equal(identity.email, 'luiz@example.com');
  assert.equal(identity.sub, 'sub-1');
});

test('a missing, malformed, unsigned or wrongly-signed token is refused', async () => {
  const key = await makeKeypair();
  const attacker = await makeKeypair(key.kid); // same kid, different signing key
  stubJwks([key]);
  const good = await mintToken(key, claims());
  const forged = await mintToken(attacker, claims());

  for (const token of [undefined, 'not.a.jwt', 'a.b', `${good}tampered`, forged]) {
    await assert.rejects(
      () => verifyAccessJwt(req('/api/me', { token }), env(fakeDb())),
      err => err instanceof AccessError && err.status === 401
    );
  }
});

test('a token for another application or another organization is refused', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  for (const override of [
    { aud: ['some-other-app'] },
    { aud: [] },
    { iss: 'https://evil.cloudflareaccess.com' }
  ]) {
    const token = await mintToken(key, claims(override));
    await assert.rejects(
      () => verifyAccessJwt(req('/api/me', { token }), env(fakeDb())),
      err => err instanceof AccessError && err.status === 401
    );
  }
});

test('an expired token is refused, and an email-less token is refused', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  for (const override of [{ exp: now() - 3600 }, { email: '' }, { email: undefined }]) {
    const token = await mintToken(key, claims(override));
    await assert.rejects(
      () => verifyAccessJwt(req('/api/me', { token }), env(fakeDb())),
      err => err instanceof AccessError && err.status === 401
    );
  }
});

test('an unconfigured deployment fails closed rather than skipping auth', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  for (const broken of [{ ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_AUD: undefined }]) {
    const response = await ops(req('/api/me', { token }), env(fakeDb(), broken));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).profile, undefined);
  }
});

// ── Provisioning is separate from sign-in ─────────────────────────────────

test('an authenticated user with no profile row gets 403 and an actionable message', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const response = await ops(req('/api/me', { token }), env(fakeDb({ profile: null })));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /No raceTracker profile exists for luiz@example\.com/);
  assert.equal(body.profile, undefined);
});

test('a deactivated profile is refused even with a valid token', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({ profile: { id: 'p1', email: 'luiz@example.com', name: 'Luiz', role: 'AP', clearance: 'admin', active: 0 } });
  const response = await ops(req('/api/me', { token }), env(db));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /deactivated/);
});

test('/api/me returns the profile and its granted businesses, uncached', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'p1', email: 'luiz@example.com', name: 'Luiz', role: 'AP Operations', clearance: 'admin', active: 1 },
    entities: ['evolution-kart-school', 'the-kart-depot']
  });
  const response = await ops(req('/api/me', { token }), env(db));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.profile.name, 'Luiz');
  assert.equal(body.profile.active, true);
  assert.deepEqual(body.entities, ['evolution-kart-school', 'the-kart-depot']);
});

// ── Entity scoping ────────────────────────────────────────────────────────

test('a business the caller is not assigned to is refused, not silently widened', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'p2', email: 'luiz@example.com', name: 'Tito', role: 'Ops', clearance: 'staff', active: 1 },
    entities: ['evolution-kart-school']
  });
  const response = await ops(req('/api/pretech/signoffs?entity=the-kart-depot', { token }), env(db));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /not assigned to that business/);
});

// ── The rule that replaced RLS ────────────────────────────────────────────

test('a non-admin read is restricted to own history plus today; an admin read is not', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const today = new Date().toISOString().slice(0, 10);

  const staffDb = fakeDb({
    profile: { id: 'mech-1', email: 'luiz@example.com', name: 'Mechanic', role: 'Mechanic', clearance: 'staff', active: 1 },
    entities: ['evolution-kart-school']
  });
  await ops(req('/api/pretech/signoffs?from=2026-01-01&to=2026-12-31&profile=someone-else', { token }), env(staffDb));
  const staffQuery = staffDb.calls.find(c => c.sql.includes('FROM pretech_signoffs'));
  assert.match(staffQuery.sql, /\(profile_id = \? OR signoff_date = \?\)/);
  assert.ok(staffQuery.binds.includes('mech-1'), 'restriction must bind the caller, not the requested profile');
  assert.ok(staffQuery.binds.includes(today), 'today must stay visible so the crew table works');

  const adminDb = fakeDb({
    profile: { id: 'admin-1', email: 'luiz@example.com', name: 'Luiz', role: 'AP', clearance: 'admin', active: 1 },
    entities: ['evolution-kart-school']
  });
  await ops(req('/api/pretech/signoffs?from=2026-01-01&to=2026-12-31', { token }), env(adminDb));
  const adminQuery = adminDb.calls.find(c => c.sql.includes('FROM pretech_signoffs'));
  assert.doesNotMatch(adminQuery.sql, /OR signoff_date = \?/);
});

test('signoff rows come back with items parsed and complete as a boolean', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'admin-1', email: 'luiz@example.com', name: 'Luiz', role: 'AP', clearance: 'admin', active: 1 },
    entities: ['evolution-kart-school'],
    signoffs: [
      { id: 's1', profile_id: 'mech-1', entity_id: 'evolution-kart-school', signoff_date: '2026-09-05', kart: '#3', notes: null, items: '{"helmet":true}', complete: 1, signed_at: '2026-09-05T12:00:00Z' },
      { id: 's2', profile_id: 'mech-2', entity_id: 'evolution-kart-school', signoff_date: '2026-09-04', kart: null, notes: null, items: 'not json', complete: 0, signed_at: '2026-09-04T12:00:00Z' }
    ]
  });
  const body = await (await ops(req('/api/pretech/signoffs', { token }), env(db))).json();
  assert.deepEqual(body.signoffs[0].items, { helmet: true });
  assert.equal(body.signoffs[0].complete, true);
  // A corrupt items blob must not take the whole page down.
  assert.deepEqual(body.signoffs[1].items, {});
  assert.equal(body.signoffs[1].complete, false);
});

test('an invalid date range is refused before it reaches the database', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'admin-1', email: 'luiz@example.com', name: 'Luiz', role: 'AP', clearance: 'admin', active: 1 },
    entities: ['evolution-kart-school']
  });
  const response = await ops(req('/api/pretech/signoffs?from=2026-13-45', { token }), env(db));
  assert.equal(response.status, 400);
  assert.equal(db.calls.some(c => c.sql.includes('FROM pretech_signoffs')), false);
});

// ── Writes ────────────────────────────────────────────────────────────────

test('a sign-off is always attributed to the verified caller, never to the request body', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'mech-1', email: 'luiz@example.com', name: 'Mechanic', role: 'Mechanic', clearance: 'staff', active: 1 },
    entities: ['evolution-kart-school']
  });
  const response = await ops(req('/api/pretech/signoffs', {
    token,
    method: 'POST',
    body: {
      profile_id: 'someone-else',
      entity_id: 'evolution-kart-school',
      signoff_date: '2026-09-05',
      items: { helmet: true, pedals: true }
    }
  }), env(db));

  assert.equal(response.status, 200);
  const insert = db.calls.find(c => c.sql.includes('INSERT INTO pretech_signoffs'));
  assert.ok(insert.binds.includes('mech-1'));
  assert.equal(insert.binds.includes('someone-else'), false, 'a spoofed profile_id must never be written');
  assert.equal((await response.json()).complete, true);
});

test('an all-false or empty checklist is not recorded as complete', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const profile = { id: 'mech-1', email: 'luiz@example.com', name: 'Mechanic', role: 'Mechanic', clearance: 'staff', active: 1 };
  for (const items of [{}, { helmet: false }, { helmet: true, pedals: false }]) {
    const db = fakeDb({ profile, entities: ['evolution-kart-school'] });
    const body = await (await ops(req('/api/pretech/signoffs', {
      token, method: 'POST', body: { entity_id: 'evolution-kart-school', items }
    }), env(db))).json();
    assert.equal(body.complete, false);
  }
});

test('a malformed write body is refused without touching the sign-off table', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'mech-1', email: 'luiz@example.com', name: 'Mechanic', role: 'Mechanic', clearance: 'staff', active: 1 },
    entities: ['evolution-kart-school']
  });
  const request = new Request('https://tracker.example/api/pretech/signoffs', {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token }, body: 'not json'
  });
  const response = await handleOps(request, env(db), new URL(request.url));
  assert.equal(response.status, 400);
  assert.equal(db.calls.some(c => c.sql.includes('INSERT INTO pretech_signoffs')), false);
});

// ── Routing ───────────────────────────────────────────────────────────────

test('the worker routes ops paths through Access and leaves public paths alone', async () => {
  const key = await makeKeypair();
  stubJwks([key]);

  // No assertion header: refused before any database work.
  const denied = await worker.fetch(req('/api/me'), env(fakeDb()));
  assert.equal(denied.status, 401);

  // The public calendar adapter is untouched by the ops router.
  const calendar = await worker.fetch(req('/api/calendar'), {});
  assert.notEqual(calendar.status, 401);

  // Static assets still fall through to the assets binding.
  const asset = await worker.fetch(new Request('https://tracker.example/registrations.html'), {
    ASSETS: { fetch: () => new Response('asset') }
  });
  assert.equal(await asset.text(), 'asset');
});

test('an unknown ops path is 404 and a wrong method is 405 with Allow', async () => {
  const key = await makeKeypair();
  stubJwks([key]);
  const token = await mintToken(key, claims());
  const db = fakeDb({
    profile: { id: 'admin-1', email: 'luiz@example.com', name: 'Luiz', role: 'AP', clearance: 'admin', active: 1 },
    entities: ['evolution-kart-school']
  });
  const notFound = await ops(req('/api/nope', { token }), env(db));
  assert.equal(notFound.status, 404);

  const wrongMethod = await ops(req('/api/pretech/signoffs', { token, method: 'DELETE' }), env(db));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET, POST');
});
