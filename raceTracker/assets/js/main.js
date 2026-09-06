document.addEventListener('DOMContentLoaded', () => {
  initCurrentYear();
  initSidebarToggle();
  initActiveNav();
  initEntityContext();
  initAuthContext();
  initTelemetryUpdates();
  initWeatherContext();
  initAddTaskForm();
  initSetupSheet();
  initPreTechDriverForm();
  initPreTechMechanicChecklist();
  initTeamRoster();
  initBillingModule();
  initSupervisorPage();
  initWeatherSandbox();
});

function initCurrentYear() {
  document.querySelectorAll('[data-current-year]').forEach(el => {
    el.textContent = new Date().getFullYear();
  });
}

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
    if (link.getAttribute('data-page') === bodyPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

// Real per-user identity via Cloudflare Access (assets/js/auth.js), replacing
// the old client-side name-picker. Access gates every page at the edge before
// this runs, so there is nothing to redirect to — the only pages that reach
// here without a profile are the Bypass paths (registrations.html's open
// driver Pre-Tech form) and accounts that are authenticated but not yet
// provisioned in `profiles`. Both are handled below.
async function initAuthContext() {
  await window.raceTrackerAuth.requireAuth();

  const mechanicData = await loadMechanicData();
  renderWorkshopTasks(mechanicData.tasks);

  const profile = await window.raceTrackerAuth.currentProfile();
  const slots = document.querySelectorAll('[data-mechanic-slot]');
  const onLoginPage = window.location.pathname.endsWith('/login.html') || window.location.pathname === '/login';

  if (!profile) {
    // 403 = Access knows them, `profiles` does not. Saying so is what keeps an
    // unprovisioned staff member from assuming the app is broken.
    const err = window.raceTrackerAuth.profileError();
    const needsProfile = err && err.status === 403;
    slots.forEach(slot => {
      if (onLoginPage) { slot.innerHTML = ''; return; }
      slot.innerHTML = needsProfile
        ? `<div class="mechanic-switcher"><span>No profile yet</span><strong>${escapeHtml(err.message)}</strong></div>`
        : '<a href="/login.html" class="mechanic-switcher"><span>Not signed in</span><strong>Sign in</strong></a>';
    });
    applyNavClearance('driver');
    return;
  }

  slots.forEach(slot => {
    slot.innerHTML = `
      <div class="mechanic-switcher">
        <span>Signed in</span>
        <strong>${escapeHtml(profile.name)}</strong>
        <button type="button" class="timer-btn" style="padding:.3rem .6rem;font-size:.72rem;" data-signout-btn>Log out</button>
      </div>
    `;
    slot.querySelector('[data-signout-btn]').addEventListener('click', () => window.raceTrackerAuth.signOut());
  });

  updateMechanicOwnedTasks(profile.name);
  applyNavClearance(profile.clearance);
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

// Still used for the demo workshop-tasks.json feed and as an offline fallback
// roster — but `mechanics.json`'s `mechanics` array is no longer the runtime
// identity source. Real staff/admin identity comes from the D1 `profiles`
// table via /api/me (see initAuthContext, fetchPreTechSignoffs, and
// initBillingModule below).
async function loadMechanicData() {
  const fallback = {
    mechanics: [
      { name: 'Emerson',     role: 'Owner / Team Principal', clearance: 'admin' },
      { name: 'Luiz',        role: 'AP Operations',          clearance: 'admin' },
      { name: 'Add Mechanic', role: 'Mechanic',              clearance: 'staff' },
      { name: 'Add Coach',    role: 'Driver Coach',          clearance: 'staff' }
    ],
    tasks: [
      { owner: 'Emerson', kart: 'Race kart', task: 'Pre-session driver debrief', due: 'Now', dueState: 'now', status: 'Due now', priority: 'alert' },
      { owner: 'Luiz', kart: 'Kart #3', task: 'Rear axle alignment', due: 'Now', dueState: 'now', status: 'Due now', priority: 'alert' },
      { owner: 'Luiz', kart: 'Kart #1', task: 'Fuel line inspection', due: '14:00', dueState: 'next', status: 'Pending', priority: 'warn' },
      { owner: 'Add Mechanic', kart: 'Kart #2', task: 'Brake pad check', due: 'Now', dueState: 'now', status: 'In progress', priority: 'warn' },
      { owner: 'Add Coach', kart: 'Kart #1', task: 'Telemetry sensor QA', due: '16:30', dueState: 'next', status: 'Ready', priority: 'ok' }
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
  const series  = tracks.filter(t => t.priority === 'series');
  const venues  = tracks.filter(t => t.priority === 'venue');
  const other   = tracks.filter(t => !['primary', 'series', 'venue'].includes(t.priority));

  const optionHtml = (track) =>
    `<option value="${escapeHtml(track.id)}" ${track.id === selectedId ? 'selected' : ''}>${escapeHtml(track.shortName || track.name)}</option>`;

  const groupsHtml = [
    primary.length ? `<optgroup label="Karting Tracks">${primary.map(optionHtml).join('')}</optgroup>` : '',
    series.length  ? `<optgroup label="Series Venues">${series.map(optionHtml).join('')}</optgroup>` : '',
    venues.length  ? `<optgroup label="NASCAR / Major Venues">${venues.map(optionHtml).join('')}</optgroup>` : '',
    other.length   ? `<optgroup label="Other Venues">${other.map(optionHtml).join('')}</optgroup>` : '',
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

// Shared risk thresholds. scripts/refresh_race_weather.py mirrors these in its
// RISK_THRESHOLDS dict so the generated race-weather.json agrees with what the
// browser computes; scripts/validate_structure.py fails the build if they drift.
const WEATHER_THRESHOLDS = {
  rainyCodes:       [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99],
  currentRainIn:    0.03,  // precipitation in the current hour
  dailyRainIn:      0.10,  // precipitation total across a whole day
  dailyRainProbPct: 60,
  climateWetDayPct: 50,
  alertGustMph:     28,
  warnWindMph:      14,
  warnGustMph:      20,
  hotF:             92,
  coldF:            50,
  // Day-over-day fall in the daily high. A collapse this size resets grip,
  // jetting and clutch engagement even when neither day trips hotF/coldF.
  severeTempDropF:  15
};

const RISK_COPY = {
  alert: {
    label: 'Weather risk high',
    guidance: 'Track conditions can move quickly. Prioritize rain setup, visor prep, tire pressure notes, and extra brake/fuel checks before release.'
  },
  warn: {
    label: 'Watch conditions',
    guidance: 'Flag the session for setup review. Re-check pressures, gearing/jetting assumptions, and driver feedback after the first run.'
  },
  ok: {
    label: 'Good track window',
    guidance: 'Conditions look stable. Keep normal pressure logs and compare telemetry against the current weather stamp.'
  }
};

function isRainyWeatherCode(code) {
  return WEATHER_THRESHOLDS.rainyCodes.includes(Number(code));
}

function classifyWeatherRisk({ temp, wind, gust, rain, code }) {
  const rainyCode = isRainyWeatherCode(code);
  if (rain >= WEATHER_THRESHOLDS.currentRainIn || rainyCode || gust >= WEATHER_THRESHOLDS.alertGustMph) {
    return { state: 'alert', ...RISK_COPY.alert };
  }
  if (wind >= WEATHER_THRESHOLDS.warnWindMph || gust >= WEATHER_THRESHOLDS.warnGustMph ||
      temp >= WEATHER_THRESHOLDS.hotF || temp <= WEATHER_THRESHOLDS.coldF) {
    return { state: 'warn', ...RISK_COPY.warn };
  }
  return { state: 'ok', ...RISK_COPY.ok };
}

// Daily-scale sibling of classifyWeatherRisk, for generated race-weekend data.
// Deliberate deviation: classifyWeatherRisk's 0.03 in rain trigger is an
// inch-in-the-current-hour test. As a DAILY total 0.03 in is a trace and would
// mark nearly every summer weekend "alert", so daily data uses dailyRainIn
// (0.10 in), the forecast precipitation probability, or — for climate normals,
// which have no probability variable — the historical wet-day frequency.
// Wind, gust, temperature and the rainy WMO code list are unchanged.
function classifyRaceDayRisk(day, mode) {
  if (!day) return { state: 'ok', ...RISK_COPY.ok };
  const t = WEATHER_THRESHOLDS;
  const temp = Number(day.tempMaxF);
  const low  = Number(day.tempMinF);
  const wind = Number(day.windMaxMph || 0);
  const gust = Number(day.gustMaxMph || wind);
  const rain = Number(day.precipInches || 0);

  const wetForecast = mode === 'forecast' && Number(day.precipProbabilityMaxPct || 0) >= t.dailyRainProbPct;
  const wetClimate  = mode === 'climate'  && Number(day.wetDayFrequencyPct || 0) >= t.climateWetDayPct;

  const tempCollapse = Number(day.tempDropF || 0) >= t.severeTempDropF;

  if (rain >= t.dailyRainIn || wetForecast || wetClimate ||
      isRainyWeatherCode(day.weatherCode) || gust >= t.alertGustMph || tempCollapse) {
    return { state: 'alert', ...RISK_COPY.alert };
  }
  if (wind >= t.warnWindMph || gust >= t.warnGustMph ||
      (Number.isFinite(temp) && temp >= t.hotF) || (Number.isFinite(low) && low <= t.coldF)) {
    return { state: 'warn', ...RISK_COPY.warn };
  }
  return { state: 'ok', ...RISK_COPY.ok };
}

async function initEventSchedule(context) {
  const body = document.querySelector('[data-event-schedule-body]');
  if (!body) return;
  try {
    window.raceTrackerCalendar.subscribe(data => {
      if (data.status === 'connected') renderEventSchedule({ ...data, sourceStatus: 'connected' }, context.tracks);
      else setText('[data-event-source-status]', 'Calendar unavailable');
    });
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
    setText('[data-team-staff-count]', `${data.mechanics.length} profiles`);
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

// ── Pre-Tech / Safety Tech Checklist ────────────────────────────
// Modeled on the NKA Rulebook (nkaonline.com/rules — the literal Pre-Tech
// Submission form itself is gated behind an NKA email request, so this
// mirrors the checklist items §10.4.12 says that form must cover) §10.4.12:
// entrants fill out and sign a Technical/Safety Inspection Form before
// entering the grid for qualifying. Items below come from §10.4.6 (safety
// gear), §10.4.10 (weight/ballast) and §10.4.11 (Safety Tech Standards —
// the nylock-nut/safety-wire connections). The mechanic daily sign-off
// sheet on the Workshop page reuses this exact item list.

const PRETECH_ITEMS = [
  { id: 'helmet',          label: 'Helmet meets spec and is in-date (Snell M/SA2015, CMR/CMS2016 Youth, or FIA 8859-2015 / 8860-2010 / 8860-2018)' },
  { id: 'neck-collar',     label: 'Neck collar worn — mandatory Rookie/Junior, recommended Senior' },
  { id: 'chest-protector', label: 'Chest protector worn, SFI 20.1 spec — required Rookie/Junior up to 13' },
  { id: 'pedals',          label: 'Pedals (brake & throttle) — nylock nut and/or safety wired' },
  { id: 'brake-rods',      label: 'Brake rods & safety tether — nylock nut and/or safety wired' },
  { id: 'master-cylinder', label: 'Master cylinder to frame — nylock nut and/or safety wired' },
  { id: 'calipers',        label: 'Calipers to frame/spindle — nylock nut and/or safety wired' },
  { id: 'rotor-hub',       label: 'Rotor-to-hub bolts & kingpins — mechanical lock nuts' },
  { id: 'steering-shaft',  label: 'Steering shaft to frame — nylock nut and/or safety wired' },
  { id: 'tie-rods',        label: 'Tie rods, all mounting points — nylock nut and/or safety wired' },
  { id: 'steering-hub',    label: 'Steering hub to steering shaft — nylock nut and/or safety wired' },
  { id: 'steering-wheel',  label: 'Steering wheel to steering hub, min. 3 points — nylock nut and/or safety wired' },
  { id: 'third-bearing',   label: 'Third bearing support bolts, min. 2 — nylock nut and/or safety wired' },
  { id: 'weight',          label: "Ballast bolted per spec (white, kart number marked); none on the driver or the chassis underside" }
];

function renderPreTechChecklist(container, prefix) {
  if (!container) return;
  container.innerHTML = PRETECH_ITEMS.map(item => `
    <label class="pretech-item">
      <input type="checkbox" name="${escapeHtml(prefix)}-${escapeHtml(item.id)}" data-pretech-check="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.label)}</span>
    </label>
  `).join('');
}

function readPreTechItems(checklist) {
  const items = {};
  PRETECH_ITEMS.forEach(item => {
    const box = checklist.querySelector(`[data-pretech-check="${item.id}"]`);
    items[item.id] = !!(box && box.checked);
  });
  return items;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// -- Driver submission (registrations.html) -----------------------------
const PRETECH_DRIVER_KEY = 'raceTracker.preTechDriverSubmissions';

function initPreTechDriverForm() {
  const form = document.querySelector('[data-pretech-driver-form]');
  if (!form) return;
  const checklist = form.querySelector('[data-pretech-checklist]');
  renderPreTechChecklist(checklist, 'driver');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const driverName = (data.get('driverName') || '').trim();
    if (!driverName) return;
    const items = readPreTechItems(checklist);
    const submission = {
      id: `pretech-${Date.now()}`,
      entityId: activeEntityId(),
      driverName,
      kart: data.get('kart') || '',
      className: data.get('className') || '',
      event: data.get('event') || '',
      notes: data.get('notes') || '',
      items,
      complete: Object.values(items).every(Boolean),
      submittedAt: new Date().toISOString()
    };
    const all = getPreTechDriverSubmissions();
    all.unshift(submission);
    try { localStorage.setItem(PRETECH_DRIVER_KEY, JSON.stringify(all)); } catch {}
    form.reset();
    renderPreTechChecklist(checklist, 'driver');
    renderPreTechDriverList();
  });

  renderPreTechDriverList();
}

function getPreTechDriverSubmissions() {
  try { return JSON.parse(localStorage.getItem(PRETECH_DRIVER_KEY) || '[]'); } catch { return []; }
}

function renderPreTechDriverList() {
  const body = document.querySelector('[data-pretech-driver-list]');
  if (!body) return;
  const rows = getPreTechDriverSubmissions();
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="reg-empty">No pre-tech submissions yet.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.driverName)}</td>
      <td>${escapeHtml(r.kart || '—')}</td>
      <td>${escapeHtml(r.className || '—')}</td>
      <td>${escapeHtml(r.event || '—')}</td>
      <td>${escapeHtml(new Date(r.submittedAt).toLocaleString())}</td>
      <td><span class="badge ${r.complete ? 'ok' : 'warn'}">${r.complete ? 'Complete' : 'Incomplete'}</span></td>
    </tr>
  `).join('');
}

// -- Mechanic daily sign-off (workshop.html + supervisor.html) ----------
// Stored server-side in D1 `pretech_signoffs`, keyed to the Access-verified
// profile — not localStorage — so "who signed off" is a verified fact, not a
// client-side name string. One sign-off per mechanic per business per day
// (unique index in migrations/0001_init.sql). The Worker decides which rows a
// caller may read; this function just asks.

async function fetchPreTechSignoffs({ entityId, dateFrom, dateTo, profileId } = {}) {
  const params = new URLSearchParams();
  if (entityId) params.set('entity', entityId);
  if (dateFrom) params.set('from', dateFrom);
  if (dateTo) params.set('to', dateTo);
  if (profileId) params.set('profile', profileId);
  try {
    const data = await window.raceTrackerAuth.apiFetch(`/api/pretech/signoffs?${params}`);
    return data?.signoffs || [];
  } catch (err) {
    console.error('fetchPreTechSignoffs failed', err);
    return [];
  }
}

function initPreTechMechanicChecklist() {
  const form = document.querySelector('[data-pretech-mechanic-form]');
  if (!form) return;
  const checklist = form.querySelector('[data-pretech-checklist]');
  renderPreTechChecklist(checklist, 'mechanic');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = await window.raceTrackerAuth.currentProfile();
    if (!profile) return;
    const data = new FormData(form);
    const items = readPreTechItems(checklist);
    // profile_id and signed_at are the server's to decide — it takes the
    // signer from the verified Access token, so this body cannot sign off on
    // anyone else's behalf even if it tried.
    const record = {
      entity_id: activeEntityId(),
      kart: data.get('kart') || '',
      notes: data.get('notes') || '',
      items,
      signoff_date: todayKey()
    };
    const status = form.querySelector('[data-pretech-save-status]');
    try {
      await window.raceTrackerAuth.apiFetch('/api/pretech/signoffs', {
        method: 'POST',
        body: JSON.stringify(record)
      });
    } catch (err) {
      // The form keeps what was typed. Never report a save the server refused.
      console.error('pretech signoff failed', err);
      if (status) { status.textContent = `Not saved — ${err.message}`; status.className = 'badge alert'; }
      return;
    }
    if (status) { status.textContent = 'Saved'; status.className = 'badge ok'; }
    form.reset();
    renderPreTechChecklist(checklist, 'mechanic');
    renderPreTechMechanicStatus();
  });

  document.addEventListener('racetracker:entitychange', renderPreTechMechanicStatus);

  renderPreTechMechanicStatus();
}

async function renderPreTechMechanicStatus() {
  const statusEl = document.querySelector('[data-pretech-mechanic-status]');
  const crewBody = document.querySelector('[data-pretech-crew-status]');
  if (!statusEl && !crewBody) return;

  const today = todayKey();
  const entityId = activeEntityId();
  const [signedToday, profile] = await Promise.all([
    fetchPreTechSignoffs({ entityId, dateFrom: today, dateTo: today }),
    window.raceTrackerAuth.currentProfile()
  ]);

  if (statusEl) {
    const mine = profile && signedToday.find(r => r.profile_id === profile.id);
    statusEl.textContent = mine
      ? `Signed off today at ${new Date(mine.signed_at).toLocaleTimeString()}`
      : 'Not signed off yet today';
    statusEl.classList.remove('ok', 'warn');
    statusEl.classList.add(mine ? 'ok' : 'warn');
  }

  if (crewBody) {
    let roster = [];
    try {
      roster = (await window.raceTrackerAuth.apiFetch('/api/profiles'))?.profiles || [];
    } catch (err) { console.error('profiles fetch failed', err); return; }
    crewBody.innerHTML = roster.map(m => {
      const signed = signedToday.find(r => r.profile_id === m.id);
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.role || '')}</td>
        <td><span class="badge ${signed ? 'ok' : 'alert'}">${signed ? 'Signed' : 'Not signed'}</span></td>
        <td>${signed ? escapeHtml(new Date(signed.signed_at).toLocaleTimeString()) : '—'}</td>
      </tr>`;
    }).join('');
  }
}

// -- Supervisor review (supervisor.html) ---------------------------------
// Admin-only in the UI (nav hidden via data-min-clearance="admin"), and
// backstopped for real in the Worker: a non-admin visiting this page directly
// still only gets their own history plus everyone's *today* rows back from
// /api/pretech/signoffs (see handleSignoffList in ops-api.js), never other
// people's past sign-offs. Hiding a nav link is not authorization.
const ENTITY_SHORT_LABEL = { 'evolution-kart-school': 'Evolution', 'the-kart-depot': 'TKD' };

function initSupervisorPage() {
  const crewGrid = document.querySelector('[data-supervisor-crew-grid]');
  const mechSelect = document.querySelector('[data-supervisor-mechanic-select]');
  const individualBody = document.querySelector('[data-supervisor-individual-body]');
  const fromInput = document.querySelector('[data-supervisor-from]');
  const toInput = document.querySelector('[data-supervisor-to]');
  if (!crewGrid && !mechSelect) return;

  const today = todayKey();
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  if (fromInput && !fromInput.value) fromInput.value = weekAgo;
  if (toInput && !toInput.value) toInput.value = today;

  let roster = [];

  async function loadRoster() {
    try {
      roster = (await window.raceTrackerAuth.apiFetch('/api/profiles'))?.profiles || [];
    } catch (err) { console.error('supervisor roster fetch failed', err); return; }
    if (mechSelect) {
      const selected = mechSelect.value;
      mechSelect.innerHTML = '<option value="">— pick mechanic —</option>' +
        roster.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === selected ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
    }
  }

  async function renderCrew() {
    if (!crewGrid) return;
    const entityId = activeEntityId();
    const dateFrom = fromInput?.value || today;
    const dateTo = toInput?.value || today;
    const [rangeRows, todayRows] = await Promise.all([
      fetchPreTechSignoffs({ entityId, dateFrom, dateTo }),
      fetchPreTechSignoffs({ entityId, dateFrom: today, dateTo: today })
    ]);
    const totalDays = Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1);
    crewGrid.innerHTML = roster.map(m => {
      const signedToday = todayRows.some(r => r.profile_id === m.id);
      const daysSigned = new Set(rangeRows.filter(r => r.profile_id === m.id).map(r => r.signoff_date)).size;
      return `
        <div class="team-person-card">
          <div class="team-person-header">
            <span class="team-person-name">${escapeHtml(m.name)}</span>
            <span class="badge ${signedToday ? 'ok' : 'alert'}">${signedToday ? 'Signed today' : 'Not signed'}</span>
          </div>
          <div class="team-person-role">${escapeHtml(m.role || '')}</div>
          <div class="team-person-shift">${daysSigned}/${totalDays} days signed in range</div>
        </div>`;
    }).join('');
  }

  async function renderIndividual() {
    if (!individualBody || !mechSelect) return;
    if (!mechSelect.value) {
      individualBody.innerHTML = '<tr><td colspan="6" class="reg-empty">Pick a mechanic to load their sheet.</td></tr>';
      return;
    }
    const dateFrom = fromInput?.value || today;
    const dateTo = toInput?.value || today;
    const rows = await fetchPreTechSignoffs({ dateFrom, dateTo, profileId: mechSelect.value });
    if (!rows.length) {
      individualBody.innerHTML = '<tr><td colspan="6" class="reg-empty">No sign-offs in this range.</td></tr>';
      return;
    }
    individualBody.innerHTML = rows.map(r => {
      const itemLines = PRETECH_ITEMS.map(item =>
        `<div>${r.items?.[item.id] ? '✓' : '✕'} ${escapeHtml(item.label)}</div>`
      ).join('');
      return `<tr>
        <td>${escapeHtml(r.signoff_date)}</td>
        <td>${escapeHtml(ENTITY_SHORT_LABEL[r.entity_id] || r.entity_id)}</td>
        <td>${escapeHtml(r.kart || '—')}</td>
        <td><span class="badge ${r.complete ? 'ok' : 'warn'}">${r.complete ? 'Complete' : 'Incomplete'}</span></td>
        <td>${escapeHtml(new Date(r.signed_at).toLocaleTimeString())}</td>
        <td><details><summary>Items</summary>${itemLines}${r.notes ? `<p class="muted-copy">${escapeHtml(r.notes)}</p>` : ''}</details></td>
      </tr>`;
    }).join('');
  }

  fromInput?.addEventListener('change', () => { renderCrew(); renderIndividual(); });
  toInput?.addEventListener('change', () => { renderCrew(); renderIndividual(); });
  mechSelect?.addEventListener('change', renderIndividual);
  document.addEventListener('racetracker:entitychange', renderCrew);

  loadRoster().then(renderCrew);
}

// ── Billing module ────────────────────────────────────────────

const BILLING_KEY = 'raceTracker.billing';
let stopBillingCalendar;

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
  stopBillingCalendar?.();

  const [billingData, scheduleData, mechanicsData] = await Promise.all([
    fetchJson('/assets/data/billing.json'),
    window.raceTrackerCalendar.refresh(),
    fetchJson('/assets/data/mechanics.json')
  ]);

  const seedExpenses = billingData?.expenses || [];
  const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
  const storedIds = new Set(stored.map(e => e.id));
  const allExpenses = [...stored, ...seedExpenses.filter(e => !storedIds.has(e.id))];

  const events   = [...(scheduleData?.events || [])];
  const drivers  = (mechanicsData?.driverRoster || [{ id: 'driver-1', name: 'Driver' }]);
  const profile  = await window.raceTrackerAuth.currentProfile();
  const profileName = profile?.name || 'Guest';
  const clearance = profile?.clearance || 'staff';

  const rerender = () => {
    // Untagged expenses belong to nobody's books, so they show under whichever
    // business is selected rather than disappearing behind the filter.
    const scoped = allExpenses.filter(e =>
      !activeEntityId() || !e.entityId || e.entityId === activeEntityId());
    renderBillingLedger(scoped, drivers, events, clearance, profileName);
    updateBillingKpis(scoped);
  };

  populateBillingFilters(drivers, events, rerender);
  populateExpenseForm(drivers, events, profileName);
  wireBillingForm(drivers, events, profileName, allExpenses, rerender);
  // Choices track the same published IDs as Schedule. Existing expense labels
  // remain historical records; never remap them by guessing similar names.
  stopBillingCalendar = window.raceTrackerCalendar.subscribe(snapshot => {
    events.splice(0, events.length, ...snapshot.events);
    for (const selector of ['[data-billing-event-filter]', '[data-expense-event-select]']) {
      const select = document.querySelector(selector);
      if (!select) continue;
      const selected = select.value;
      while (select.options.length > 1) select.remove(1);
      events.forEach(event => select.add(new Option(event.name, event.id)));
      select.value = [...select.options].some(option => option.value === selected) ? selected : select.options[0].value;
      select.disabled = snapshot.status !== 'connected';
    }
    rerender();
    const form = document.querySelector('[data-add-expense-form]');
    if (form) {
      form.dataset.calendarReady = String(snapshot.status === 'connected');
      let notice = form.querySelector('[data-billing-calendar-status]');
      if (!notice) { notice = document.createElement('p'); notice.dataset.billingCalendarStatus = ''; notice.setAttribute('role', 'status'); form.prepend(notice); }
      notice.textContent = window.raceTrackerCalendar.statusText(snapshot);
    }
  });
  showAddFormByRole(clearance);
  // Switching business re-scopes the ledger; the two sets of books never mix.
  document.addEventListener('racetracker:entitychange', rerender);
  rerender();
}

