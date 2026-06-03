/**
 * registrations.js — Event registration list fetcher for raceTracker
 * Call initRegistrations() on the registrations page.
 */

const REG_CACHE_KEY = 'raceTracker.registrations.cache';

export function initRegistrations() {
  const page = document.querySelector('[data-registrations-page]');
  if (!page) return;
  loadAndRenderEvents();
}

async function loadAndRenderEvents() {
  const eventsEl = document.querySelector('[data-reg-events]');
  if (!eventsEl) return;

  let scheduleData;
  try {
    const res = await fetch('/assets/data/event-schedule.json', { cache: 'no-store' });
    scheduleData = await res.json();
  } catch {
    eventsEl.innerHTML = '<p class="reg-error">Could not load event schedule.</p>';
    return;
  }

  const events = (scheduleData.events || []).filter(e => e.registrationProvider && e.registrationProvider !== 'manual-placeholder');

  if (!events.length) {
    eventsEl.innerHTML = `
      <div class="reg-empty">
        <p>No events with registration sources configured yet.</p>
        <p>Add events with a <code>registrationProvider</code> and <code>motorsportregEventId</code> or <code>raceSelectUrl</code> to <code>/assets/data/event-schedule.json</code>.</p>
      </div>`;
    return;
  }

  eventsEl.innerHTML = events.map(ev => renderEventCard(ev)).join('');

  // Wire up pull buttons
  eventsEl.querySelectorAll('[data-pull-entries]').forEach(btn => {
    btn.addEventListener('click', () => {
      const eventId = btn.getAttribute('data-pull-entries');
      const event   = events.find(e => e.id === eventId);
      if (event) pullEntries(event);
    });
  });
}

function renderEventCard(event) {
  const cached = getCached(event.id);
  const hasCached = cached && cached.entries;
  return `
    <div class="reg-event-card" data-event-card="${escHtml(event.id)}">
      <div class="reg-event-header">
        <div>
          <div class="reg-event-name">${escHtml(event.name)}</div>
          <div class="reg-event-meta">${escHtml(event.date || 'Date TBD')} · ${escHtml(event.track || event.trackId || '')} · <span class="reg-provider-badge">${escHtml(event.registrationProvider)}</span></div>
          ${event.class ? `<div class="reg-event-class">Class: <strong>${escHtml(event.class)}</strong></div>` : ''}
        </div>
        <div class="reg-event-actions">
          <button class="timer-btn" data-pull-entries="${escHtml(event.id)}">
            ${hasCached ? '↻ Refresh' : '⬇ Pull Entries'}
          </button>
          ${event.registrationUrl ? `<a href="${escHtml(event.registrationUrl)}" target="_blank" rel="noopener" class="reg-source-link">View Source ↗</a>` : ''}
        </div>
      </div>
      <div class="reg-entries-container" data-entries-for="${escHtml(event.id)}">
        ${hasCached ? renderEntriesTable(cached) : '<p class="reg-hint">Click "Pull Entries" to fetch the registration list.</p>'}
      </div>
    </div>
  `;
}

