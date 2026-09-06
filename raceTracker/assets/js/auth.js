// raceTracker auth — Cloudflare Access identity, no client-side auth library.
//
// Cloudflare Access sits in front of tracker.absolutelyplausible.com as a
// self-hosted application. By the time any page in this app renders, Access has
// already authenticated the visitor and set its session cookie; there is no
// login form here, no token in JavaScript, and nothing in localStorage. The
// browser's only job is to ask the Worker who it is: GET /api/me verifies the
// Access assertion server-side and returns the matching profiles row.
//
// Two separate steps grant access, deliberately:
//   1. the email on the Access policy  — lets you into the app at all
//   2. a row in the profiles table     — gives you a role inside it
// Neither alone is enough, and both are admin-side. Signing in never creates
// a profile.
//
// This replaces the Supabase magic-link login. That project (ref
// lumllkbsiuxoohdolrtm) no longer exists and never held real data.

const ME_ENDPOINT = '/api/me';

let profileRequest = null;
let cachedProfile = null;
let lastError = null;
const listeners = new Set();

function notify(event) {
  for (const listener of listeners) {
    try { listener(event, cachedProfile); } catch (err) { console.error('auth listener failed', err); }
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    // Access identity travels on its own cookie; never cache an identity reply.
    cache: 'no-store',
    credentials: 'same-origin'
  });

  let data = null;
  try { data = await response.json(); } catch { /* non-JSON error page */ }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/**
 * The signed-in profile, or null. Deduplicated: several page modules call this
 * during init and they share one in-flight request.
 */
async function currentProfile() {
  if (cachedProfile) return cachedProfile;
  if (!profileRequest) {
    profileRequest = apiFetch(ME_ENDPOINT)
      .then(data => {
        cachedProfile = data?.profile || null;
        if (cachedProfile) cachedProfile.entities = data?.entities || [];
        lastError = null;
        notify('SIGNED_IN');
        return cachedProfile;
      })
      .catch(err => {
        // 401 means no Access session (only reachable on a Bypass path);
        // 403 means authenticated but not provisioned. Both are "no profile"
        // to the caller, but the message differs and the page shows it.
        cachedProfile = null;
        lastError = err;
        return null;
      })
      .finally(() => { profileRequest = null; });
  }
  return profileRequest;
}

/** Why currentProfile() came back empty, for pages that want to say so. */
function profileError() {
  return lastError;
}

async function getSession() {
  const profile = await currentProfile();
  return profile ? { user: { id: profile.id, email: profile.email } } : null;
}

function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Access owns the logout flow — clearing its cookie is what actually ends the
 * session, so a local-only sign-out would be a lie.
 */
function signOut() {
  cachedProfile = null;
  notify('SIGNED_OUT');
  window.location.assign('/cdn-cgi/access/logout');
}

/**
 * Called once per page by main.js before anything else.
 *
 * Unlike the Supabase version this never redirects. Access has already gated
 * every page it protects, so a redirect here could only fire on a Bypass path
 * (registrations.html's open Pre-Tech form) — where it would produce a loop.
 * Returning true lets the page render; initAuthContext decides what to show
 * when there is no profile.
 */
async function requireAuth() {
  await currentProfile();
  return true;
}

window.raceTrackerAuth = {
  getSession,
  onAuthChange,
  signOut,
  currentProfile,
  profileError,
  requireAuth,
  apiFetch
};
