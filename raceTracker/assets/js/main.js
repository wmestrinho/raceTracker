document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initActiveNav();
  initMechanicContext();
  initTelemetryUpdates();
  initWeatherContext();
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

  renderMechanicSlots(getSelected());
  updateMechanicOwnedTasks(getSelected());
}

async function loadMechanicData() {
  const fallback = {
    mechanics: [
      { name: 'Luiz' },
      { name: 'Leo' },
      { name: 'Nico' },
      { name: 'Paula' }
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
  document.querySelectorAll('[data-track-selector]').forEach(slot => {
    slot.innerHTML = `
      <label class="track-switcher">
        <span>Track</span>
        <select data-track-select aria-label="Select event track">
          ${tracks.map(track => `<option value="${escapeHtml(track.id)}" ${track.id === selectedId ? 'selected' : ''}>${escapeHtml(track.name)}</option>`).join('')}
        </select>
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
