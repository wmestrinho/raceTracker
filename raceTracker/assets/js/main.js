document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initActiveNav();
  initMechanicContext();
  initTelemetryUpdates();
  initWeatherContext();
  initAddTaskForm();
  initSetupSheet();
  initTeamRoster();
  initBillingModule();
  initSeriesCalendars();
});

function initSidebarToggle() {
  const btn = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.sidebar');
  if (!btn || !sidebar) return;

  const setOpen = (isOpen) => {
    sidebar.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
  };

  btn.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('open'));
  });

  sidebar.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 980) return;
    if (!sidebar.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
}

function initActiveNav() {
  const bodyPage = document.body.getAttribute('data-page');
  if (!bodyPage) return;
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    if (link.getAttribute('data-page') === bodyPage) link.classList.add('active');
  });
}

async function initMechanicContext() {
  const storageKey = 'raceTracker.mechanicProfile';
  const mechanicData = await loadMechanicData();
  const mechanics = mechanicData.mechanics.map(mechanic => mechanic.name);
  const tasks = mechanicData.tasks;
  const slots = document.querySelectorAll('[data-mechanic-slot]');
  renderWorkshopTasks(tasks);
  if (!slots.length) {
    updateMechanicOwnedTasks(localStorage.getItem(storageKey) || mechanics[0]);
    return;
  }

  const getSelected = () => {
    const saved = localStorage.getItem(storageKey);
    return mechanics.includes(saved) ? saved : mechanics[0];
  };
  const saveSelected = (name) => {
    localStorage.setItem(storageKey, name);
    renderMechanicSlots(name);
    updateMechanicOwnedTasks(name);
    const person = mechanicData.mechanics.find(m => m.name === name);
    applyNavClearance(person ? person.clearance : 'staff');
  };

  function renderMechanicSlots(selected) {
    slots.forEach(slot => {
      slot.innerHTML = `
        <label class="mechanic-switcher">
          <span>Mechanic</span>
          <select data-mechanic-select aria-label="Select mechanic profile">
            ${mechanics.map(name => `<option value="${name}" ${name === selected ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </label>
      `;
      slot.querySelector('[data-mechanic-select]').addEventListener('change', (event) => {
        saveSelected(event.target.value);
      });
    });
  }

  const selected = getSelected();
  renderMechanicSlots(selected);
  updateMechanicOwnedTasks(selected);
  const person = mechanicData.mechanics.find(m => m.name === selected);
  applyNavClearance(person ? person.clearance : 'staff');
}

function applyNavClearance(clearance) {
  const navLinks = document.querySelectorAll('.nav-link[data-min-clearance]');
  navLinks.forEach(link => {
    const min = link.getAttribute('data-min-clearance');
    const order = { admin: 3, staff: 2, driver: 1, parent: 0 };
    const userLevel  = order[clearance] ?? 1;
    const minLevel   = order[min]       ?? 1;
    link.style.display = userLevel >= minLevel ? '' : 'none';
  });
}

async function loadMechanicData() {
  const fallback = {
    mechanics: [
      { name: 'Nuno',  role: 'Team Principal / Driver',          clearance: 'admin' },
      { name: 'Seth',  role: 'Team Owner',                       clearance: 'admin' },
      { name: 'Enzo',  role: 'Coach Mechanic / Telemetry',       clearance: 'staff' },
      { name: 'Tyler', role: 'Mechanic',                         clearance: 'staff' },
      { name: 'Jason', role: 'Mechanic',                         clearance: 'staff' },
      { name: 'Luiz',  role: 'Trackside Mechanic (AP)',          clearance: 'staff' }
    ],
    tasks: [
      { owner: 'Luiz', kart: 'Kart #3', task: 'Rear axle alignment', due: 'Now', dueState: 'now', status: 'Due now', priority: 'alert' },
      { owner: 'Luiz', kart: 'Kart #1', task: 'Fuel line inspection', due: '14:00', dueState: 'next', status: 'Pending', priority: 'warn' },
      { owner: 'Leo', kart: 'Kart #2', task: 'Brake pad check', due: 'Now', dueState: 'now', status: 'In progress', priority: 'warn' },
      { owner: 'Leo', kart: 'Kart #4', task: 'Front-end toe reset', due: '15:30', dueState: 'next', status: 'Pending', priority: 'warn' },
      { owner: 'Nico', kart: 'Kart #1', task: 'Telemetry sensor QA', due: '16:30', dueState: 'next', status: 'Ready', priority: 'ok' },
      { owner: 'Paula', kart: 'Team', task: 'Session staging checklist', due: '17:00', dueState: 'next', status: 'Prep', priority: 'warn' }
    ]
  };

  try {
    const [mechanicsRes, tasksRes] = await Promise.all([
      fetch('/assets/data/mechanics.json', { cache: 'no-store' }),
      fetch('/assets/data/workshop-tasks.json', { cache: 'no-store' })
    ]);
    if (!mechanicsRes.ok || !tasksRes.ok) throw new Error('Mechanic data unavailable');
    const mechanics = await mechanicsRes.json();
    const tasks = await tasksRes.json();
    return {
      mechanics: mechanics.mechanics || fallback.mechanics,
      tasks: tasks.tasks || fallback.tasks
    };
  } catch {
    return fallback;
  }
}

function renderWorkshopTasks(tasks) {
  const body = document.querySelector('[data-workshop-task-body]');
  if (!body || !tasks.length) return;
  body.innerHTML = tasks.map(task => `
    <tr data-owner="${escapeHtml(task.owner)}" data-due="${escapeHtml(task.dueState || 'next')}">
      <td>${escapeHtml(task.owner)}</td>
      <td>${escapeHtml(task.kart)}</td>
      <td>${escapeHtml(task.task)}</td>
      <td>${escapeHtml(task.due)}</td>
      <td><span class="badge ${escapeHtml(task.priority || 'warn')}">${escapeHtml(task.status)}</span></td>
    </tr>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function updateMechanicOwnedTasks(mechanic) {
  const rows = document.querySelectorAll('[data-owner]');
  if (!rows.length) return;

  let myOpenTasks = 0;
  let myDueTasks = 0;
  const focusItems = [];

  rows.forEach(row => {
    const isMine = row.getAttribute('data-owner') === mechanic;
    row.classList.toggle('is-my-task', isMine);
    if (!isMine) return;

    myOpenTasks += 1;
    if (row.getAttribute('data-due') === 'now') myDueTasks += 1;
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) focusItems.push(`${cells[1].textContent}: ${cells[2].textContent} (${cells[3].textContent})`);
  });

  const taskCount = document.querySelector('[data-my-task-count]');
  const dueCount = document.querySelector('[data-my-due-count]');
  const owner = document.querySelector('[data-my-task-owner]');
  const focus = document.querySelector('[data-my-focus]');

  if (taskCount) taskCount.textContent = String(myOpenTasks);
  if (dueCount) dueCount.textContent = String(myDueTasks);
  if (owner) owner.textContent = `${mechanic}'s queue`;
  if (focus) focus.textContent = focusItems.length ? focusItems.join(' · ') : `${mechanic} has no assigned tasks right now.`;
}

async function initTelemetryUpdates() {
  const cards = document.querySelectorAll('[data-telemetry-card]');
  if (!cards.length) return;
  let data;
  try {
    const res = await fetch('/assets/data/telemetry.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    data = { updatedAt: 'n/a', karts: [
      { id:'Kart #1', lapTime:45.2, speedKmh:87.5, rpm:12400, temperatureC:85 },
      { id:'Kart #2', lapTime:44.9, speedKmh:89.2, rpm:12650, temperatureC:82 }
    ]};
  }

  const updatedAt = document.getElementById('telemetry-updated-at');
  if (updatedAt && data.updatedAt) updatedAt.textContent = new Date(data.updatedAt).toLocaleString();

  cards.forEach((card, idx) => {
    const row = (data.karts || [])[idx];
    if (!row) return;
    setCard(card, row);
  });
}

function setCard(card, row) {
  const map = {
    lap: card.querySelector('[data-metric="lap"]'),
    speed: card.querySelector('[data-metric="speed"]'),
    rpm: card.querySelector('[data-metric="rpm"]'),
    temp: card.querySelector('[data-metric="temp"]')
  };
  if (map.lap) map.lap.textContent = `${Number(row.lapTime).toFixed(3)}s`;
  if (map.speed) map.speed.textContent = `${Number(row.speedKmh).toFixed(1)} km/h`;
  if (map.rpm) map.rpm.textContent = Number(row.rpm).toLocaleString();
  if (map.temp) map.temp.textContent = `${Math.round(Number(row.temperatureC))}°C`;
}

async function initWeatherContext() {
  const panels = document.querySelectorAll('[data-weather-panel]');
  const tempTargets = document.querySelectorAll('[data-weather-temp]');
  if (!panels.length && !tempTargets.length) return;

  const context = await loadTrackContext();
  const tracks = context.tracks;
  const storageKey = 'raceTracker.activeTrackId';
  const getTrack = () => tracks.find(track => track.id === localStorage.getItem(storageKey)) || tracks.find(track => track.id === context.activeTrackId) || tracks[0];

  renderTrackSelectors(tracks, getTrack().id, async (trackId) => {
    localStorage.setItem(storageKey, trackId);
    await updateWeatherForTrack(getTrack());
  });
  await updateWeatherForTrack(getTrack());
  initEventSchedule(context);
  startWeatherRefreshCountdown(getTrack);
}

const WEATHER_REFRESH_MS = 5 * 60 * 1000;

function startWeatherRefreshCountdown(getTrack) {
  let nextRefresh = Date.now() + WEATHER_REFRESH_MS;

  const tick = () => {
    const remaining = Math.max(0, nextRefresh - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const label = remaining > 0 ? `Refresh in ${mins}:${String(secs).padStart(2, '0')}` : 'Refreshing…';
    setText('[data-weather-countdown]', label);
  };

  setInterval(async () => {
    nextRefresh = Date.now() + WEATHER_REFRESH_MS;
    await updateWeatherForTrack(getTrack());
  }, WEATHER_REFRESH_MS);

  setInterval(tick, 1000);
  tick();
}

async function updateWeatherForTrack(track) {
  setText('[data-track-name]', track.shortName || track.name);
  try {
    const weather = await fetchCurrentWeather(track);
    renderWeatherContext(track, weather);
  } catch {
    renderWeatherFallback(track);
  }
}

function renderTrackSelectors(tracks, selectedId, onChange) {
  const primary = tracks.filter(t => t.priority === 'primary');
  const venues  = tracks.filter(t => t.priority === 'venue');

  const optionHtml = (track) =>
    `<option value="${escapeHtml(track.id)}" ${track.id === selectedId ? 'selected' : ''}>${escapeHtml(track.shortName || track.name)}</option>`;

  const groupsHtml = [
    primary.length ? `<optgroup label="Karting Tracks">${primary.map(optionHtml).join('')}</optgroup>` : '',
    venues.length  ? `<optgroup label="NASCAR / Major Venues">${venues.map(optionHtml).join('')}</optgroup>` : '',
  ].filter(Boolean).join('') || tracks.map(optionHtml).join('');

  document.querySelectorAll('[data-track-selector]').forEach(slot => {
    slot.innerHTML = `
      <label class="track-switcher">
        <span>Track</span>
        <select data-track-select aria-label="Select event track">${groupsHtml}</select>
      </label>
    `;
    slot.querySelector('[data-track-select]').addEventListener('change', (event) => {
      onChange(event.target.value);
      document.querySelectorAll('[data-track-select]').forEach(select => {
        select.value = event.target.value;
      });
    });
  });
}

async function loadTrackContext() {
  const fallbackTrack = {
    id: 'new-castle-motorsports-park',
    name: 'New Castle Motorsports Park',
    shortName: 'New Castle, IN',
    latitude: 39.8496829,
    longitude: -85.4080572,
    timezone: 'America/Indiana/Indianapolis',
    weatherProvider: 'Open-Meteo'
  };
  const fallback = {
    activeTrackId: fallbackTrack.id,
    tracks: [fallbackTrack]
  };

  try {
    const res = await fetch('/assets/data/track-context.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Track context unavailable');
    const data = await res.json();
    if (Array.isArray(data.tracks) && data.tracks.length) return data;
    if (data.activeTrack) return { activeTrackId: data.activeTrack.id || fallbackTrack.id, tracks: [data.activeTrack] };
    return fallback;
  } catch {
    return fallback;
  }
}

async function fetchCurrentWeather(track) {
  const params = new URLSearchParams({
    latitude: String(track.latitude),
    longitude: String(track.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: track.timezone || 'auto'
  });
  const endpoint = `${track.weatherApi || 'https://api.open-meteo.com/v1/forecast'}?${params}`;
  const res = await fetch(endpoint, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
  const data = await res.json();
  if (!data.current) throw new Error('Weather current payload missing');
  return data.current;
}

function renderWeatherContext(track, weather) {
  const temp = Number(weather.temperature_2m);
  const feels = Number(weather.apparent_temperature);
  const wind = Number(weather.wind_speed_10m);
  const gust = Number(weather.wind_gusts_10m || wind);
  const rain = Number(weather.precipitation || 0);
  const risk = classifyWeatherRisk({ temp, wind, gust, rain, code: weather.weather_code });

  setText('[data-weather-temp]', `${Math.round(temp)}°F`);
  setText('[data-weather-feels]', `${Math.round(feels)}°F`);
  setText('[data-weather-wind]', `${Math.round(wind)} mph`);
  setText('[data-weather-gust]', `${Math.round(gust)} mph`);
  setText('[data-weather-rain]', `${rain.toFixed(2)} in`);
  setText('[data-weather-risk]', risk.label);
  setText('[data-weather-guidance]', risk.guidance);
  setText('[data-weather-updated]', formatWeatherTime(weather.time, track.timezone));
  setWeatherBadgeState(risk.state);
}

function renderWeatherFallback(track) {
  setText('[data-weather-temp]', '--°F');
  setText('[data-weather-feels]', '--°F');
  setText('[data-weather-wind]', '-- mph');
  setText('[data-weather-gust]', '-- mph');
  setText('[data-weather-rain]', '-- in');
  setText('[data-weather-risk]', 'Offline');
  setText('[data-weather-guidance]', `Live weather is unavailable. Confirm ${track.shortName || track.name} conditions manually before session calls.`);
  setText('[data-weather-updated]', 'Offline');
  setWeatherBadgeState('warn');
}

function classifyWeatherRisk({ temp, wind, gust, rain, code }) {
  const rainyCode = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(Number(code));
  if (rain >= 0.03 || rainyCode || gust >= 28) {
    return {
      state: 'alert',
      label: 'Weather risk high',
      guidance: 'Track conditions can move quickly. Prioritize rain setup, visor prep, tire pressure notes, and extra brake/fuel checks before release.'
    };
  }
  if (wind >= 14 || gust >= 20 || temp >= 92 || temp <= 50) {
    return {
      state: 'warn',
      label: 'Watch conditions',
      guidance: 'Flag the session for setup review. Re-check pressures, gearing/jetting assumptions, and driver feedback after the first run.'
    };
  }
  return {
    state: 'ok',
    label: 'Good track window',
    guidance: 'Conditions look stable. Keep normal pressure logs and compare telemetry against the current weather stamp.'
  };
}

async function initEventSchedule(context) {
  const body = document.querySelector('[data-event-schedule-body]');
  if (!body) return;
  try {
    const res = await fetch('/assets/data/event-schedule.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('Event schedule unavailable');
    const data = await res.json();
    renderEventSchedule(data, context.tracks);
  } catch {
    setText('[data-event-source-status]', 'Offline');
  }
}

function renderEventSchedule(data, tracks) {
  const body = document.querySelector('[data-event-schedule-body]');
  if (!body) return;
  const trackNames = new Map(tracks.map(track => [track.id, track.shortName || track.name]));
  const events = Array.isArray(data.events) ? data.events : [];
  if (!events.length) return;
  body.innerHTML = events.map(event => {
    const registration = event.registrationUrl
      ? `<a href="${escapeHtml(event.registrationUrl)}" target="_blank" rel="noopener">${escapeHtml(event.registrationStatus || 'Open')}</a>`
      : escapeHtml(event.registrationStatus || 'Provider needed');
    return `
      <tr>
        <td>${escapeHtml(trackNames.get(event.trackId) || event.track || 'TBD')}</td>
        <td>${escapeHtml(event.name || 'Connect official schedule')}</td>
        <td>${escapeHtml(event.date || 'Source needed')}</td>
        <td>${registration}</td>
        <td>${escapeHtml(event.source || 'TBD')}</td>
      </tr>
    `;
  }).join('');
  const statusLabels = {
    connected: 'Connected',
    'google-sheets-bridge': 'Google Sheets bridge',
    'candidate-sources-found': 'Source candidates'
  };
  setText('[data-event-source-status]', statusLabels[data.sourceStatus] || 'Source needed');
  renderSourceCandidates(data.sourceCandidates || []);
}

function renderSourceCandidates(candidates) {
  const list = document.querySelector('[data-source-candidate-list]');
  if (!list || !candidates.length) return;
  list.innerHTML = candidates.map(source => `
    <div class="source-item">
      <strong>${escapeHtml(source.name || 'Source candidate')}</strong>
      <span>${escapeHtml(source.providerType || 'source')} · ${escapeHtml(source.confidence || 'candidate')}</span>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(source.url)}</a>
      <small>${escapeHtml(source.notes || '')}</small>
    </div>
  `).join('');
}

function setText(selector, value) {
  document.querySelectorAll(selector).forEach(el => {
    el.textContent = value;
  });
}

function setWeatherBadgeState(state) {
  document.querySelectorAll('[data-weather-risk], [data-weather-updated]').forEach(el => {
    el.classList.remove('ok', 'warn', 'alert', 'up', 'down');
    if (el.classList.contains('badge')) el.classList.add(state);
    if (el.classList.contains('delta')) {
      el.classList.add(state === 'ok' ? 'up' : state === 'alert' ? 'down' : 'warn');
    }
  });
}

function formatWeatherTime(value, timezone) {
  if (!value) return 'Live';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Live';
  return date.toLocaleTimeString([], {
    timeZone: timezone || undefined,
    hour: 'numeric',
    minute: '2-digit'
  });
}

// ── Team roster ───────────────────────────────────────────────

async function initTeamRoster() {
  const staffGrid  = document.querySelector('[data-team-staff-grid]');
  const driverGrid = document.querySelector('[data-team-driver-grid]');
  const parentGrid = document.querySelector('[data-team-parent-grid]');
  if (!staffGrid && !driverGrid && !parentGrid) return;

  let data;
  try {
    const res = await fetch('/assets/data/mechanics.json', { cache: 'no-store' });
    data = await res.json();
  } catch { return; }

  const renderCard = (person) => `
    <div class="team-person-card">
      <div class="team-person-header">
        <span class="team-person-name">${escapeHtml(person.name)}</span>
        <span class="badge clearance-${escapeHtml(person.clearance || 'staff')}">${escapeHtml(person.clearance || 'staff')}</span>
      </div>
      <div class="team-person-role">${escapeHtml(person.role || '')}</div>
      ${person.specialty ? `<div class="team-person-specialty">${escapeHtml(person.specialty)}</div>` : ''}
      ${person.shift     ? `<div class="team-person-shift">Shift: ${escapeHtml(person.shift)}</div>` : ''}
      ${person.class     ? `<div class="team-person-shift">Class: ${escapeHtml(person.class)}</div>` : ''}
      ${person.note      ? `<div class="team-person-note">${escapeHtml(person.note)}</div>` : ''}
    </div>
  `;

  if (staffGrid && data.mechanics) {
    staffGrid.innerHTML = data.mechanics.map(renderCard).join('');
  }
  if (driverGrid && data.driverRoster) {
    driverGrid.innerHTML = data.driverRoster.map(renderCard).join('');
  }
  if (parentGrid && data.guardianRoster) {
    parentGrid.innerHTML = data.guardianRoster.map(renderCard).join('');
  }
}

// ── Add-task form ─────────────────────────────────────────────

const TASKS_LOCAL_KEY = 'raceTracker.localTasks';

function initAddTaskForm() {
  const form = document.querySelector('[data-add-task-form]');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const task = {
      id: `tsk-local-${Date.now()}`,
      owner: data.get('owner') || 'Team',
      kart: data.get('kart') || 'Team',
      task: data.get('task') || '',
      due: data.get('due') || 'Now',
      dueState: (data.get('due') || 'Now').toLowerCase() === 'now' ? 'now' : 'next',
      status: 'Pending',
      priority: 'warn'
    };
    if (!task.task.trim()) return;
    saveLocalTask(task);
    appendTaskRow(task);
    form.reset();
  });

  renderLocalTasks();
}

function getLocalTasks() {
  try { return JSON.parse(localStorage.getItem(TASKS_LOCAL_KEY) || '[]'); } catch { return []; }
}

function saveLocalTask(task) {
  const tasks = getLocalTasks();
  tasks.push(task);
  try { localStorage.setItem(TASKS_LOCAL_KEY, JSON.stringify(tasks)); } catch {}
}

function renderLocalTasks() {
  const tasks = getLocalTasks();
  tasks.forEach(task => appendTaskRow(task));
}

function appendTaskRow(task) {
  const body = document.querySelector('[data-workshop-task-body]');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.setAttribute('data-owner', escapeHtml(task.owner));
  tr.setAttribute('data-due', escapeHtml(task.dueState || 'next'));
  tr.setAttribute('data-local-task', task.id);
  tr.innerHTML = `
    <td>${escapeHtml(task.owner)}</td>
    <td>${escapeHtml(task.kart)}</td>
    <td>${escapeHtml(task.task)}</td>
    <td>${escapeHtml(task.due)}</td>
    <td><span class="badge ${escapeHtml(task.priority || 'warn')}">${escapeHtml(task.status)}</span></td>
  `;
  body.appendChild(tr);
}

// ── Setup sheet ───────────────────────────────────────────────

const SETUP_LOCAL_KEY = 'raceTracker.setupSheet';

function initSetupSheet() {
  const cards = document.querySelectorAll('[data-setup-kart]');
  if (!cards.length) return;

  const saved = (() => { try { return JSON.parse(localStorage.getItem(SETUP_LOCAL_KEY) || '{}'); } catch { return {}; } })();

  cards.forEach(card => {
    const kartId = card.getAttribute('data-setup-kart');
    const kartData = saved[kartId] || {};
    card.querySelectorAll('[data-setup-field]').forEach(input => {
      const field = input.getAttribute('data-setup-field');
      if (kartData[field] !== undefined) input.value = kartData[field];
      input.addEventListener('input', () => {
        const all = (() => { try { return JSON.parse(localStorage.getItem(SETUP_LOCAL_KEY) || '{}'); } catch { return {}; } })();
        if (!all[kartId]) all[kartId] = {};
        all[kartId][field] = input.value;
        try { localStorage.setItem(SETUP_LOCAL_KEY, JSON.stringify(all)); } catch {}
      });
    });
  });
}

// ── Billing module ────────────────────────────────────────────

const BILLING_KEY = 'raceTracker.billing';

const EXPENSE_CATEGORIES = {
  'entry-fee':   'Entry Fee',
  'tires':       'Tires',
  'parts':       'Parts',
  'consumables': 'Consumables',
  'labor':       'Labor / Service',
  'travel':      'Travel',
  'other':       'Other'
};

async function initBillingModule() {
  if (!document.querySelector('[data-billing-page]')) return;

  const [billingData, scheduleData, mechanicsData] = await Promise.all([
    fetchJson('/assets/data/billing.json'),
    fetchJson('/assets/data/event-schedule.json'),
    fetchJson('/assets/data/mechanics.json')
  ]);

  const seedExpenses = billingData?.expenses || [];
  const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
  const storedIds = new Set(stored.map(e => e.id));
  const allExpenses = [...stored, ...seedExpenses.filter(e => !storedIds.has(e.id))];

  const events   = scheduleData?.events || [];
  const drivers  = (mechanicsData?.driverRoster || [{ id: 'driver-1', name: 'Driver' }]);
  const profile  = localStorage.getItem('raceTracker.mechanicProfile') || 'Luiz';
  const allPeople = mechanicsData?.mechanics || [];
  const personData = allPeople.find(m => m.name === profile) || { clearance: 'staff' };
  const clearance = personData.clearance || 'staff';

  populateBillingFilters(drivers, events);
  populateExpenseForm(drivers, events, profile);
  renderBillingLedger(allExpenses, drivers, events, clearance, profile);
  updateBillingKpis(allExpenses);
  wireBillingForm(drivers, events, profile, allExpenses);
  showAddFormByRole(clearance);
}

async function fetchJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? r.json() : null; } catch { return null; }
}

function populateBillingFilters(drivers, events) {
  const driverFilter = document.querySelector('[data-billing-driver-filter]');
  const eventFilter  = document.querySelector('[data-billing-event-filter]');
  if (driverFilter) {
    drivers.forEach(d => {
      const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; driverFilter.appendChild(o);
    });
    driverFilter.addEventListener('change', () => triggerBillingRerender());
  }
  if (eventFilter) {
    events.forEach(ev => {
      const o = document.createElement('option'); o.value = ev.id; o.textContent = ev.name; eventFilter.appendChild(o);
    });
    eventFilter.addEventListener('change', () => triggerBillingRerender());
  }
}

function triggerBillingRerender() {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
  const profile  = localStorage.getItem('raceTracker.mechanicProfile') || 'Luiz';
  renderBillingLedger(stored, [], [], 'staff', profile);
}

function populateExpenseForm(drivers, events, profile) {
  const dSel = document.querySelector('[data-expense-driver-select]');
  const eSel = document.querySelector('[data-expense-event-select]');
  const loggedBy = document.querySelector('[data-billing-logged-by]');
  if (loggedBy) loggedBy.textContent = profile;
  if (dSel) drivers.forEach(d => { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; dSel.appendChild(o); });
  if (eSel) events.forEach(ev => {
    const o = document.createElement('option');
    o.value = ev.id;
    o.textContent = `${ev.name}${ev.eventType === 'arrive-and-drive' ? ' [A&D]' : ''}`;
    eSel.appendChild(o);
  });
}

function renderBillingLedger(expenses, drivers, events, clearance, profile) {
  const ledger = document.querySelector('[data-billing-ledger]');
  if (!ledger) return;

  const driverFilter = document.querySelector('[data-billing-driver-filter]')?.value || 'all';
  const eventFilter  = document.querySelector('[data-billing-event-filter]')?.value  || 'all';

  let filtered = expenses;
  if (clearance === 'parent' || clearance === 'driver') {
    filtered = filtered.filter(e => e.approvalStatus === 'approved');
  }
  if (driverFilter !== 'all') filtered = filtered.filter(e => e.driverId === driverFilter);
  if (eventFilter  !== 'all') filtered = filtered.filter(e => e.eventId  === eventFilter);

  if (!filtered.length) {
    ledger.innerHTML = '<p class="muted-copy">No expenses match the current filter. Add the first expense using the form below.</p>';
    return;
  }

  const byEvent = {};
  filtered.forEach(e => {
    const key = e.eventId || 'unassigned';
    if (!byEvent[key]) byEvent[key] = { name: e.eventName || key, eventType: e.eventType, items: [] };
    byEvent[key].items.push(e);
  });

  ledger.innerHTML = Object.entries(byEvent).map(([eventId, group]) => {
    const total = group.items.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const typeBadge = group.eventType === 'arrive-and-drive'
      ? '<span class="badge event-type-arrive-drive">Arrive &amp; Drive</span>'
      : '<span class="badge event-type-own-kart">Own Kart</span>';
    const rows = group.items.map(e => {
      const approvalBadge = e.approvalStatus === 'approved'
        ? '<span class="badge ok">Approved</span>'
        : e.approvalStatus === 'void'
        ? '<span class="badge">Void</span>'
        : `<span class="badge warn">Pending</span>`;
      const approveBtn = clearance === 'admin' && e.approvalStatus === 'pending'
        ? `<button class="timer-btn" style="padding:.22rem .55rem;font-size:.72rem;" onclick="approveBillingExpense('${escapeHtml(e.id)}')">Approve</button>`
        : '';
      return `<tr>
        <td>${escapeHtml(e.driverName || e.driverId || '—')}</td>
        <td><span class="billing-category">${escapeHtml(EXPENSE_CATEGORIES[e.category] || e.category)}</span></td>
        <td>${escapeHtml(e.item || '—')}</td>
        <td class="billing-reason">${escapeHtml(e.reason || '—')}</td>
        <td class="billing-amount">$${Number(e.amount || 0).toFixed(2)}</td>
        <td>${approvalBadge}${approveBtn}</td>
      </tr>`;
    }).join('');
    return `
      <div class="billing-event-card" style="margin-bottom:1.25rem;">
        <div class="billing-event-header">${escapeHtml(group.name)} ${typeBadge} <span class="billing-event-total">Total: $${total.toFixed(2)}</span></div>
        <table class="table billing-table">
          <thead><tr><th>Driver</th><th>Category</th><th>Item</th><th>Reason</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

function updateBillingKpis(expenses) {
  const total   = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pending = expenses.filter(e => e.approvalStatus === 'pending').length;
  const events  = new Set(expenses.map(e => e.eventId)).size;
  const drivers = new Set(expenses.map(e => e.driverId)).size;
  setText('[data-billing-total]',   `$${total.toFixed(2)}`);
  setText('[data-billing-pending]', String(pending));
  setText('[data-billing-events]',  String(events));
  setText('[data-billing-drivers]', String(drivers));
}

function wireBillingForm(drivers, events, profile, allExpenses) {
  const form = document.querySelector('[data-add-expense-form]');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const driverSel = fd.get('driverId');
    const eventSel  = fd.get('eventId');
    const driverName = drivers.find(d => d.id === driverSel)?.name || driverSel;
    const ev = events.find(ev => ev.id === eventSel);
    const expense = {
      id:             `exp-${Date.now()}`,
      driverId:       driverSel,
      driverName,
      eventId:        eventSel,
      eventName:      ev?.name || eventSel,
      eventType:      ev?.eventType || 'own-kart',
      date:           fd.get('date') || new Date().toISOString().slice(0,10),
      category:       fd.get('category'),
      item:           fd.get('item'),
      amount:         parseFloat(fd.get('amount')) || 0,
      currency:       'USD',
      reason:         fd.get('reason'),
      loggedBy:       profile,
      approvedBy:     null,
      approvalStatus: 'pending',
      visibleToParent: true
    };
    const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
    stored.push(expense);
    try { localStorage.setItem(BILLING_KEY, JSON.stringify(stored)); } catch {}
    allExpenses.push(expense);
    renderBillingLedger(allExpenses, drivers, events, 'staff', profile);
    updateBillingKpis(allExpenses);
    form.reset();
    document.querySelector('[data-billing-logged-by]').textContent = profile;
  });
}

window.approveBillingExpense = function(id) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
  const exp = stored.find(e => e.id === id);
  if (!exp) return;
  const profile = localStorage.getItem('raceTracker.mechanicProfile') || 'Seth';
  exp.approvalStatus = 'approved';
  exp.approvedBy = profile;
  try { localStorage.setItem(BILLING_KEY, JSON.stringify(stored)); } catch {}
  initBillingModule();
};

function showAddFormByRole(clearance) {
  const section = document.querySelector('[data-billing-add-section]');
  if (!section) return;
  section.style.display = (clearance === 'admin' || clearance === 'staff') ? '' : 'none';
}

// ── Series Calendars ──────────────────────────────────────────

const DIVISION_LABELS = {
  'national':            'National Events',
  'south':               'South Division',
  'east':                'East Division',
  'north':               'North Division',
  'florida-winter-tour': 'Florida Winter Tour',
  'rok-sonoma-tc1':      'ROK Sonoma — Triple Crown 1',
  'rok-sonoma-tc2':      'ROK Sonoma — Triple Crown 2',
  'international':       'International',
  'winter-series':       'Winter Series',
  'pro-tour':            'Pro Tour',
  'pkc':                 'California ProKart Challenge (PKC)',
  'supernats':           'SuperNationals'
};

const SERIES_SHORT = {
  'ckna':             'CKNA',
  'cup-karts-canada': 'CKC',
  'rok-cup-usa':      'ROK Cup',
  'skusa':            'SKUSA',
  'stars':            'STARS',
  'uspks':            'USPKS',
  'tsrs':             'TSRS'
};

async function initSeriesCalendars() {
  const calBody   = document.querySelector('[data-series-calendar-body]');
  const nextUpEl  = document.querySelector('[data-next-up-list]');
  if (!calBody && !nextUpEl) return;

  let data;
  try {
    const res = await fetch('/assets/data/series-calendars.json', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch {
    if (calBody)  calBody.innerHTML  = '<p class="reg-error">Could not load series calendars.</p>';
    if (nextUpEl) nextUpEl.innerHTML = '<p class="reg-error">Calendar unavailable.</p>';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allRounds = [];
  data.series.forEach(series => {
    series.rounds.forEach(round => {
      allRounds.push({
        ...round,
        _seriesId:    series.id,
        _seriesName:  series.name,
        _seriesShort: SERIES_SHORT[series.id] || series.id.toUpperCase(),
        _website:     series.website || null,
        _timeStatus:  calRoundTimeStatus(round, today)
      });
    });
  });

  const todayStr = today.toISOString().slice(0, 10);

  // Find nearest upcoming date and tag those as 'next'
  // Use future-starting rounds only (avoids multi-month events like ROK Cup Italia stealing the badge)
  const upcoming = allRounds
    .filter(r => r._timeStatus === 'upcoming' && r.dateStart)
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const futureStarts = upcoming.filter(r => r.dateStart >= todayStr);
  const nextDate = futureStarts.length ? futureStarts[0].dateStart : null;
  if (nextDate) allRounds.forEach(r => {
    if (r._timeStatus === 'upcoming' && r.dateStart === nextDate) r._timeStatus = 'next';
  });

  // Detect conflicts only among weekend-scale rounds (<=14 days span) to avoid
  // multi-month entries like ROK Cup Italia flooding every nearby round as a conflict
  const nearSorted = allRounds
    .filter(r => (r._timeStatus === 'next' || r._timeStatus === 'upcoming') && r.dateStart >= todayStr)
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
  const conflictIds = detectCalConflicts(nearSorted.slice(0, 20));

  if (nextUpEl) renderCalNextUp(upcoming.slice(0, 8), conflictIds, nextUpEl);
  if (calBody)  renderCalBody(data.series, allRounds, conflictIds, calBody);
}

function calRoundTimeStatus(round, today) {
  if (!round.dateStart) return 'tbd';
  const end = new Date((round.dateEnd || round.dateStart) + 'T23:59:59');
  return end < today ? 'past' : 'upcoming';
}

const CONFLICT_MAX_SPAN_DAYS = 14;

function detectCalConflicts(rounds) {
  const conflicts = new Set();
  for (let i = 0; i < rounds.length; i++) {
    for (let j = i + 1; j < rounds.length; j++) {
      const a = rounds[i], b = rounds[j];
      if (!a.dateStart || !b.dateStart) continue;
      if (a._seriesId === b._seriesId) continue;
      const aS = new Date(a.dateStart), aE = new Date(a.dateEnd || a.dateStart);
      const bS = new Date(b.dateStart), bE = new Date(b.dateEnd || b.dateStart);
      const aSpan = (aE - aS) / 86400000;
      const bSpan = (bE - bS) / 86400000;
      if (aSpan > CONFLICT_MAX_SPAN_DAYS || bSpan > CONFLICT_MAX_SPAN_DAYS) continue;
      if (aS <= bE && bS <= aE) {
        conflicts.add(calRoundKey(a));
        conflicts.add(calRoundKey(b));
      }
    }
  }
  return conflicts;
}

function calRoundKey(round) {
  return `${round._seriesId}:${round.round}`;
}

function formatCalDate(round) {
  if (!round.dateStart) return round.date || 'TBD';
  const s = new Date(round.dateStart + 'T12:00:00');
  const e = round.dateEnd ? new Date(round.dateEnd + 'T12:00:00') : null;
  const mo = d => d.toLocaleDateString('en-US', { month: 'short' });
  const dy = d => d.getDate();
  if (!e || round.dateStart === round.dateEnd) return `${mo(s)} ${dy(s)}`;
  if (s.getMonth() === e.getMonth())           return `${mo(s)} ${dy(s)}–${dy(e)}`;
  return `${mo(s)} ${dy(s)}–${mo(e)} ${dy(e)}`;
}

function renderCalNextUp(upcoming, conflictIds, container) {
  if (!upcoming.length) {
    container.innerHTML = '<p class="muted-copy">No upcoming rounds found.</p>';
    setText('[data-nextup-badge]', '0 upcoming');
    return;
  }
  setText('[data-nextup-badge]', `${upcoming.length} upcoming`);

  container.innerHTML = upcoming.map(r => {
    const isNext     = r._timeStatus === 'next';
    const isConflict = conflictIds.has(calRoundKey(r));
    const track = r.track === 'TBD' ? '<em class="cal-tba">Venue TBA</em>' : escapeHtml(r.track);
    return `
      <div class="cal-nextup-item${isNext ? ' cal-nextup-item--next' : ''}">
        <span class="cal-sbadge cal-sbadge--${escapeHtml(r._seriesId)}">${escapeHtml(r._seriesShort)}</span>
        <span class="cal-nextup-date">${escapeHtml(formatCalDate(r))}</span>
        <span class="cal-nextup-name">${escapeHtml(r.name)}</span>
        <span class="cal-nextup-track">${track}${r.trackCity ? ` · <span class="cal-city">${escapeHtml(r.trackCity)}</span>` : ''}</span>
        <span class="cal-nextup-flags">
          ${isNext     ? '<span class="badge ok">Next</span>' : ''}
          ${isConflict ? '<span class="badge warn">⚡ Conflict</span>' : ''}
        </span>
      </div>`;
  }).join('');
}

function renderCalBody(seriesList, allRounds, conflictIds, calBody) {
  const filterRow = document.querySelector('[data-series-filter]');
  if (filterRow) {
    const pills = [{ id: 'all', label: 'All Series' }, ...seriesList.map(s => ({
      id: s.id, label: SERIES_SHORT[s.id] || s.id
    }))];
    filterRow.innerHTML = pills.map(p =>
      `<button class="series-pill${p.id === 'all' ? ' active' : ''}" data-filter="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`
    ).join('');
    filterRow.querySelectorAll('.series-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        filterRow.querySelectorAll('.series-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const id = btn.getAttribute('data-filter');
        calBody.querySelectorAll('.cal-series').forEach(block => {
          block.style.display = (id === 'all' || block.getAttribute('data-series-id') === id) ? '' : 'none';
        });
      });
    });
  }

  calBody.innerHTML = seriesList.map(series => {
    const rounds       = allRounds.filter(r => r._seriesId === series.id);
    const totalConfirmed = rounds.filter(r => r.status === 'confirmed' || r.status === 'venue-tba').length;
    const remaining    = rounds.filter(r => r._timeStatus !== 'past').length;

    const divisions = {};
    rounds.forEach(r => {
      const key = r.division || 'main';
      if (!divisions[key]) divisions[key] = [];
      divisions[key].push(r);
    });
    const multiDiv = Object.keys(divisions).length > 1;

    const divBlocks = Object.entries(divisions).map(([divId, divRounds]) => `
      <div class="cal-division">
        ${multiDiv ? `<div class="cal-division-label">${escapeHtml(DIVISION_LABELS[divId] || divId)}</div>` : ''}
        <table class="table cal-table">
          <thead><tr><th>Date</th><th>Event</th><th>Track</th><th>Location</th></tr></thead>
          <tbody>${divRounds.map(r => renderCalRow(r, conflictIds)).join('')}</tbody>
        </table>
      </div>
    `).join('');

    return `
      <div class="cal-series" data-series-id="${escapeHtml(series.id)}">
        <div class="cal-series-header">
          <div class="cal-series-title">
            <span class="cal-sbadge cal-sbadge--${escapeHtml(series.id)}">${escapeHtml(SERIES_SHORT[series.id] || series.id)}</span>
            <strong>${escapeHtml(series.name)}</strong>
          </div>
          <div class="cal-series-meta">
            <span>${totalConfirmed} rounds</span>
            <span class="cal-meta-sep">·</span>
            <span>${remaining} remaining</span>
            ${series.website ? `<a href="${escapeHtml(series.website)}" target="_blank" rel="noopener" class="cal-series-link">Website ↗</a>` : ''}
          </div>
        </div>
        ${divBlocks}
      </div>`;
  }).join('');
}

