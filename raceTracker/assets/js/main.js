/**
 * raceTracker interactions
 * - JSON-backed telemetry updates
 * - Dashboard hover tooltips
 * - Workshop quick interactions
 */

document.addEventListener('DOMContentLoaded', () => {
    initChartInteractions();
    initTelemetryUpdates();
    initWorkshopInteractions();
});

function initChartInteractions() {
    const lapBars = document.querySelectorAll('.chart-bar');
    lapBars.forEach((bar, index) => {
        bar.addEventListener('mouseenter', () => {
            const height = parseInt(bar.style.height, 10) || 0;
            showTooltip(bar, `Lap Time Score: ${height}/100`);
        });
        bar.addEventListener('mouseleave', hideTooltip);

        setTimeout(() => {
            const targetHeight = bar.style.height;
            bar.style.height = '0%';
            void bar.offsetWidth;
            bar.style.height = targetHeight;
        }, index * 100);
    });

    const pieSegments = document.querySelectorAll('.pie-segment');
    const labels = ['< 80 km/h', '80-90 km/h', '90-100 km/h', '> 100 km/h'];
    const percentages = [40, 30, 20, 10];

    pieSegments.forEach((segment, index) => {
        segment.addEventListener('mouseenter', () => {
            showTooltip(segment, `${labels[index]}: ${percentages[index]}%`);
        });
        segment.addEventListener('mouseleave', hideTooltip);
    });
}

function setTelemetryCard(card, values) {
    if (!card || !values) return;
    const map = {
        lap: '.data-item:nth-child(1) .value',
        speed: '.data-item:nth-child(2) .value',
        rpm: '.data-item:nth-child(3) .value',
        temp: '.data-item:nth-child(4) .value'
    };

    const lap = card.querySelector(map.lap);
    const speed = card.querySelector(map.speed);
    const rpm = card.querySelector(map.rpm);
    const temp = card.querySelector(map.temp);

    if (lap) lap.textContent = `${Number(values.lapTime).toFixed(3)}s`;
    if (speed) speed.textContent = `${Number(values.speedKmh).toFixed(1)} km/h`;
    if (rpm) rpm.textContent = Number(values.rpm).toLocaleString();
    if (temp) temp.textContent = `${Math.round(Number(values.temperatureC))}°C`;
}

function vary(value, delta, min, max, precision = 0) {
    const next = Math.max(min, Math.min(max, Number(value) + (Math.random() - 0.5) * delta));
    return Number(next.toFixed(precision));
}

async function initTelemetryUpdates() {
    const cards = document.querySelectorAll('#telemetry .telemetry-card');
    if (cards.length < 2) return;

    let data;
    try {
        const res = await fetch('assets/data/telemetry.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        console.warn('Telemetry JSON unavailable, using inline fallback.', err);
        data = {
            karts: [
                { id: 'Kart #1', lapTime: 45.234, speedKmh: 87.5, rpm: 12400, temperatureC: 85 },
                { id: 'Kart #2', lapTime: 44.876, speedKmh: 89.2, rpm: 12650, temperatureC: 82 }
            ]
        };
    }

    const state = (data.karts || []).slice(0, 2);
    if (state.length < 2) return;

    setTelemetryCard(cards[0], state[0]);
    setTelemetryCard(cards[1], state[1]);

    setInterval(() => {
        state[0].lapTime = vary(state[0].lapTime, 0.6, 40, 50, 3);
        state[1].lapTime = vary(state[1].lapTime, 0.6, 40, 50, 3);
        state[0].speedKmh = vary(state[0].speedKmh, 2.0, 80, 100, 1);
        state[1].speedKmh = vary(state[1].speedKmh, 2.0, 80, 100, 1);
        state[0].rpm = Math.round(vary(state[0].rpm, 220, 11000, 13000));
        state[1].rpm = Math.round(vary(state[1].rpm, 220, 11000, 13000));
        state[0].temperatureC = Math.round(vary(state[0].temperatureC, 4, 75, 95));
        state[1].temperatureC = Math.round(vary(state[1].temperatureC, 4, 75, 95));

        setTelemetryCard(cards[0], state[0]);
        setTelemetryCard(cards[1], state[1]);
    }, 3000);
}

function initWorkshopInteractions() {
    const taskItems = document.querySelectorAll('.task-item');
    taskItems.forEach(item => {
        item.addEventListener('click', function (e) {
            if (e.target.classList.contains('task-status')) return;

            const statusSpan = this.querySelector('.task-status');
            const currentStatus = statusSpan.className.split(' ')[1];
            const statusOrder = ['pending', 'in-progress', 'completed'];
            const nextStatus = statusOrder[(statusOrder.indexOf(currentStatus) + 1) % statusOrder.length];

            statusSpan.className = `task-status ${nextStatus}`;
            statusSpan.textContent = nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1).replace('-', ' ');
        });
    });
}

function showTooltip(element, text) {
    hideTooltip();
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.textContent = text;
    document.body.appendChild(tooltip);

    const rect = element.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - 10}px`;
}

function hideTooltip() {
    document.querySelectorAll('.chart-tooltip').forEach(t => t.remove());
}
