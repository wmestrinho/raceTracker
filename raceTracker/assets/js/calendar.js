// One published calendar, shared in memory by every consumer on this page.
(() => {
  const listeners = new Set();
  let state = { events: [], fetchedAt: null, status: 'connecting' };
  let pending;
  let timer;
  const publish = () => listeners.forEach(listener => listener(state));
  async function refresh() {
    if (pending) return pending;
    if (!navigator.onLine) {
      state = { ...state, status: 'offline' };
      publish();
      return state;
    }
    pending = (async () => {
      try {
        const response = await fetch('/api/calendar', {
          cache: 'no-store', signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Calendar unavailable');
        const data = await response.json();
        if (!data.ok || !Array.isArray(data.events) || !data.fetchedAt) throw new Error('Invalid calendar');
        state = { events: data.events, fetchedAt: data.fetchedAt, status: navigator.onLine ? 'connected' : 'offline' };
      } catch {
        state = { ...state, status: navigator.onLine ? 'unavailable' : 'offline' };
      } finally { pending = null; }
      publish();
      return state;
    })();
    return pending;
  }
  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    if (!timer) timer = setInterval(() => {
      if (!document.hidden && listeners.size) void refresh();
    }, 60000);
    void refresh();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) { clearInterval(timer); timer = null; }
    };
  }
  window.addEventListener('offline', () => {
    state = { ...state, status: 'offline' };
    publish();
  });
  window.addEventListener('online', () => { if (listeners.size) void refresh(); });
  window.addEventListener('focus', () => { if (listeners.size) void refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && listeners.size) void refresh();
  });

  function statusText(snapshot) {
    const checked = snapshot.fetchedAt
      ? `Last checked ${new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
    if (snapshot.status === 'connected') return `${checked} Updates every minute while this page is open.`;
    if (snapshot.status === 'connecting') return 'Connecting to the Events calendar…';
    return `${snapshot.status === 'offline' ? 'You are offline.' : 'Calendar connection unavailable.'} ${checked} ${snapshot.fetchedAt ? 'Shown dates may have changed.' : 'Reconnect or retry to load dates.'}`;
  }

  function initViews() {
    document.querySelectorAll('[data-calendar-view]').forEach(root => {
      const list = root.querySelector('[data-calendar-list]');
      const status = root.querySelector('[data-calendar-status]');
      const period = root.querySelector('[data-calendar-period]');
      const search = root.querySelector('[data-calendar-search]');
      let snapshot = state;
      const render = () => {
        status.textContent = statusText(snapshot);
        status.classList.toggle('calendar-status-error', ['offline', 'unavailable'].includes(snapshot.status));
        const today = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
        const term = (search?.value || '').trim().toLowerCase();
        let events = snapshot.events.filter(event => {
          const past = event.endsOn < today;
          return (period?.value === 'all' || (period?.value === 'past' ? past : !past))
            && `${event.name} ${event.series} ${event.track}`.toLowerCase().includes(term);
        });
        if (root.dataset.calendarLimit) events = events.slice(0, Number(root.dataset.calendarLimit));
        list.replaceChildren();
        if (!events.length) {
          const empty = document.createElement('p');
          empty.className = 'muted-copy';
          empty.textContent = snapshot.fetchedAt ? 'No events match this view.' : 'Waiting for the published calendar.';
          list.append(empty);
          return;
        }
        events.forEach(event => {
          const article = document.createElement('article');
          article.className = 'calendar-event';
          const date = document.createElement('p');
          date.className = 'calendar-event-date';
          date.textContent = event.date;
          const body = document.createElement('div');
          const title = document.createElement('h3');
          title.textContent = event.name;
          const venue = document.createElement('p');
          venue.textContent = event.track;
          const series = document.createElement('p');
          series.className = 'muted-copy';
          series.textContent = event.series;
          body.append(title, venue, series);
          const link = document.createElement('a');
          link.href = 'https://events.thekartdepot.com/';
          link.className = 'calendar-event-link';
          link.textContent = 'Open Events';
          link.setAttribute('aria-label', `Open Events to view ${event.name}`);
          article.append(date, body, link);
          list.append(article);
        });
      };
      period?.addEventListener('change', render);
      search?.addEventListener('input', render);
      root.querySelector('[data-calendar-refresh]')?.addEventListener('click', () => void refresh());
      subscribe(next => { snapshot = next; render(); });
    });
  }

  window.raceTrackerCalendar = { refresh, subscribe, statusText };
  document.addEventListener('DOMContentLoaded', initViews);
})();
