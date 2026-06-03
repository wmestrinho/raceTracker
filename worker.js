/**
 * raceTracker Worker
 * - Serves static assets from raceTracker/ directory
 * - GET /api/registrations?source=motorsportreg&eventId=X  → proxies MotorsportReg entries
 * - GET /api/registrations?source=raceselect&eventUrl=X    → fetches + parses RaceSelect page
 * - GET /api/weather?lat=X&lon=X&tz=X                      → proxies Open-Meteo (avoids CORS)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(url, env);
    return env.ASSETS.fetch(request);
  }
};

// ── API router ──────────────────────────────────────────────────

async function handleApi(url, env) {
  if (url.pathname === '/api/registrations') return handleRegistrations(url, env);
  return json({ error: 'Unknown API endpoint' }, 404);
}

// ── Registrations ───────────────────────────────────────────────

async function handleRegistrations(url, env) {
  const source   = url.searchParams.get('source');
  const eventId  = url.searchParams.get('eventId');
  const eventUrl = url.searchParams.get('eventUrl');

  if (!source) return json({ ok: false, error: 'Missing source parameter' }, 400);

  try {
    if (source === 'motorsportreg') return await fetchMotorsportReg(eventId, env);
    if (source === 'raceselect')    return await fetchRaceSelect(eventUrl || eventId, env);
    return json({ ok: false, error: `Unknown source: ${source}` }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}

async function fetchMotorsportReg(eventId, env) {
  if (!eventId) return json({ ok: false, error: 'Missing eventId for MotorsportReg' }, 400);

  const apiUrl = `https://api.motorsportreg.com/rest/events/${eventId}/entries.json`;
  const headers = { 'User-Agent': 'raceTracker/1.8.0', Accept: 'application/json' };
  if (env.MOTORSPORTREG_APIKEY) headers['X-APIKEY'] = env.MOTORSPORTREG_APIKEY;

  const res = await fetch(apiUrl, { headers });

  if (res.status === 401 || res.status === 403) {
    return json({
      ok: false, error: 'MotorsportReg requires an org API key.',
      authRequired: true,
      hint: 'Run: wrangler secret put MOTORSPORTREG_APIKEY',
      eventId
    }, 401);
  }
  if (!res.ok) return json({ ok: false, error: `MotorsportReg HTTP ${res.status}`, eventId }, 502);

  const data = await res.json();
  const entries = parseMotorsportRegEntries(data);
  return json({ ok: true, source: 'motorsportreg', eventId, fetchedAt: new Date().toISOString(), count: entries.length, entries });
}

function parseMotorsportRegEntries(data) {
  const raw = data.response?.entries?.entry || data.entries?.entry || data.entries || [];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.filter(Boolean).map(e => ({
    firstName: e.firstname  || e.first_name  || e.firstName  || '',
    lastName:  e.lastname   || e.last_name   || e.lastName   || '',
    number:    e.number     || e.cartNumber  || e.kart_number || '',
    class:     e.classname  || e.class       || e.category   || '',
    team:      e.team       || e.organization || '',
    paid:      e.paid === true || e.paid === 'true' || e.payment_status === 'paid',
  }));
}

async function fetchRaceSelect(eventUrl, env) {
  if (!eventUrl) return json({ ok: false, error: 'Missing eventUrl for RaceSelect' }, 400);

  const url = eventUrl.startsWith('http') ? eventUrl : `https://raceselect.com/${eventUrl}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'raceTracker/1.8.0' } });
  if (!res.ok) return json({ ok: false, error: `RaceSelect HTTP ${res.status}` }, 502);

  const html  = await res.text();
  const entries = parseRaceSelectHtml(html);
  return json({
    ok: true, source: 'raceselect', eventUrl: url,
    fetchedAt: new Date().toISOString(), count: entries.length, entries,
    note: entries.length === 0 ? 'No structured entry data found — page may require manual review or a different URL.' : undefined
  });
}

function parseRaceSelectHtml(html) {
  const entries = [];
  const rowRx  = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let rowM;
  while ((rowM = rowRx.exec(html)) !== null) {
    const cells = [];
    let cellM;
    while ((cellM = cellRx.exec(rowM[1])) !== null) {
      cells.push(cellM[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 2 && cells.some(c => c.length > 1)) {
      entries.push({ firstName: cells[0] || '', lastName: cells[1] || '', number: cells[2] || '', class: cells[3] || '', team: cells[4] || '', paid: false });
    }
  }
  return entries.filter(e => e.firstName || e.number);
}

// ── Helpers ─────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
  });
}
