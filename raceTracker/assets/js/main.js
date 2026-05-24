document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();
  initActiveNav();
  initTelemetryUpdates();
});

function initSidebarToggle() {
  const btn = document.querySelector('[data-sidebar-toggle]');
  const sidebar = document.querySelector('.sidebar');
  if (!btn || !sidebar) return;
  btn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (window.innerWidth > 980) return;
    if (!sidebar.contains(e.target) && !btn.contains(e.target)) sidebar.classList.remove('open');
  });
}

function initActiveNav() {
  const bodyPage = document.body.getAttribute('data-page');
  if (!bodyPage) return;
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    if (link.getAttribute('data-page') === bodyPage) link.classList.add('active');
  });
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
