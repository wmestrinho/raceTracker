/**
 * timer.js — Lap timer for raceTracker
 * Call initLapTimer() on the telemetry page.
 */

const TIMER_SESSION_KEY = 'raceTracker.timer.session';

export function initLapTimer() {
  const container = document.querySelector('[data-lap-timer]');
  if (!container) return;

  let running    = false;
  let lapStart   = 0;
  let currentMs  = 0;
  let laps       = [];
  let interval   = null;
  let kartId     = 'Kart #1';

  // Restore session
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_SESSION_KEY) || 'null');
    if (saved && saved.kartId) { kartId = saved.kartId; laps = saved.laps || []; }
  } catch {}

  // Inject HTML
  container.innerHTML = `
    <div class="timer-kart-row">
      <label class="timer-kart-label">Kart
        <select data-timer-kart class="timer-kart-select">
          <option>Kart #1</option>
          <option>Kart #2</option>
          <option>Kart #3</option>
          <option>Kart #4</option>
          <option>Kart #5</option>
        </select>
      </label>
      <span class="timer-session-label" data-timer-session-label></span>
    </div>
    <div class="timer-display" data-timer-display>00:00.00</div>
    <div class="timer-controls">
      <button class="timer-btn timer-btn-start" data-timer-start>START</button>
      <button class="timer-btn timer-btn-lap"   data-timer-lap   disabled>LAP</button>
      <button class="timer-btn timer-btn-stop"  data-timer-stop  disabled>STOP</button>
      <button class="timer-btn timer-btn-reset" data-timer-reset>RESET</button>
    </div>
    <div class="timer-stats" data-timer-stats></div>
    <div class="timer-laps"  data-timer-laps></div>
  `;

  // Element refs
  const display      = container.querySelector('[data-timer-display]');
  const kartSelect   = container.querySelector('[data-timer-kart]');
  const btnStart     = container.querySelector('[data-timer-start]');
  const btnLap       = container.querySelector('[data-timer-lap]');
  const btnStop      = container.querySelector('[data-timer-stop]');
  const btnReset     = container.querySelector('[data-timer-reset]');
  const statsEl      = container.querySelector('[data-timer-stats]');
  const lapsEl       = container.querySelector('[data-timer-laps]');
  const sessionLabel = container.querySelector('[data-timer-session-label]');

  kartSelect.value = kartId;
  kartSelect.addEventListener('change', () => { kartId = kartSelect.value; saveSession(); });

  btnStart.addEventListener('click', start);
  btnLap.addEventListener('click',   lap);
  btnStop.addEventListener('click',  stop);
  btnReset.addEventListener('click', reset);

  renderLaps();

  // ── Controls ──────────────────────────────

  function start() {
    if (running) return;
    running  = true;
    lapStart = Date.now() - currentMs;
    interval = setInterval(tick, 30);
    setButtons(true);
    sessionLabel.textContent = `Session started ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function lap() {
    if (!running) return;
    const lapMs = Date.now() - lapStart;
    laps.push(lapMs);
    lapStart  = Date.now();
    currentMs = 0;
    saveSession();
    renderLaps();
  }

  function stop() {
    if (!running) return;
    running   = false;
    currentMs = Date.now() - lapStart;
    clearInterval(interval);
    setButtons(false);
    saveSession();
  }

  function reset() {
    running   = false;
    currentMs = 0;
    laps      = [];
    clearInterval(interval);
    display.textContent = '00:00.00';
    display.classList.remove('timer-running', 'timer-best');
    statsEl.innerHTML = '';
    lapsEl.innerHTML  = '';
    setButtons(false);
    sessionLabel.textContent = '';
    localStorage.removeItem(TIMER_SESSION_KEY);
  }

  function tick() {
    currentMs = Date.now() - lapStart;
    display.textContent = formatMs(currentMs);
  }

  // ── Render ──────────────────────────────

  function setButtons(isRunning) {
    btnStart.disabled = isRunning;
    btnLap.disabled   = !isRunning;
    btnStop.disabled  = !isRunning;
  }

  function renderLaps() {
    if (!laps.length) { lapsEl.innerHTML = ''; statsEl.innerHTML = ''; return; }

    const best = Math.min(...laps);
    const avg  = laps.reduce((s, l) => s + l, 0) / laps.length;
    const last = laps[laps.length - 1];

    statsEl.innerHTML = `
      <div class="timer-stat"><span>Laps</span><strong>${laps.length}</strong></div>
      <div class="timer-stat timer-best-stat"><span>Best</span><strong>${formatMs(best)}</strong></div>
      <div class="timer-stat"><span>Last</span><strong>${formatMs(last)}</strong></div>
      <div class="timer-stat"><span>Avg</span><strong>${formatMs(avg)}</strong></div>
    `;

    lapsEl.innerHTML = `
      <table class="table timer-lap-table">
        <thead><tr><th>#</th><th>Lap Time</th><th>Gap to Best</th></tr></thead>
        <tbody>
          ${laps.map((ms, i) => {
            const isBest = ms === best;
            const gap    = ms - best;
            return `<tr class="${isBest ? 'timer-best-row' : ''}">
              <td>${i + 1}</td>
              <td>${formatMs(ms)}${isBest ? ' ⚡' : ''}</td>
              <td>${isBest ? '—' : '+' + formatMs(gap)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function saveSession() {
    try { localStorage.setItem(TIMER_SESSION_KEY, JSON.stringify({ kartId, laps, savedAt: new Date().toISOString() })); } catch {}
  }
}

export function formatMs(ms) {
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
