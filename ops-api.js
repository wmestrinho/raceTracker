// raceTracker operational API — Cloudflare Access identity over D1.
//
// Every handler here runs behind verifyAccessJwt(). Authorization that used to
// be Postgres RLS is now explicit in this file, and the rules are the same
// ones the Supabase policies described:
//
//   * A caller only ever acts as themselves. `profile_id` on a write is taken
//     from the verified token, never from the request body.
//   * A caller only reads records for a business they are granted in
//     `profile_entities`. Seniority in the business does not imply a grant.
//   * Sign-off history is admin-only, with one deliberate exception: any
//     signed-in staff member can see *today's* sign-offs for their own
//     business, because that is what makes the workshop crew table useful.
//
// A failed write returns a non-2xx and no record. Nothing here reports success
// it did not achieve, and nothing queues a write for later.

import { verifyAccessJwt, AccessError } from './access-jwt.js';

const CLEARANCE_RANK = { parent: 0, driver: 1, staff: 2, admin: 3 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 2000;
const PAGE_SIZE = 50;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function fail(error, status) {
  return json({ ok: false, error }, status);
}

function isDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function text(value, { max = MAX_TEXT } = {}) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Verify the token, then resolve it to a staff profile.
 *
 * A valid token with no matching profiles row is 403, not 500 and not 401:
 * the person proved who they are, they just have not been provisioned. Telling
 * them that plainly is what stops the "log in, bounce, log in" loop.
 */
async function requireProfile(request, env) {
  const identity = await verifyAccessJwt(request, env);
  if (!env.OPS_DB) throw new AccessError('The operations database is not bound to this deployment', 503);

  const profile = await env.OPS_DB
    .prepare('SELECT id, email, name, role, clearance, active FROM profiles WHERE email = ? COLLATE NOCASE')
    .bind(identity.email)
    .first();

  if (!profile) {
    throw new AccessError(`No raceTracker profile exists for ${identity.email}. Ask an admin to add you.`, 403);
  }
  if (!profile.active) {
    throw new AccessError('This account has been deactivated.', 403);
  }

  const granted = await env.OPS_DB
    .prepare('SELECT entity_id FROM profile_entities WHERE profile_id = ?')
    .bind(profile.id)
    .all();

  return {
    identity,
    profile: { ...profile, active: Boolean(profile.active) },
    entities: (granted.results || []).map(row => row.entity_id)
  };
}

function atLeast(profile, clearance) {
  return (CLEARANCE_RANK[profile.clearance] ?? 0) >= (CLEARANCE_RANK[clearance] ?? 0);
}

/** Resolve the entity a request is acting in, refusing anything not granted. */
function scopeEntity(session, requested) {
  if (!requested) {
    if (!session.entities.length) throw new AccessError('This account is not assigned to a business.', 403);
    return session.entities;
  }
  if (!session.entities.includes(requested)) {
    throw new AccessError('This account is not assigned to that business.', 403);
  }
  return [requested];
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function logActivity(env, session, { entityId, action, recordType, recordId, detail }) {
  // Best-effort: an audit write must never be the reason a real save fails.
  try {
    await env.OPS_DB.prepare(
      `INSERT INTO activity_log (id, actor_profile_id, actor_email, entity_id, action, record_type, record_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), session.profile.id, session.identity.email,
      entityId || null, action, recordType, recordId || null, detail || null
    ).run();
  } catch (err) {
    console.error('activity_log write failed', err);
  }
}

// ── GET /api/me ───────────────────────────────────────────────────────────

async function handleMe(session) {
  return json({
    ok: true,
    profile: session.profile,
    entities: session.entities,
    email: session.identity.email
  });
}

// ── GET /api/profiles ─────────────────────────────────────────────────────
// The active staff roster. Readable by any signed-in staff member, matching
// what mechanics.json already exposes publicly today — and narrower, since
// this needs a session at all. Sign-off *history* stays restricted below.

async function handleProfiles(session, env) {
  if (!atLeast(session.profile, 'staff')) return fail('Staff access required', 403);
  const rows = await env.OPS_DB
    .prepare('SELECT id, name, role, clearance FROM profiles WHERE active = 1 ORDER BY name')
    .all();
  return json({ ok: true, profiles: rows.results || [] });
}

// ── GET /api/pretech/signoffs ─────────────────────────────────────────────

async function handleSignoffList(session, env, url) {
  if (!atLeast(session.profile, 'staff')) return fail('Staff access required', 403);

  const requestedEntity = url.searchParams.get('entity');
  const entityIds = scopeEntity(session, requestedEntity);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const profileId = url.searchParams.get('profile');

  if (from && !isDate(from)) return fail('Invalid from date', 400);
  if (to && !isDate(to)) return fail('Invalid to date', 400);

  const where = [`entity_id IN (${placeholders(entityIds.length)})`];
  const binds = [...entityIds];
  if (from) { where.push('signoff_date >= ?'); binds.push(from); }
  if (to) { where.push('signoff_date <= ?'); binds.push(to); }
  if (profileId) { where.push('profile_id = ?'); binds.push(profileId); }

  // The RLS rule, restated: admins see the whole range; everyone else sees
  // their own history plus today's rows for the crew table. A non-admin who
  // asks for someone else's past sign-offs gets an empty range, not an error —
  // the same shape a day with no sign-offs returns.
  if (!atLeast(session.profile, 'admin')) {
    where.push('(profile_id = ? OR signoff_date = ?)');
    binds.push(session.profile.id, new Date().toISOString().slice(0, 10));
  }

  const rows = await env.OPS_DB.prepare(
    `SELECT id, profile_id, entity_id, signoff_date, kart, notes, items, complete, signed_at
       FROM pretech_signoffs
      WHERE ${where.join(' AND ')}
      ORDER BY signoff_date DESC, signed_at DESC
      LIMIT 500`
  ).bind(...binds).all();

  return json({
    ok: true,
    signoffs: (rows.results || []).map(row => ({
      ...row,
      complete: Boolean(row.complete),
      // Parse here so the browser sees the same object shape the Supabase
      // jsonb column used to hand back. SQLite has no JSON column type.
      items: safeParseItems(row.items)
    }))
  });
}

function safeParseItems(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ── POST /api/pretech/signoffs ────────────────────────────────────────────

async function handleSignoffCreate(session, env, request) {
  if (!atLeast(session.profile, 'staff')) return fail('Staff access required', 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Invalid request body', 400);
  }

  const [entityId] = scopeEntity(session, text(body?.entity_id, { max: 80 }) || null);
  const signoffDate = isDate(body?.signoff_date) ? body.signoff_date : new Date().toISOString().slice(0, 10);

  const items = {};
  if (body?.items && typeof body.items === 'object' && !Array.isArray(body.items)) {
    for (const [key, value] of Object.entries(body.items)) {
      if (typeof key === 'string' && key.length <= 80) items[key] = Boolean(value);
    }
  }
  const values = Object.values(items);
  const complete = values.length > 0 && values.every(Boolean);

  // profile_id comes from the verified token. There is no code path by which a
  // request body can sign off on another mechanic's behalf.
  await env.OPS_DB.prepare(
    `INSERT INTO pretech_signoffs (id, profile_id, entity_id, signoff_date, kart, notes, items, complete, signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, entity_id, signoff_date) DO UPDATE SET
       kart = excluded.kart, notes = excluded.notes, items = excluded.items,
       complete = excluded.complete, signed_at = excluded.signed_at`
  ).bind(
    crypto.randomUUID(), session.profile.id, entityId, signoffDate,
    text(body?.kart, { max: 80 }) || null, text(body?.notes) || null,
    JSON.stringify(items), complete ? 1 : 0, new Date().toISOString()
  ).run();

  await logActivity(env, session, {
    entityId, action: complete ? 'signoff.complete' : 'signoff.partial',
    recordType: 'pretech_signoff', recordId: `${session.profile.id}:${signoffDate}`
  });

  return json({ ok: true, signoff_date: signoffDate, entity_id: entityId, complete });
}

// ── Router ────────────────────────────────────────────────────────────────

export async function handleOps(request, env, url) {
  let session;
  try {
    session = await requireProfile(request, env);
  } catch (err) {
    if (err instanceof AccessError) return fail(err.message, err.status);
    console.error('auth failed', err);
    return fail('Could not verify your session', 503);
  }

  try {
    // These are awaited, not just returned: an AccessError thrown inside an
    // async handler would otherwise reject after this try block has exited and
    // surface as an unhandled rejection instead of a 403.
    const { pathname } = url;
    if (pathname === '/api/me' && request.method === 'GET') return await handleMe(session);
    if (pathname === '/api/profiles' && request.method === 'GET') return await handleProfiles(session, env);
    if (pathname === '/api/pretech/signoffs') {
      if (request.method === 'GET') return await handleSignoffList(session, env, url);
      if (request.method === 'POST') return await handleSignoffCreate(session, env, request);
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, POST', 'Cache-Control': 'no-store' }
      });
    }
    return fail('Unknown API endpoint', 404);
  } catch (err) {
    if (err instanceof AccessError) return fail(err.message, err.status);
    console.error('ops request failed', err);
    return fail('That did not save. Nothing was changed — try again.', 500);
  }
}

export const OPS_ROUTES = ['/api/me', '/api/profiles', '/api/pretech/signoffs'];
export { PAGE_SIZE, CLEARANCE_RANK };