async function fetchJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? r.json() : null; } catch { return null; }
}

function populateBillingFilters(drivers, events, rerender) {
  const driverFilter = document.querySelector('[data-billing-driver-filter]');
  const eventFilter  = document.querySelector('[data-billing-event-filter]');
  if (driverFilter) {
    drivers.forEach(d => {
      const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; driverFilter.appendChild(o);
    });
    driverFilter.addEventListener('change', rerender);
  }
  if (eventFilter) {
    events.forEach(ev => {
      const o = document.createElement('option'); o.value = ev.id; o.textContent = ev.name; eventFilter.appendChild(o);
    });
    eventFilter.addEventListener('change', rerender);
  }
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
        <td>${approvalBadge}${approveBtn}${e.entityId ? '' : ' <span class="badge warn" title="No owning business recorded">Unassigned</span>'}</td>
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

function wireBillingForm(drivers, events, profile, allExpenses, rerender) {
  const form = document.querySelector('[data-add-expense-form]');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(form);
    const driverSel = fd.get('driverId');
    const eventSel  = fd.get('eventId');
    if (!navigator.onLine || form.dataset.calendarReady !== 'true' || !events.some(event => event.id === eventSel)) return;
    const driverName = drivers.find(d => d.id === driverSel)?.name || driverSel;
    const ev = events.find(ev => ev.id === eventSel);
    const expense = {
      id:             `exp-${Date.now()}`,
      entityId:       activeEntityId(),
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
    rerender();
    form.reset();
    document.querySelector('[data-billing-logged-by]').textContent = profile;
  });
}

