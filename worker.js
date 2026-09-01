/**
 * raceTracker Worker — v1.15.0
 * GET /api/registrations?source=X&...  Registration entry list proxy
 *   sources: motorsportreg, raceselect, mylaps, raceentry, racemonitor,
 *            google-sheets, generic-html, motorsport-australia
 * Secrets (wrangler secret put <NAME>):
 *   MOTORSPORTREG_APIKEY, MYLAPS_APIKEY, MOTORSPORT_AU_APIKEY
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
    if (source === 'motorsportreg')       return await fetchMotorsportReg(eventId, env);
    if (source === 'raceselect')          return await fetchRaceSelect(eventUrl || eventId, env);
    if (source === 'mylaps')              return await fetchMyLaps(eventId, env);
    if (source === 'raceentry')           return await fetchRaceEntry(eventUrl || eventId, env);
    if (source === 'racemonitor')         return await fetchRaceMonitor(eventId, env);
    if (source === 'google-sheets')       return await fetchGoogleSheets(eventUrl, env);
    if (source === 'generic-html')        return await fetchGenericHtml(eventUrl, env);
    if (source === 'motorsport-australia') return await fetchMotorsportAustralia(eventId, env);
    return json({ ok: false, error: `Unknown source: ${source}. Supported: motorsportreg, raceselect, mylaps, raceentry, racemonitor, google-sheets, generic-html, motorsport-australia` }, 400);
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
}

async function fetchMotorsportReg(eventId, env) {
  if (!eventId) return json({ ok: false, error: 'Missing eventId for MotorsportReg' }, 400);

  // Per api.motorsportreg.com's own REST docs, the unauthenticated public
  // entry list lives at /rest/events/{event_id}/entrylist (".json" suffix
  // for JSON instead of the default XML) — NOT "/entries.json", which
  // doesn't exist on their API and previously made every call 404 no
  // matter the ID. {event_id} is MotorsportReg's internal numeric event
  // ID — it is NOT the number in the public event URL slug; that slug ID
  // reliably returns {"error":"Invalid ID"} against this endpoint. The
  // internal ID isn't exposed anywhere on the public event page either; it
  // has to come from MotorsportReg's own org calendar/dashboard or from
  // asking MotorsportReg support for the event's REST ID directly.
  const apiUrl = `https://api.motorsportreg.com/rest/events/${eventId}/entrylist.json`;
  const headers = { 'User-Agent': 'raceTracker/1.9.0', Accept: 'application/json' };
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
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'Invalid ID') {
      return json({
        ok: false, eventId,
        error: `"${eventId}" isn't a valid MotorsportReg REST event ID.`,
        hint: 'MotorsportReg\'s REST event_id is an internal ID, not the number in the public event URL. Confirm the real event_id with MotorsportReg or the event organizer before retrying.'
      }, 400);
    }
    return json({ ok: false, error: `MotorsportReg HTTP 400: ${body.error || 'bad request'}`, eventId }, 400);
  }
  if (!res.ok) return json({ ok: false, error: `MotorsportReg HTTP ${res.status}`, eventId }, 502);

  const data = await res.json();
  const entries = parseMotorsportRegEntries(data);
  return json({ ok: true, source: 'motorsportreg', eventId, fetchedAt: new Date().toISOString(), count: entries.length, entries });
}

function parseMotorsportRegEntries(data) {
  // Response shape for a successful /entrylist.json call isn't documented
  // beyond "same data as the public entry list" and hasn't been verified
  // against a real event yet (no confirmed working event_id as of this
  // writing) — kept flexible across the same key variants the old
  // /entries.json code expected, plus an entrylist-named variant, so a
  // real successful response doesn't silently fall through empty.
  const raw = data.response?.entrylist?.entry || data.entrylist?.entry
    || data.response?.entries?.entry || data.entries?.entry || data.entries || [];
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

  // Must be a specific event's entries page (…/{event-slug}/EventEntries),
  // not a series season-index page (…/{series}/{year}) — the season index
  // only lists rounds with links to each one's own EventEntries page and
  // has no entry data itself, which previously made this silently return
  // zero entries against a season URL instead of a real per-event one.
  const url = eventUrl.startsWith('http') ? eventUrl : `https://raceselect.com/${eventUrl}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'raceTracker/1.9.0' } });
  if (!res.ok) return json({ ok: false, error: `RaceSelect HTTP ${res.status}` }, 502);

  const html  = await res.text();
  const entries = parseRaceSelectHtml(html);
  return json({
    ok: true, source: 'raceselect', eventUrl: url,
    fetchedAt: new Date().toISOString(), count: entries.length, entries,
    note: entries.length === 0 ? 'No structured entry data found — confirm this is a specific event\'s /EventEntries page, not a series season-index page.' : undefined
  });
}

function parseRaceSelectHtml(html) {
  // RaceSelect's current EventEntries page server-renders each driver as
  // <div class="entries-row" data-driver-name="…" data-class-name="…">
  // with the kart/vehicle number in a nested span (title="Event number")
  // — there is no <table> markup on this page at all, which is why the
  // previous table-cell scraper always returned zero entries against it.
  // Verified against a real live event page (206/206 entries parsed
  // correctly, matching the page's own reported vehicle count).
  const entries = [];
  const parts = html.split('<div class="entries-row');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const tagEnd = chunk.indexOf('>');
    if (tagEnd === -1) continue;
    const openTag = chunk.slice(0, tagEnd);
    const nameM = openTag.match(/data-driver-name="([^"]*)"/);
    if (!nameM) continue;
    const classM = openTag.match(/data-class-name="([^"]*)"/);
    const body = chunk.slice(tagEnd, tagEnd + 1500);
    const numM = body.match(/title="Event number"[^>]*>\s*(\d+)/);
    const nameParts = decodeHtmlEntities(nameM[1]).trim().split(/\s+/);
    entries.push({
      firstName: nameParts[0] || '',
      lastName:  nameParts.slice(1).join(' ') || '',
      number:    numM ? numM[1] : '',
      class:     classM ? decodeHtmlEntities(classM[1]) : '',
      team:      '',
      paid:      true
    });
  }
  if (entries.length) return entries;

  // Fallback for older/other RaceSelect-family pages still using plain
  // HTML tables, kept for resilience across providers/events not verified
  // against the current div-based markup.
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

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&apos;', "'");
}

// ── MyLaps ───────────────────────────────────────────────────────

async function fetchMyLaps(eventId, env) {
  if (!eventId) return json({ ok: false, error: 'Missing eventId for MyLaps' }, 400);
  const apiKey = env.MYLAPS_APIKEY;
  if (!apiKey) return json({
    ok: false, authRequired: true,
    error: 'MyLaps requires an API key.',
    hint: 'wrangler secret put MYLAPS_APIKEY',
    docs: 'https://www.mylaps.com/en/technology/sdk-api',
    eventId
  }, 401);
  try {
    const res = await fetch(`https://api.mylaps.com/api/v1/events/${encodeURIComponent(eventId)}/participants`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json', 'User-Agent': 'raceTracker/1.9.0' }
    });
    if (res.status === 401 || res.status === 403) return json({ ok: false, authRequired: true, error: 'MyLaps API key rejected.', hint: 'Verify MYLAPS_APIKEY via wrangler secrets list', eventId }, 401);
    if (!res.ok) return json({ ok: false, error: `MyLaps HTTP ${res.status}`, eventId }, 502);
    const data = await res.json();
    const raw = data.participants || data.entries || data.data || [];
    const entries = (Array.isArray(raw) ? raw : []).map(e => ({
      firstName: e.firstName || e.first_name || e.firstname || '',
      lastName:  e.lastName  || e.last_name  || e.lastname  || '',
      number:    e.transponder || e.number || e.bibNumber || '',
      class:     e.category || e.class || e.group || '',
      team:      e.club || e.team || '',
      paid:      true
    }));
    return json({ ok: true, source: 'mylaps', eventId, fetchedAt: new Date().toISOString(), count: entries.length, entries });
  } catch (err) {
    return json({ ok: false, error: `MyLaps: ${err.message}`, eventId }, 502);
  }
}

// ── RaceEntry ────────────────────────────────────────────────────

async function fetchRaceEntry(eventUrl, env) {
  if (!eventUrl) return json({ ok: false, error: 'Missing eventUrl for RaceEntry' }, 400);
  const url = eventUrl.startsWith('http') ? eventUrl : `https://raceentry.com/races/${eventUrl}/participants`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'raceTracker/1.9.0' } });
    if (!res.ok) return json({ ok: false, error: `RaceEntry HTTP ${res.status}`, eventUrl: url }, 502);
    const html = await res.text();
    const entries = parseRaceEntryHtml(html) || parseGenericTableHtml(html);
    return json({
      ok: true, source: 'raceentry', eventUrl: url,
      fetchedAt: new Date().toISOString(), count: entries.length, entries,
      note: entries.length === 0 ? 'No entry data parsed — try the full event URL including /participants.' : undefined
    });
  } catch (err) {
    return json({ ok: false, error: `RaceEntry: ${err.message}`, eventUrl: url }, 502);
  }
}

function parseRaceEntryHtml(html) {
  const entries = [];
  const rowRx  = /<tr[^>]*class="[^"]*registrant[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let rowM;
  while ((rowM = rowRx.exec(html)) !== null) {
    const cells = [];
    let cellM;
    while ((cellM = cellRx.exec(rowM[1])) !== null) {
      cells.push(cellM[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 1 && cells[0]) {
      const name = cells[0].split(/\s+/);
      entries.push({ firstName: name[0] || '', lastName: name.slice(1).join(' ') || '', number: cells[1] || '', class: cells[2] || '', team: cells[3] || '', paid: true });
    }
  }
  return entries;
}

// ── RaceMonitor ──────────────────────────────────────────────────

async function fetchRaceMonitor(eventId, env) {
  if (!eventId) return json({ ok: false, error: 'Missing eventId for RaceMonitor' }, 400);
  try {
    const res = await fetch(`https://www.racemonitor.com/v2/private/Competitor/?raceId=${encodeURIComponent(eventId)}&format=json`, {
      headers: { 'User-Agent': 'raceTracker/1.9.0', 'Accept': 'application/json' }
    });
    if (!res.ok) return json({ ok: false, error: `RaceMonitor HTTP ${res.status}`, eventId, hint: 'Confirm the event ID from the racemonitor.com event URL.' }, 502);
    const data = await res.json();
    const raw = data.Competitor || data.competitors || data.entries || [];
    const entries = (Array.isArray(raw) ? raw : []).map(e => ({
      firstName: e.FirstName  || e.first_name || '',
      lastName:  e.LastName   || e.last_name  || '',
      number:    e.Number     || e.number     || '',
      class:     e.ClassDescription || e.class || '',
      team:      e.Team || e.team || '',
      paid:      true
    }));
    return json({ ok: true, source: 'racemonitor', eventId, fetchedAt: new Date().toISOString(), count: entries.length, entries });
  } catch (err) {
    return json({ ok: false, error: `RaceMonitor: ${err.message}`, eventId }, 502);
  }
}

// ── Google Sheets CSV ─────────────────────────────────────────────

async function fetchGoogleSheets(csvUrl, env) {
  if (!csvUrl) return json({
    ok: false,
    error: 'Missing csvUrl. Use a published CSV: Sheet → File → Share → Publish to web → CSV → copy URL.',
    hint: 'Pass as: /api/registrations?source=google-sheets&eventUrl=<CSV_URL>'
  }, 400);
  try {
    const res = await fetch(csvUrl, { headers: { 'User-Agent': 'raceTracker/1.9.0' } });
    if (!res.ok) return json({ ok: false, error: `Google Sheets HTTP ${res.status}`, csvUrl }, 502);
    const csv = await res.text();
    const entries = parseCsv(csv);
    return json({ ok: true, source: 'google-sheets', csvUrl, fetchedAt: new Date().toISOString(), count: entries.length, entries });
  } catch (err) {
    return json({ ok: false, error: `Google Sheets: ${err.message}`, csvUrl }, 502);
  }
}

function parseCsv(text) {
  const rows = text.trim().split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  if (rows.length < 2) return [];
  const hdrs = rows[0].map(h => h.toLowerCase().trim());
  const get = (r, ...keys) => { for (const k of keys) { const i = hdrs.indexOf(k); if (i >= 0 && r[i]) return r[i]; } return ''; };
  return rows.slice(1).filter(r => r.some(c => c)).map(r => ({
    firstName: get(r, 'first name', 'firstname', 'first'),
    lastName:  get(r, 'last name',  'lastname',  'last'),
    number:    get(r, 'kart', 'kart #', 'number', '#', 'no'),
    class:     get(r, 'class', 'category', 'division'),
    team:      get(r, 'team', 'org', 'organization', 'club'),
    paid:      get(r, 'paid', 'payment', 'status').toLowerCase().includes('paid')
  }));
}

// ── Generic HTML scrape ───────────────────────────────────────────

async function fetchGenericHtml(url, env) {
  if (!url) return json({ ok: false, error: 'Missing url for generic HTML scrape' }, 400);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'raceTracker/1.9.0' } });
    if (!res.ok) return json({ ok: false, error: `HTTP ${res.status}`, url }, 502);
    const html = await res.text();
    const entries = parseGenericTableHtml(html);
    return json({
      ok: true, source: 'generic-html', url,
      fetchedAt: new Date().toISOString(), count: entries.length, entries,
      note: entries.length === 0 ? 'No table data parsed. The page may use JavaScript rendering or a non-standard layout.' : undefined
    });
  } catch (err) {
    return json({ ok: false, error: `Generic HTML: ${err.message}`, url }, 502);
  }
}

function parseGenericTableHtml(html) {
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

// ── Motorsport Australia (placeholder) ───────────────────────────

async function fetchMotorsportAustralia(eventId, env) {
  const apiKey = env.MOTORSPORT_AU_APIKEY;
  if (!apiKey) return json({
    ok: false, authRequired: true,
    error: 'Motorsport Australia requires org API credentials.',
    hint: 'wrangler secret put MOTORSPORT_AU_APIKEY',
    docs: 'https://www.motorsport.org.au/technology',
    placeholder: true,
    eventId
  }, 401);
  return json({
    ok: false, error: 'Motorsport Australia API endpoint not yet mapped. Provide the event URL or API endpoint once confirmed.',
    hint: 'Contact Motorsport Australia for event entry list API documentation.',
    eventId
  }, 501);
}

// ── Helpers ─────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
  });
}
