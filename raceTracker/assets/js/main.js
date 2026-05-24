document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initActiveNav();
  initMechanicContext();
  initTelemetryUpdates();
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

function initMechanicContext() {
  const storageKey = 'raceTracker.mechanicProfile';
  const mechanics = ['Luiz', 'Leo', 'Nico', 'Paula'];
  const slots = document.querySelectorAll('[data-mechanic-slot]');
  if (!slots.length) return;

  const getSelected = () => localStorage.getItem(storageKey) || mechanics[0];
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