window.approveBillingExpense = async function(id) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(BILLING_KEY) || '[]'); } catch { return []; } })();
  const exp = stored.find(e => e.id === id);
  if (!exp) return;
  const profile = await window.raceTrackerAuth.currentProfile();
  exp.approvalStatus = 'approved';
  exp.approvedBy = profile?.name || 'Admin';
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
  'winter-series':       'Winter Series',
  'pro-tour':            'Pro Tour',
  'pkc':                 'California ProKart Challenge (PKC)',
  'supernats':           'SuperNationals',
  'rok-sonoma-tc1-2027': 'ROK Sonoma 2027 — Triple Crown 1'
};

const SERIES_SHORT = {
  'ckna':               'CKNA',
  'rok-cup-usa':        'ROK Cup',
  'skusa':              'SKUSA',
  'stars':              'STARS',
  'uspks':              'USPKS',
  'tsrs':               'TSRS',
  'route66':            'Route 66',
  'challenge-americas': 'COTA',
  'us-rotax':           'Rotax',
  'wka-mancup':         'WKA'
};

const ENGINE_LABELS = {
  '2-stroke': '2-Stroke',
  '4-stroke': '4-Stroke',
  'mixed':    'Mixed',
  'unknown':  'Unknown'
};

function roundEngineType(series, round) {
  return round.engineType || series.engineType || 'unknown';
}

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

  const wx = await loadRaceWeather();

  const allRounds = [];
  data.series.forEach(series => {
    series.rounds.forEach(round => {
      allRounds.push({
        ...round,
        _seriesId:    series.id,
        _seriesName:  series.name,
        _seriesShort: SERIES_SHORT[series.id] || series.id.toUpperCase(),
        _website:     series.website || null,
        _engineType:  roundEngineType(series, round),
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

  if (nextUpEl) renderCalNextUp(upcoming.slice(0, 8), conflictIds, nextUpEl, wx);
  if (calBody)  renderCalBody(data.series, allRounds, conflictIds, calBody, wx);

  renderRaceWeatherStatus(wx, data);
  const next = allRounds.find(r => r._timeStatus === 'next');
  if (next) refreshImminentRaceWeather(next, wx, { nextUpEl, calBody, conflictIds, upcoming });
}

// ── Race weekend weather ──────────────────────────────────────
//
// race-weather.json is generated daily by scripts/refresh_race_weather.py.
// Everything below degrades to an em dash when that file is missing, so the
// calendar keeps working exactly as it did before the weather feature existed.

const RACE_WX_STALE_DAYS = 3;
const LIVE_WX_WINDOW_DAYS = 3;

async function loadRaceWeather() {
  const empty = { index: new Map(), meta: null, stale: true, ageDays: null };
  const data = await fetchJson('/assets/data/race-weather.json');
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.weekends)) return empty;

  const index = new Map();
  data.weekends.forEach(entry => { if (entry && entry.key) index.set(entry.key, entry); });

  const updated = Date.parse(data.updatedAt);
  const ageDays = Number.isFinite(updated) ? (Date.now() - updated) / 86400000 : null;
  return {
    index,
    meta: data,
    ageDays,
    stale: ageDays === null || ageDays > RACE_WX_STALE_DAYS
  };
}

function raceWeatherFor(wx, round) {
  if (!wx || !wx.index.size) return null;
  return wx.index.get(calRoundKey(round)) || null;
}

// A climate normal does not decay in a few days; only real forecasts go stale.
function entryIsStale(wx, entry) {
  return Boolean(wx && wx.stale && entry && entry.mode === 'forecast');
}

const WX_MODE_TAGS = {
  forecast:    'Forecast',
  climate:     'Normal',
  actual:      'Recorded',
  live:        'Live',
  unavailable: ''
};

function raceWeatherModeTag(entry) {
  const label = WX_MODE_TAGS[entry.mode] || '';
  if (!label) return '';
  return `<span class="wx-mode-tag wx-mode-tag--${escapeHtml(entry.mode)}">${escapeHtml(label)}</span>`;
}

function raceWeatherBadgeHtml(entry, wx) {
  if (!entry || entry.mode === 'unavailable' || !entry.summary) {
    const why = entry && entry.modeLabel ? ` title="${escapeHtml(entry.modeLabel)}"` : '';
    return `<span class="cal-wx-empty"${why}>—</span>`;
  }
  const s = entry.summary;
  const state = (s.risk && s.risk.state) || 'ok';
  const bits = [];
  if (s.tempMaxF != null)  bits.push(`${Math.round(s.tempMaxF)}°`);
  if (s.gustMaxMph != null) bits.push(`${Math.round(s.gustMaxMph)}g`);
  if (s.precipInches != null && s.precipInches > 0) bits.push(`${s.precipInches.toFixed(2)}"`);
  const stale = entryIsStale(wx, entry) ? ' · stale' : '';
  const title = `${entry.modeLabel || ''} — ${s.headline || ''}${stale}`.trim();
  return `<span class="badge ${escapeHtml(state)} wx-badge" title="${escapeHtml(title)}">${escapeHtml(bits.join(' · ') || '—')}</span>${raceWeatherModeTag(entry)}`;
}

function renderRaceWeatherCell(entry, key, wx) {
  const badge = raceWeatherBadgeHtml(entry, wx);
  if (!entry || entry.mode === 'unavailable' || !entry.days || !entry.days.length) return badge;
  return `<button type="button" class="cal-wx-toggle" data-wx-toggle="${escapeHtml(key)}"
    aria-expanded="false" aria-label="Show weather detail for ${escapeHtml(entry.name || key)}">${badge}</button>`;
}

function renderRaceWeatherDetail(entry, wx) {
  if (!entry || !entry.days || !entry.days.length) return '';

  const days = entry.days.map(day => {
    const state = (day.risk && day.risk.state) || 'ok';
    const rows = [
      day.tempMaxF != null ? `${Math.round(day.tempMaxF)}° / ${day.tempMinF != null ? Math.round(day.tempMinF) + '°' : '—'}` : null,
      day.windMaxMph != null ? `${Math.round(day.windMaxMph)} mph, gust ${day.gustMaxMph != null ? Math.round(day.gustMaxMph) : '—'}` : null,
      day.precipInches != null ? `${day.precipInches.toFixed(2)} in` : null,
      day.precipProbabilityMaxPct != null ? `${day.precipProbabilityMaxPct}% chance of rain` : null,
      day.wetDayFrequencyPct != null ? `wet ${day.wetDayFrequencyPct}% of past seasons` : null
    ].filter(Boolean);
    return `
      <div class="cal-wx-day">
        <div class="cal-wx-day-label">${escapeHtml(day.weekdayLabel || day.date)}
          <span class="badge ${escapeHtml(state)} wx-badge"></span></div>
        <div class="cal-wx-day-metrics">${rows.map(escapeHtml).join('<br>')}</div>
      </div>`;
  }).join('');

  const prep = (entry.prep || []).map(p => `<li>${escapeHtml(p)}</li>`).join('');
  const source = [
    entry.modeLabel,
    entry.confidence ? `confidence: ${entry.confidence}` : '',
    entryIsStale(wx, entry) && wx.ageDays != null ? `data ${Math.round(wx.ageDays)} days old` : ''
  ].filter(Boolean).join(' · ');

  return `
    <div class="cal-wx-detail">
      <div class="cal-wx-days">${days}</div>
      ${prep ? `<ul class="cal-wx-prep">${prep}</ul>` : ''}
      <p class="cal-wx-source">${escapeHtml(source)}</p>
    </div>`;
}

// One delegated listener rather than an onclick per row.
function wireRaceWeatherToggles(root) {
  if (!root || root.dataset.wxWired === '1') return;
  root.dataset.wxWired = '1';
  root.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wx-toggle]');
    if (!button || !root.contains(button)) return;
    const key = button.getAttribute('data-wx-toggle');
    const detail = root.querySelector(`[data-wx-detail="${CSS.escape(key)}"]`);
    if (!detail) return;
    const open = detail.classList.toggle('is-open');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function renderRaceWeatherStatus(wx, calendar) {
  const badge = document.querySelector('[data-wx-stale]');
  if (!badge) return;
  const warnings = (wx.meta && wx.meta.calendarHealth && wx.meta.calendarHealth.warnings) || [];
  let message = '';
  if (!wx.meta) {
    message = 'Weather data not generated yet';
  } else if (wx.stale && wx.ageDays != null) {
    message = `Weather data ${Math.round(wx.ageDays)} days old`;
  } else if (warnings.length) {
    message = `${warnings.length} calendar warning${warnings.length > 1 ? 's' : ''}`;
  }
  badge.hidden = !message;
  if (message) {
    badge.textContent = message;
    badge.title = warnings.join('\n') || `Generated by ${(wx.meta && wx.meta.generator) || 'the refresh job'}`;
  }
  if (calendar) setText('[data-cal-updated]', `Calendar updated ${calendar.updatedAt || 'unknown'}`);
}

// For the race happening within a few days, go straight to Open-Meteo so the
// page is right even if the daily refresh job has not run. Public, key-free API.
async function refreshImminentRaceWeather(round, wx, ctx) {
  const entry = raceWeatherFor(wx, round);
  if (!entry || entry.latitude == null || entry.longitude == null) return;
  const start = new Date(entry.dateStart + 'T12:00:00');
  const lead = Math.round((start - Date.now()) / 86400000);
  if (lead < -LIVE_WX_WINDOW_DAYS || lead > LIVE_WX_WINDOW_DAYS) return;

  const params = new URLSearchParams({
    latitude: String(entry.latitude),
    longitude: String(entry.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max',
    start_date: entry.dateStart,
    end_date: entry.dateEnd || entry.dateStart,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: entry.timezone || 'auto'
  });

  let daily;
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
    daily = (await res.json()).daily;
    if (!daily || !Array.isArray(daily.time) || !daily.time.length) throw new Error('No daily rows');
  } catch {
    return; // keep whatever the generated file gave us
  }

  const days = daily.time.map((date, i) => {
    const day = {
      date,
      weekdayLabel: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      dayIndex: i,
      tempMaxF: daily.temperature_2m_max?.[i] ?? null,
      tempMinF: daily.temperature_2m_min?.[i] ?? null,
      windMaxMph: daily.wind_speed_10m_max?.[i] ?? null,
      gustMaxMph: daily.wind_gusts_10m_max?.[i] ?? null,
      precipInches: daily.precipitation_sum?.[i] ?? null,
      precipProbabilityMaxPct: daily.precipitation_probability_max?.[i] ?? null,
      weatherCode: daily.weather_code?.[i] ?? null
    };
    day.risk = classifyRaceDayRisk(day, 'forecast');
    return day;
  });

  const live = { ...entry, mode: 'live', modeLabel: `Live — updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, confidence: 'high', days };
  live.summary = summarizeRaceDays(days);
  wx.index.set(entry.key, live);
  wx.stale = false;

  if (ctx && ctx.nextUpEl && ctx.upcoming) renderCalNextUp(ctx.upcoming, ctx.conflictIds, ctx.nextUpEl, wx);
  if (ctx && ctx.calBody) {
    const cell = ctx.calBody.querySelector(`[data-wx-toggle="${CSS.escape(entry.key)}"]`);
    if (cell) cell.innerHTML = raceWeatherBadgeHtml(live, wx);
    const detail = ctx.calBody.querySelector(`[data-wx-detail="${CSS.escape(entry.key)}"] td`);
    if (detail) detail.innerHTML = renderRaceWeatherDetail(live, wx);
  }
}

// Client-side roll-up mirroring summarize() in scripts/refresh_race_weather.py.
function summarizeRaceDays(days) {
  const pick = (field) => days.map(d => d[field]).filter(v => v != null);
  const highs = pick('tempMaxF'), lows = pick('tempMinF');
  const winds = pick('windMaxMph'), gusts = pick('gustMaxMph');
  const rains = pick('precipInches'), probs = pick('precipProbabilityMaxPct');

  const order = { ok: 0, warn: 1, alert: 2 };
  let state = 'ok';
  days.forEach(d => {
    const s = (d.risk && d.risk.state) || 'ok';
    if (order[s] > order[state]) state = s;
  });

  const summary = {
    tempMaxF: highs.length ? Math.max(...highs) : null,
    tempMinF: lows.length ? Math.min(...lows) : null,
    windMaxMph: winds.length ? Math.max(...winds) : null,
    gustMaxMph: gusts.length ? Math.max(...gusts) : null,
    precipInches: rains.length ? Number(rains.reduce((a, b) => a + b, 0).toFixed(2)) : null,
    precipProbabilityMaxPct: probs.length ? Math.max(...probs) : null,
    risk: { state, ...RISK_COPY[state] }
  };
  const bits = [];
  if (summary.tempMaxF != null) bits.push(`${Math.round(summary.tempMaxF)}°F`);
  if (summary.gustMaxMph != null) bits.push(`${Math.round(summary.gustMaxMph)} mph gusts`);
  if (summary.precipInches != null) bits.push(`${summary.precipInches.toFixed(2)} in`);
  summary.headline = bits.join(' · ') || 'No data';
  return summary;
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

// Division is part of the key: CKNA reuses round numbers 1/2/3 across its
// south/east/north divisions, so seriesId+round alone is ambiguous.
// scripts/refresh_race_weather.py must build weekend keys the same way.
function calRoundKey(round) {
  return `${round._seriesId}:${round.division || 'main'}:${round.round}`;
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

function renderCalNextUp(upcoming, conflictIds, container, wx) {
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
        <span class="cal-nextup-wx">${raceWeatherBadgeHtml(raceWeatherFor(wx, r), wx)}</span>
        <span class="cal-nextup-flags">
          ${isNext     ? '<span class="badge ok">Next</span>' : ''}
          ${isConflict ? '<span class="badge warn">⚡ Conflict</span>' : ''}
        </span>
      </div>`;
  }).join('');
}

// Both filter rows write through here. Two independent handlers each setting
// style.display would fight each other, so state lives in one place.
// US-only scope, so there is no country axis to filter on. See CLAUDE.md.
const calFilterState = { series: 'all', engine: '2-stroke' };

function applyCalFilters(calBody) {
  if (!calBody) return;
  let visibleRounds = 0;
  calBody.querySelectorAll('.cal-series').forEach(block => {
    const seriesMatch = calFilterState.series === 'all'
      || block.getAttribute('data-series-id') === calFilterState.series;

    let shown = 0;
    block.querySelectorAll('.cal-round-row').forEach(row => {
      const engine  = row.getAttribute('data-engine') || 'unknown';
      // A "mixed" series runs both platforms, so it belongs in either view.
      const engineMatch = calFilterState.engine === 'all'
        || engine === calFilterState.engine
        || engine === 'mixed';
      const visible = seriesMatch && engineMatch;
      row.style.display = visible ? '' : 'none';
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('cal-wx-detail-row')) {
        detail.style.display = visible ? '' : 'none';
        if (!visible) detail.classList.remove('is-open');
      }
      if (visible) shown++;
    });

    // Hide a division whose rows are all filtered out, then the series block.
    block.querySelectorAll('.cal-division').forEach(div => {
      const any = [...div.querySelectorAll('.cal-round-row')].some(r => r.style.display !== 'none');
      div.style.display = any ? '' : 'none';
    });
    block.style.display = shown ? '' : 'none';
    visibleRounds += shown;
  });

  setText('[data-cal-round-count]', String(visibleRounds));
  const engineNote = calFilterState.engine === 'all'
    ? 'all engines' : (ENGINE_LABELS[calFilterState.engine] || calFilterState.engine).toLowerCase();
  setText('[data-cal-engine-note]', `${engineNote} · US only`);
}

function buildCalPillRow(row, pills, stateKey, calBody) {
  if (!row) return;
  row.innerHTML = pills.map(p =>
    `<button type="button" class="series-pill${p.id === calFilterState[stateKey] ? ' active' : ''}" data-filter="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`
  ).join('');
  row.querySelectorAll('.series-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.series-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calFilterState[stateKey] = btn.getAttribute('data-filter');
      applyCalFilters(calBody);
    });
  });
}