function renderCalRow(round, conflictIds) {
  const isPast     = round._timeStatus === 'past';
  const isNext     = round._timeStatus === 'next';
  const isVenueTba = round.status === 'venue-tba';
  const isConflict = conflictIds.has(calRoundKey(round));
  const isDouble   = (round.note || '').toLowerCase().includes('double');

  const rowClass = isPast ? ' cal-row-past' : isNext ? ' cal-row-next' : '';
  const trackCell = isVenueTba
    ? `${escapeHtml(round.track)} <span class="badge warn" style="font-size:.62rem;vertical-align:middle;">TBA</span>`
    : escapeHtml(round.track || 'TBD');

  const flags = [
    isNext     ? `<span class="badge ok"     style="font-size:.62rem;">Next</span>` : '',
    isConflict ? `<span class="badge warn"   style="font-size:.62rem;">⚡ Conflict</span>` : '',
    isDouble   ? `<span class="badge"        style="font-size:.62rem;background:var(--accent-blue);color:#fff;">2×pts</span>` : ''
  ].filter(Boolean).join(' ');

  return `<tr class="cal-round-row${rowClass}">
    <td class="cal-date-cell">${escapeHtml(formatCalDate(round))}</td>
    <td>${escapeHtml(round.name)}${flags ? ' ' + flags : ''}</td>
    <td>${trackCell}</td>
    <td class="cal-city-cell">${escapeHtml(round.trackCity || '—')}</td>
  </tr>`;
}