async function pullEntries(event) {
  const container = document.querySelector(`[data-entries-for="${escHtml(event.id)}"]`);
  const btn       = document.querySelector(`[data-pull-entries="${escHtml(event.id)}"]`);
  if (!container) return;

  container.innerHTML = '<p class="reg-loading">Fetching registration list…</p>';
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

  try {
    let apiUrl;
    const p = event.registrationProvider;
    if (p === 'motorsportreg' && event.motorsportregEventId) {
      apiUrl = `/api/registrations?source=motorsportreg&eventId=${encodeURIComponent(event.motorsportregEventId)}`;
    } else if (p === 'raceselect' && event.raceSelectUrl) {
      apiUrl = `/api/registrations?source=raceselect&eventUrl=${encodeURIComponent(event.raceSelectUrl)}`;
    } else if (p === 'mylaps' && event.mylapsEventId) {
      apiUrl = `/api/registrations?source=mylaps&eventId=${encodeURIComponent(event.mylapsEventId)}`;
    } else if (p === 'raceentry' && event.raceEntryUrl) {
      apiUrl = `/api/registrations?source=raceentry&eventUrl=${encodeURIComponent(event.raceEntryUrl)}`;
    } else if (p === 'racemonitor' && event.raceMonitorEventId) {
      apiUrl = `/api/registrations?source=racemonitor&eventId=${encodeURIComponent(event.raceMonitorEventId)}`;
    } else if (p === 'google-sheets' && event.googleSheetsCsvUrl) {
      apiUrl = `/api/registrations?source=google-sheets&eventUrl=${encodeURIComponent(event.googleSheetsCsvUrl)}`;
    } else if (p === 'generic-html' && event.registrationUrl) {
      apiUrl = `/api/registrations?source=generic-html&eventUrl=${encodeURIComponent(event.registrationUrl)}`;
    } else if (p === 'motorsport-australia' && event.motorsportAuEventId) {
      apiUrl = `/api/registrations?source=motorsport-australia&eventId=${encodeURIComponent(event.motorsportAuEventId)}`;
    } else {
      const fieldMap = {
        'motorsportreg': 'motorsportregEventId', 'raceselect': 'raceSelectUrl',
        'mylaps': 'mylapsEventId', 'raceentry': 'raceEntryUrl',
        'racemonitor': 'raceMonitorEventId', 'google-sheets': 'googleSheetsCsvUrl',
        'generic-html': 'registrationUrl', 'motorsport-australia': 'motorsportAuEventId'
      };
      const field = fieldMap[p] || 'source ID or URL field';
      container.innerHTML = `<p class="reg-error">No pull source configured. Add <code>${escHtml(field)}</code> to this event in event-schedule.json.</p>`;
      if (btn) { btn.disabled = false; btn.textContent = '⬇ Pull Entries'; }
      return;
    }

    const res  = await fetch(apiUrl);
    const data = await res.json();

    if (!data.ok) {
      if (data.authRequired) {
        container.innerHTML = `
          <div class="reg-auth-needed">
            <p><strong>API key required.</strong> ${escHtml(data.error)}</p>
            <code>${escHtml(data.hint || '')}</code>
          </div>`;
      } else {
        container.innerHTML = `<p class="reg-error">Error: ${escHtml(data.error || 'Unknown error')}</p>`;
      }
    } else {
      cacheEntries(event.id, data);
      container.innerHTML = renderEntriesTable(data);
    }
  } catch (err) {
    container.innerHTML = `<p class="reg-error">Fetch failed: ${escHtml(err.message)}</p>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

function renderEntriesTable(data) {
  if (!data.entries || !data.entries.length) {
    return `<p class="reg-hint">No entries found. ${data.note ? escHtml(data.note) : ''}</p>`;
  }

  const fetched = data.fetchedAt ? `<span class="reg-fetched-at">Fetched ${new Date(data.fetchedAt).toLocaleString()} · ${data.count} entries</span>` : '';

  // Group by class
  const byClass = {};
  data.entries.forEach(e => {
    const cls = e.class || 'Unknown Class';
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(e);
  });

  const classKeys = Object.keys(byClass).sort();

  return `
    <div class="reg-meta-bar">
      ${fetched}
      <input type="search" class="reg-search" placeholder="Search driver…" oninput="filterEntries(this)">
    </div>
    ${classKeys.map(cls => `
      <div class="reg-class-group">
        <div class="reg-class-label">${escHtml(cls)} <span class="reg-class-count">${byClass[cls].length}</span></div>
        <table class="table reg-table">
          <thead><tr><th>#</th><th>Driver</th><th>Team / Org</th><th>Paid</th></tr></thead>
          <tbody>
            ${byClass[cls].map(e => `
              <tr class="reg-entry-row">
                <td><strong>${escHtml(e.number || '—')}</strong></td>
                <td>${escHtml(e.firstName)} ${escHtml(e.lastName)}</td>
                <td>${escHtml(e.team || '—')}</td>
                <td>${e.paid ? '<span class="badge ok">✓</span>' : '<span class="badge warn">—</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `).join('')}
  `;
}

// ── Cache ──────────────────────────────────────────────────────

function cacheEntries(eventId, data) {
  try {
    const cache = JSON.parse(localStorage.getItem(REG_CACHE_KEY) || '{}');
    cache[eventId] = data;
    localStorage.setItem(REG_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getCached(eventId) {
  try {
    const cache = JSON.parse(localStorage.getItem(REG_CACHE_KEY) || '{}');
    return cache[eventId] || null;
  } catch { return null; }
}

// ── Search ────────────────────────────────────────────────────

window.filterEntries = function(input) {
  const q = input.value.toLowerCase();
  const table = input.closest('.reg-entries-container') || document;
  table.querySelectorAll('.reg-entry-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

// ── Util ──────────────────────────────────────────────────────

function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