function renderCalBody(seriesList, allRounds, conflictIds, calBody, wx) {
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
          <thead><tr><th>Date</th><th>Event</th><th>Track</th><th>Location</th><th>Weather</th></tr></thead>
          <tbody>${divRounds.map(r => renderCalRow(r, conflictIds, wx)).join('')}</tbody>
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
            ${series.scheduleUrl ? `<a href="${escapeHtml(series.scheduleUrl)}" target="_blank" rel="noopener" class="cal-series-link">Official Schedule ↗</a>` : series.website ? `<a href="${escapeHtml(series.website)}" target="_blank" rel="noopener" class="cal-series-link">Website ↗</a>` : ''}
          </div>
        </div>
        ${divBlocks}
      </div>`;
  }).join('');

  buildCalPillRow(
    document.querySelector('[data-series-filter]'),
    [{ id: 'all', label: 'All Series' },
     ...seriesList.map(s => ({ id: s.id, label: SERIES_SHORT[s.id] || s.id }))],
    'series', calBody
  );
  buildCalPillRow(
    document.querySelector('[data-engine-filter]'),
    [{ id: '2-stroke', label: '2-Stroke' },
     { id: '4-stroke', label: '4-Stroke' },
     { id: 'all',      label: 'All Engines' }],
    'engine', calBody
  );
  wireRaceWeatherToggles(calBody);
  applyCalFilters(calBody);
}

function renderCalRow(round, conflictIds, wx) {
  const isPast      = round._timeStatus === 'past';
  const isNext      = round._timeStatus === 'next';
  const isVenueTba  = round.status === 'venue-tba';
  const isCancelled = round.status === 'cancelled';
  const isConflict  = conflictIds.has(calRoundKey(round));
  const isDouble    = (round.note || '').toLowerCase().includes('double');

  const rowClass = isCancelled ? ' cal-row-cancelled'
    : isPast ? ' cal-row-past' : isNext ? ' cal-row-next' : '';
  const trackCell = isVenueTba
    ? `${escapeHtml(round.track)} <span class="badge warn" style="font-size:.62rem;vertical-align:middle;">TBA</span>`
    : escapeHtml(round.track || 'TBD');

  const flags = [
    isNext     ? `<span class="badge ok"     style="font-size:.62rem;">Next</span>` : '',
    isConflict ? `<span class="badge warn"   style="font-size:.62rem;">⚡ Conflict</span>` : '',
    isDouble    ? `<span class="badge"        style="font-size:.62rem;background:var(--accent-blue);color:#fff;">2×pts</span>` : '',
    isCancelled ? `<span class="badge alert"  style="font-size:.62rem;">Cancelled</span>` : '',
    round.sourceConfidence === 'unverified'
      ? `<span class="badge warn" style="font-size:.62rem;" title="Single-source date — verify against the official schedule">Unverified</span>` : ''
  ].filter(Boolean).join(' ');

  const key   = calRoundKey(round);
  const entry = raceWeatherFor(wx, round);
  const detail = renderRaceWeatherDetail(entry, wx);

  return `<tr class="cal-round-row${rowClass}" data-engine="${escapeHtml(round._engineType || 'unknown')}">
    <td class="cal-date-cell">${escapeHtml(formatCalDate(round))}</td>
    <td>${escapeHtml(round.name)}${flags ? ' ' + flags : ''}</td>
    <td>${trackCell}</td>
    <td class="cal-city-cell">${escapeHtml(round.trackCity || '—')}</td>
    <td class="cal-wx-cell">${renderRaceWeatherCell(entry, key, wx)}</td>
  </tr>${detail ? `<tr class="cal-wx-detail-row" data-wx-detail="${escapeHtml(key)}"><td colspan="5">${detail}</td></tr>` : ''}`;
}

// ── Trigger sandbox ───────────────────────────────────────────
//
// Runs the shipped classifier against a scenario you control, so a threshold
// can be judged by the tire and engine call it produces before it is committed.
// classifyRaceDayRisk() and buildPrepLines() below are the same functions the
// schedule page and the refresh script use — nothing here is a mock.

const SANDBOX_STORAGE_KEY = 'raceTracker.weatherThresholdDraft';

// Mirrors build_prep() in scripts/refresh_race_weather.py. The phrasing is
// asserted against the Python in scripts/test_race_weather.py.
function buildPrepLines(days, summary, mode) {
  const t = WEATHER_THRESHOLDS;
  const prep = [];
  const wet = days.filter(d =>
    Number(d.precipInches || 0) >= t.dailyRainIn ||
    Number(d.precipProbabilityMaxPct || 0) >= t.dailyRainProbPct ||
    Number(d.wetDayFrequencyPct || 0) >= t.climateWetDayPct ||
    isRainyWeatherCode(d.weatherCode));
  if (wet.length) {
    prep.push(`Rain tires and wet setup — wet risk on ${wet.map(d => d.weekdayLabel).join(', ')}`);
  }
  const gust = Number(summary.gustMaxMph || 0);
  if (gust >= t.alertGustMph) {
    prep.push(`Gusts to ${gust.toFixed(0)} mph: recheck ride height and front-end toe after run 1`);
  } else if (gust >= t.warnGustMph) {
    prep.push(`Breezy — gusts near ${gust.toFixed(0)} mph; expect a loose entry down the straight`);
  }
  const high = summary.tempMaxF;
  const low = summary.tempMinF;
  if (high !== null && high !== undefined && high >= t.hotF) {
    prep.push(`Heat: ${Number(high).toFixed(0)}°F peak — drop tire pressures, plan driver cooling and hydration`);
  }
  if (low !== null && low !== undefined && low <= t.coldF) {
    prep.push(`Cold start: ${Number(low).toFixed(0)}°F low — warmers, richer jetting, longer out-laps`);
  }
  const drop = Number(summary.tempDropF || 0);
  if (drop >= t.severeTempDropF) {
    const collapse = days.find(d => Number(d.tempDropF || 0) >= t.severeTempDropF);
    const when = collapse ? ` on ${collapse.weekdayLabel}` : '';
    prep.push(`Track temp falls ${drop.toFixed(0)}°F day over day${when} — re-baseline pressures, ` +
              'richen the main a step, recheck clutch engagement');
  }
  if (!prep.length) {
    prep.push('Nothing unusual forecast — run the standard pressure and jetting baseline');
  }
  if (mode === 'climate') {
    prep.push('Based on past seasons, not a forecast — recheck inside 16 days');
  }
  return prep;
}

const SANDBOX_FIELDS = [
  { id: 'tempMaxF',                 label: 'Air temp max',      unit: '°F' },
  { id: 'tempMinF',                 label: 'Air temp min',      unit: '°F' },
  { id: 'tempDropF',                label: 'Drop vs prior day', unit: '°F' },
  { id: 'precipInches',             label: 'Precipitation',     unit: 'in' },
  { id: 'precipProbabilityMaxPct',  label: 'Rain probability',  unit: '%'  },
  { id: 'wetDayFrequencyPct',       label: 'Wet-day frequency', unit: '%'  },
  { id: 'windMaxMph',               label: 'Wind max',          unit: 'mph' },
  { id: 'gustMaxMph',               label: 'Gust max',          unit: 'mph' }
];

const SANDBOX_CODES = [
  { code: 1,  label: 'Mainly clear' },
  { code: 3,  label: 'Overcast' },
  { code: 61, label: 'Rain, slight' },
  { code: 65, label: 'Rain, heavy' },
  { code: 82, label: 'Showers, violent' },
  { code: 95, label: 'Thunderstorm' }
];

const SANDBOX_PRESETS = [
  { id: 'wet-finale', label: 'Wet Lake Erie finale', mode: 'forecast',
    day: { tempMaxF: 64, tempMinF: 52, tempDropF: 6, precipInches: 0.42,
           precipProbabilityMaxPct: 85, wetDayFrequencyPct: 0, windMaxMph: 16,
           gustMaxMph: 26, weatherCode: 61 } },
  { id: 'cold-snap', label: 'Overnight collapse', mode: 'forecast',
    day: { tempMaxF: 60, tempMinF: 44, tempDropF: 25, precipInches: 0,
           precipProbabilityMaxPct: 10, wetDayFrequencyPct: 0, windMaxMph: 10,
           gustMaxMph: 17, weatherCode: 1 } },
  { id: 'supernats', label: 'SuperNats desert week', mode: 'forecast',
    day: { tempMaxF: 74, tempMinF: 49, tempDropF: 4, precipInches: 0,
           precipProbabilityMaxPct: 5, wetDayFrequencyPct: 0, windMaxMph: 18,
           gustMaxMph: 30, weatherCode: 1 } },
  { id: 'summer-heat', label: 'New Castle July heat', mode: 'forecast',
    day: { tempMaxF: 95, tempMinF: 74, tempDropF: 0, precipInches: 0.02,
           precipProbabilityMaxPct: 20, wetDayFrequencyPct: 0, windMaxMph: 8,
           gustMaxMph: 14, weatherCode: 3 } },
  { id: 'climate-normal', label: 'Climate normal (far out)', mode: 'climate',
    day: { tempMaxF: 71, tempMinF: 55, tempDropF: 2, precipInches: 0.08,
           precipProbabilityMaxPct: 0, wetDayFrequencyPct: 55, windMaxMph: 9,
           gustMaxMph: 16, weatherCode: 3 } },
  { id: 'clear', label: 'Clear baseline', mode: 'forecast',
    day: { tempMaxF: 76, tempMinF: 58, tempDropF: 0, precipInches: 0,
           precipProbabilityMaxPct: 5, wetDayFrequencyPct: 0, windMaxMph: 7,
           gustMaxMph: 12, weatherCode: 1 } }
];

// Thresholds the sandbox exposes. rainyCodes is a list, not a dial, so it stays out.
const SANDBOX_THRESHOLDS = [
  { id: 'dailyRainIn',      label: 'Daily rain',        unit: 'in', tier: 'alert' },
  { id: 'dailyRainProbPct', label: 'Rain probability',  unit: '%',  tier: 'alert' },
  { id: 'climateWetDayPct', label: 'Wet-day frequency', unit: '%',  tier: 'alert' },
  { id: 'alertGustMph',     label: 'Gusts',             unit: 'mph', tier: 'alert' },
  { id: 'severeTempDropF',  label: 'Temp drop',         unit: '°F', tier: 'alert' },
  { id: 'warnWindMph',      label: 'Wind',              unit: 'mph', tier: 'warn' },
  { id: 'warnGustMph',      label: 'Gusts',             unit: 'mph', tier: 'warn' },
  { id: 'hotF',             label: 'Heat',              unit: '°F', tier: 'warn' },
  { id: 'coldF',            label: 'Cold',              unit: '°F', tier: 'warn' }
];

function initWeatherSandbox() {
  const root = document.querySelector('[data-weather-sandbox]');
  if (!root) return;

  const committed = { ...WEATHER_THRESHOLDS };
  let preset = SANDBOX_PRESETS[0];
  let mode = preset.mode;
  const day = { ...preset.day, date: '2026-09-26', weekdayLabel: 'Sat' };

  restoreThresholdDraft();

  root.innerHTML = `
    <div class="sbx-presets" data-sbx-presets>
      ${SANDBOX_PRESETS.map((p, i) =>
        `<button type="button" class="series-pill${i === 0 ? ' active' : ''}" data-sbx-preset="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`
      ).join('')}
    </div>
    <div class="sbx-grid">
      <div class="sbx-col">
        <h4 class="sbx-heading">Scenario</h4>
        <label class="sbx-metric sbx-mode">
          <span>Data mode</span>
          <select class="setup-input" data-sbx-mode>
            <option value="forecast">Forecast (within 16 days)</option>
            <option value="climate">Climate normal (further out)</option>
            <option value="actual">Recorded (past weekend)</option>
          </select>
        </label>
        <div class="sbx-metrics" data-sbx-metrics></div>
        <label class="sbx-metric">
          <span>Weather code</span>
          <select class="setup-input" data-sbx-code>
            ${SANDBOX_CODES.map(c => `<option value="${c.code}">${c.code} · ${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="sbx-col">
        <h4 class="sbx-heading">Call the crew gets <span class="badge ok" data-sbx-state>—</span></h4>
        <p class="mechanic-focus" data-sbx-guidance></p>
        <ul class="sbx-prep" data-sbx-prep></ul>
        <p class="sbx-why" data-sbx-why></p>
        <p class="sbx-page" data-sbx-page></p>
      </div>
    </div>
    <div class="sbx-thresholds">
      <div class="section-headline">
        <div>
          <h4 class="sbx-heading">Thresholds</h4>
          <p class="muted-copy">Draft values live in this browser only. Copy them out and paste into
            <code>WEATHER_THRESHOLDS</code> in <code>main.js</code> and <code>RISK_THRESHOLDS</code> in
            <code>refresh_race_weather.py</code> — validate_structure.py fails the build if the two disagree.</p>
        </div>
        <div class="sbx-threshold-actions">
          <button type="button" class="series-pill" data-sbx-copy>Copy both blocks</button>
          <button type="button" class="series-pill" data-sbx-reset>Reset to committed</button>
        </div>
      </div>
      <div class="sbx-rules" data-sbx-rules></div>
      <p class="sbx-copy-status" data-sbx-status></p>
    </div>`;

  const metricsEl = root.querySelector('[data-sbx-metrics]');
  const rulesEl   = root.querySelector('[data-sbx-rules]');
  const statusEl  = root.querySelector('[data-sbx-status]');

  metricsEl.innerHTML = SANDBOX_FIELDS.map(field => `
    <label class="sbx-metric">
      <span>${escapeHtml(field.label)} <em>${escapeHtml(field.unit)}</em></span>
      <input class="setup-input" type="number" step="any" data-sbx-field="${escapeHtml(field.id)}">
    </label>`).join('');

  rulesEl.innerHTML = ['alert', 'warn'].map(tier => `
    <div class="sbx-rule sbx-rule--${tier}">
      <div class="sbx-rule-head">
        <span class="badge ${tier === 'alert' ? 'alert' : 'warn'}">${tier === 'alert' ? 'Alert — pages the crew' : 'Watch — dashboard only'}</span>
      </div>
      <div class="sbx-conditions">
        ${SANDBOX_THRESHOLDS.filter(x => x.tier === tier).map(x => `
          <label class="sbx-condition">
            <span>${escapeHtml(x.label)}</span>
            <input class="setup-input" type="number" step="any" data-sbx-threshold="${escapeHtml(x.id)}">
            <em>${escapeHtml(x.unit)}</em>
          </label>`).join('')}
      </div>
    </div>`).join('');

  const syncInputs = () => {
    root.querySelector('[data-sbx-mode]').value = mode;
    root.querySelector('[data-sbx-code]').value = String(day.weatherCode);
    metricsEl.querySelectorAll('[data-sbx-field]').forEach(input => {
      input.value = day[input.getAttribute('data-sbx-field')];
    });
    rulesEl.querySelectorAll('[data-sbx-threshold]').forEach(input => {
      input.value = WEATHER_THRESHOLDS[input.getAttribute('data-sbx-threshold')];
    });
  };

  const evaluate = () => {
    const risk = classifyRaceDayRisk(day, mode);
    const summary = {
      tempMaxF: day.tempMaxF, tempMinF: day.tempMinF, tempDropF: day.tempDropF,
      gustMaxMph: day.gustMaxMph
    };
    const stateEl = root.querySelector('[data-sbx-state]');
    stateEl.textContent = risk.label;
    stateEl.classList.remove('ok', 'warn', 'alert');
    stateEl.classList.add(risk.state);
    root.querySelector('[data-sbx-guidance]').textContent = risk.guidance;
    root.querySelector('[data-sbx-prep]').innerHTML =
      buildPrepLines([day], summary, mode).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    root.querySelector('[data-sbx-why]').textContent = explainTriggers(day, mode);
    root.querySelector('[data-sbx-page]').textContent = risk.state === 'alert'
      ? `Inside ${RACE_WX_NOTIFY_WINDOW_DAYS} days of a race weekend this posts to the crew webhook.`
      : 'Shown on the schedule board; no webhook is sent.';
    rulesEl.querySelectorAll('.sbx-rule').forEach(el => {
      el.classList.toggle('sbx-rule--firing',
        el.classList.contains(`sbx-rule--${risk.state}`));
    });
  };

  metricsEl.addEventListener('input', (event) => {
    const key = event.target.getAttribute('data-sbx-field');
    if (!key) return;
    day[key] = event.target.value === '' ? 0 : Number(event.target.value);
    evaluate();
  });

  root.querySelector('[data-sbx-code]').addEventListener('change', (event) => {
    day.weatherCode = Number(event.target.value);
    evaluate();
  });

  root.querySelector('[data-sbx-mode]').addEventListener('change', (event) => {
    mode = event.target.value;
    evaluate();
  });

  rulesEl.addEventListener('input', (event) => {
    const key = event.target.getAttribute('data-sbx-threshold');
    if (!key || event.target.value === '') return;
    WEATHER_THRESHOLDS[key] = Number(event.target.value);
    saveThresholdDraft();
    statusEl.textContent = 'Draft thresholds saved in this browser. They do not affect the pipeline until copied out and committed.';
    evaluate();
  });

  root.querySelector('[data-sbx-presets]').addEventListener('click', (event) => {
    const id = event.target.getAttribute('data-sbx-preset');
    if (!id) return;
    const found = SANDBOX_PRESETS.find(p => p.id === id);
    if (!found) return;
    root.querySelectorAll('[data-sbx-preset]').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    preset = found;
    mode = found.mode;
    Object.assign(day, found.day);
    syncInputs();
    evaluate();
  });

  root.querySelector('[data-sbx-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(thresholdExport());
      statusEl.textContent = 'Copied. Paste the JS block into main.js and the Python block into refresh_race_weather.py — both, or the drift guard fails the build.';
    } catch {
      statusEl.textContent = 'Clipboard blocked. Edit WEATHER_THRESHOLDS and RISK_THRESHOLDS by hand.';
    }
  });

  root.querySelector('[data-sbx-reset]').addEventListener('click', () => {
    Object.assign(WEATHER_THRESHOLDS, committed);
    try { localStorage.removeItem(SANDBOX_STORAGE_KEY); } catch { /* storage unavailable */ }
    statusEl.textContent = 'Back to the committed thresholds.';
    syncInputs();
    evaluate();
  });

  function restoreThresholdDraft() {
    let draft;
    try { draft = JSON.parse(localStorage.getItem(SANDBOX_STORAGE_KEY) || 'null'); } catch { draft = null; }
    if (!draft) return;
    SANDBOX_THRESHOLDS.forEach(({ id }) => {
      if (typeof draft[id] === 'number') WEATHER_THRESHOLDS[id] = draft[id];
    });
  }

  function saveThresholdDraft() {
    const draft = {};
    SANDBOX_THRESHOLDS.forEach(({ id }) => { draft[id] = WEATHER_THRESHOLDS[id]; });
    try { localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
  }

  syncInputs();
  evaluate();
}

// Name the thresholds this day actually crossed — a state badge alone does not
// tell a mechanic which dial to argue with.
function explainTriggers(day, mode) {
  const t = WEATHER_THRESHOLDS;
  const hits = [];
  if (Number(day.precipInches || 0) >= t.dailyRainIn) hits.push(`rain ${day.precipInches} in ≥ ${t.dailyRainIn}`);
  if (mode === 'forecast' && Number(day.precipProbabilityMaxPct || 0) >= t.dailyRainProbPct) {
    hits.push(`rain probability ${day.precipProbabilityMaxPct}% ≥ ${t.dailyRainProbPct}%`);
  }
  if (mode === 'climate' && Number(day.wetDayFrequencyPct || 0) >= t.climateWetDayPct) {
    hits.push(`wet-day frequency ${day.wetDayFrequencyPct}% ≥ ${t.climateWetDayPct}%`);
  }
  if (isRainyWeatherCode(day.weatherCode)) hits.push(`weather code ${day.weatherCode} is wet`);
  if (Number(day.gustMaxMph || 0) >= t.alertGustMph) hits.push(`gusts ${day.gustMaxMph} ≥ ${t.alertGustMph} mph`);
  if (Number(day.tempDropF || 0) >= t.severeTempDropF) hits.push(`temp drop ${day.tempDropF}°F ≥ ${t.severeTempDropF}°F`);
  if (Number(day.windMaxMph || 0) >= t.warnWindMph) hits.push(`wind ${day.windMaxMph} ≥ ${t.warnWindMph} mph`);
  if (Number(day.gustMaxMph || 0) >= t.warnGustMph && Number(day.gustMaxMph || 0) < t.alertGustMph) {
    hits.push(`gusts ${day.gustMaxMph} ≥ ${t.warnGustMph} mph`);
  }
  if (Number(day.tempMaxF) >= t.hotF) hits.push(`high ${day.tempMaxF}°F ≥ ${t.hotF}°F`);
  if (Number(day.tempMinF) <= t.coldF) hits.push(`low ${day.tempMinF}°F ≤ ${t.coldF}°F`);
  return hits.length ? `Triggered by: ${hits.join(' · ')}` : 'No threshold crossed.';
}

const RACE_WX_NOTIFY_WINDOW_DAYS = 7;  // mirrors NOTIFY_WINDOW_DAYS in the refresh script

function thresholdExport() {
  const js = SANDBOX_THRESHOLDS.map(({ id }) => `  ${id}: ${WEATHER_THRESHOLDS[id]}`).join(',\n');
  const py = SANDBOX_THRESHOLDS.map(({ id }) => `    "${id}": ${WEATHER_THRESHOLDS[id]},`).join('\n');
  return `// raceTracker/assets/js/main.js — WEATHER_THRESHOLDS\n${js}\n\n` +
         `# scripts/refresh_race_weather.py — RISK_THRESHOLDS\n${py}\n`;
}


// ── Entity context ────────────────────────────────────────────
//
// Evolution Kart School and The Kart Depot are separate legal entities sharing
// this app. They share one approved palette; the active logo, name, and badge
// make the current workspace explicit. Billing is still entity-scoped because
// the two sets of books must never blur.

const ENTITY_STORAGE_KEY = 'raceTracker.activeEntityId';
let activeEntity = null;

async function initEntityContext() {
  const data = await fetchJson('/assets/data/entities.json');
  const entities = (data && Array.isArray(data.entities)) ? data.entities : [];
  if (!entities.length) return;

  const stored = safeStorageGet(ENTITY_STORAGE_KEY);
  const pick = (id) => entities.find(e => e.id === id);
  activeEntity = pick(stored) || pick(data.defaultEntityId) || entities[0];

  applyEntity(activeEntity);
  renderEntitySelectors(entities, () => activeEntity, (id) => {
    activeEntity = pick(id) || activeEntity;
    safeStorageSet(ENTITY_STORAGE_KEY, activeEntity.id);
    applyEntity(activeEntity);
    document.dispatchEvent(new CustomEvent('racetracker:entitychange', { detail: activeEntity }));
  });
}

const ENTITY_THEME_COLOR = {
  'evolution-kart-school': '#001a52', // --navy, matches the static <meta theme-color> default
  'the-kart-depot':        '#2b1d00'  // --tkd-bg
};

function applyEntity(entity) {
  const root = document.body;
  root.style.setProperty('--entity-accent', entity.accent);
  root.style.setProperty('--entity-accent-contrast', entity.accentContrast);
  root.setAttribute('data-entity', entity.id);
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta && ENTITY_THEME_COLOR[entity.id]) {
    themeColorMeta.setAttribute('content', ENTITY_THEME_COLOR[entity.id]);
  }
  document.querySelectorAll('[data-entity-badge]').forEach(el => {
    el.textContent = entity.badgeLabel;
    el.title = entity.legalName;
  });
  document.querySelectorAll('[data-entity-name]').forEach(el => {
    el.textContent = entity.shortName;
  });
  document.querySelectorAll('[data-entity-logo]').forEach(el => {
    el.src = entity.logo;
  });
  document.querySelectorAll('[data-entity-home]').forEach(el => {
    el.setAttribute('aria-label', `${entity.name} home`);
  });
}

function renderEntitySelectors(entities, getActive, onChange) {
  document.querySelectorAll('[data-entity-slot]').forEach(slot => {
    slot.innerHTML = `
      <label class="entity-switcher">
        <span>Workspace</span>
        <select data-entity-select aria-label="Select business">
          ${entities.map(e =>
            `<option value="${escapeHtml(e.id)}" ${e.id === getActive().id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`
          ).join('')}
        </select>
      </label>`;
    slot.querySelector('[data-entity-select]').addEventListener('change', (event) => {
      onChange(event.target.value);
      document.querySelectorAll('[data-entity-select]').forEach(sel => { sel.value = event.target.value; });
    });
  });
}

function activeEntityId() {
  return activeEntity ? activeEntity.id : null;
}

// localStorage throws in some privacy modes; a theme accent is never worth a crash.
function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
