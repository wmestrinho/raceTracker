import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../worker.js';
import { CALENDAR_SOURCE, normalizeCalendar, handleCalendar } from '../calendar-api.js';

const event = { id: 'emerson-event', name: 'Race weekend', dates: 'September 10–12, 2026', venue: 'Published venue', series: 'Published series', days: [{ id: '2026-09-12' }, { id: '2026-09-10' }] };
const request = () => new Request('https://tracker.example/api/calendar?url=https://untrusted.example');

test('preserves source identity and labels, ordering dates without guessing providers', () => {
  const [result] = normalizeCalendar({ events: [event] });
  assert.equal(result.id, event.id);
  assert.equal(result.date, event.dates);
  assert.equal(result.track, event.venue);
  assert.equal(result.startsOn, '2026-09-10');
  assert.equal(result.endsOn, '2026-09-12');
  assert.equal(result.registrationProvider, undefined);
});
test('rejects malformed feeds, duplicate IDs and invalid dates', () => {
  for (const catalog of [null, {}, {events:[event,event]}, {events:[{...event,days:[{id:'2026-02-30'}]}]}, {events:[{...event,days:[]}]}, {events:[{...event,venue:null}]}]) assert.throws(() => normalizeCalendar(catalog));
  assert.deepEqual(normalizeCalendar({events:[]}), []);
});
test('fetches only the canonical URL and excludes catalog pricing and contacts', async () => {
  const response = await handleCalendar(request(), async (url, options) => {
    assert.equal(url, CALENDAR_SOURCE);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return Response.json({events:[event], contacts:['excluded'], serviceCatalog:{price:12}});
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.events.length, 1);
  assert.ok(data.fetchedAt);
  assert.equal(data.contacts, undefined);
  assert.equal(data.serviceCatalog, undefined);
});
test('timeouts, upstream errors, malformed JSON and oversized bodies fail without fallback', async () => {
  for (const fetcher of [async () => {throw new Error('Timeout');}, async () => new Response('',{status:503}), async () => new Response('invalid json'), async () => new Response('x'.repeat(1024*1024+1)), async () => new Response('{}',{headers:{'content-length':String(1024*1024+1)}})]) {
    const response = await handleCalendar(request(), fetcher);
    assert.equal(response.status,503);
    assert.equal((await response.json()).events,undefined);
  }
});
test('calendar writes are refused and static routing is preserved', async () => {
  const response = await worker.fetch(new Request('https://tracker.example/api/calendar',{method:'POST'}),{});
  assert.equal(response.status,405);
  assert.equal(response.headers.get('allow'),'GET');
  const asset = await worker.fetch(new Request('https://tracker.example/schedule.html'),{ASSETS:{fetch:()=>new Response('asset')}});
  assert.equal(await asset.text(),'asset');
});
test('browser deduplicates requests, marks stale data and reconnects without storage', async () => {
  const source = await readFile(new URL('../raceTracker/assets/js/calendar.js',import.meta.url),'utf8');
  const callbacks = {};
  let calls=0, complete, latest;
  const navigator={onLine:true};
  const context={navigator, document:{hidden:false,addEventListener(){}},window:{addEventListener:(name,cb)=>{callbacks[name]=cb;}},setInterval:()=>1,clearInterval(){},AbortSignal,Date,Intl,
    fetch:()=>{calls++;return new Promise(resolve=>{complete=resolve;});}};
  vm.runInNewContext(source,context);
  const calendar=context.window.raceTrackerCalendar;
  calendar.subscribe(state=>{latest=state;});
  const first=calendar.refresh();
  assert.equal(calls,1);
  complete(Response.json({ok:true,events:normalizeCalendar({events:[event]}),fetchedAt:'2026-09-05T12:00:00Z'}));
  await first;
  assert.equal(latest.status,'connected');
  navigator.onLine=false;
  callbacks.offline();
  await calendar.refresh();
  assert.equal(calls,1);
  assert.equal(latest.status,'offline');
  assert.match(calendar.statusText(latest),/may have changed/);
  assert.equal(latest.events.length,1);
  navigator.onLine=true;
  callbacks.online();
  const retry=calendar.refresh();
  assert.equal(calls,2);
  complete(new Response('',{status:503}));
  await retry;
  assert.equal(latest.status,'unavailable');
  const recover=calendar.refresh();
  complete(Response.json({ok:true,events:[],fetchedAt:'2026-09-05T12:01:00Z'}));
  await recover;
  assert.equal(latest.status,'connected');
  assert.equal(latest.events.length,0);
});
