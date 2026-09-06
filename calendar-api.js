// Public calendar adapter. Ownership stays with the Events repo; no local copy.
export const CALENDAR_SOURCE = 'https://events.thekartdepot.com/events.json';
const MAX_BYTES = 1024 * 1024;

export function normalizeCalendar(catalog) {
  if (!catalog || !Array.isArray(catalog.events) || catalog.events.length > 1000) {
    throw new Error('Invalid calendar');
  }
  const ids = new Set();
  const required = value => typeof value === 'string' && value.trim() && value.length <= 1000;
  const dateIsValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return catalog.events.map(event => {
    if (!event || !required(event.id) || !/^[a-zA-Z0-9_-]+$/.test(event.id)
      || ids.has(event.id) || !required(event.name) || !required(event.dates)
      || !required(event.venue) || !Array.isArray(event.days) || !event.days.length
      || event.days.length > 366 || event.days.some(day => !day || !dateIsValid(day.id))) {
      throw new Error('Invalid event');
    }
    ids.add(event.id);
    const days = [...new Set(event.days.map(day => day.id))].sort();
    return {
      id: event.id, name: event.name, date: event.dates, track: event.venue,
      series: required(event.series) ? event.series : '',
      startsOn: days[0], endsOn: days.at(-1), days,
      registrationUrl: 'https://events.thekartdepot.com/',
      registrationStatus: required(event.availability) ? event.availability : 'View event',
      source: 'Emerson’s Events calendar'
    };
  }).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));
}

async function readCatalog(response) {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) {
    throw new Error('Invalid response size');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Calendar too large'); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function handleCalendar(request, fetcher = fetch) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405, headers: { ...headers, Allow: 'GET' }
    });
  }
  try {
    // Read the published public contract, not the sibling's unfinished checkout.
    // A service binding can replace transport later without changing the consumer.
    const response = await fetcher(CALENDAR_SOURCE, {
      headers: { Accept: 'application/json' }, cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Upstream unavailable');
    const events = normalizeCalendar(await readCatalog(response));
    return new Response(JSON.stringify({
      ok: true, sourceUrl: CALENDAR_SOURCE, sourceStatus: 'connected',
      fetchedAt: new Date().toISOString(), events
    }), { headers });
  } catch {
    return new Response(JSON.stringify({
      ok: false, error: 'The Events calendar is unavailable. Reconnect and try again.',
      sourceUrl: CALENDAR_SOURCE
    }), { status: 503, headers });
  }
}
