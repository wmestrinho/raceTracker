// raceTracker auth — Supabase magic-link login.
//
// SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are the public half of Supabase's
// auth model (same trust boundary as a Stripe publishable key) — they are meant
// to ship in client-side code. Enforcement lives entirely in Postgres Row Level
// Security (see supabase/schema.sql), not in hiding these two values. The real
// secrets (SUPABASE_DB_PASSWORD, SUPABASE_DB_DIRECT_URL, and any future
// service_role key) never appear here or anywhere in raceTracker/.
const SUPABASE_URL = 'https://lumllkbsiuxoohdolrtm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3ySmRfk7FwdTmRBZ7V8b2A_cYlXXkJk';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let cachedProfile = null;

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') cachedProfile = null;
});

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session;
}

function onAuthChange(cb) {
  supabaseClient.auth.onAuthStateChange((event, session) => cb(event, session));
}

async function requestMagicLink(email) {
  return supabaseClient.auth.signInWithOtp({
    email,
    options: {
      // shouldCreateUser:false is the actual allowlist enforcement — Supabase
      // refuses the request unless an auth.users row already exists for this
      // email (created by hand in Supabase Studio). No custom callback route:
      // login.html is both where the link is requested and where it lands.
      emailRedirectTo: window.location.origin + '/login.html',
      shouldCreateUser: false
    }
  });
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.replace('/login.html');
}

async function currentProfile() {
  if (cachedProfile) return cachedProfile;
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', session.user.id).single();
  if (error || !data) return null;
  cachedProfile = data;
  return cachedProfile;
}

// Call once per page (main.js does this before any other init). Redirects to
// login unless a session exists, the page is login.html itself, or the page
// opts out via <body data-auth-required="false"> (registrations.html, so the
// driver-facing Pre-Tech form stays open with no login).
async function requireAuth() {
  const path = window.location.pathname;
  if (path.endsWith('/login.html') || path === '/login') return true;
  if (document.body.getAttribute('data-auth-required') === 'false') return true;

  const session = await getSession();
  if (!session) {
    window.location.replace('/login.html?next=' + encodeURIComponent(path));
    return false;
  }
  return true;
}

window.raceTrackerAuth = {
  supabaseClient,
  getSession,
  onAuthChange,
  requestMagicLink,
  signOut,
  currentProfile,
  requireAuth
};
