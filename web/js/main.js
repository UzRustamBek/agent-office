// Agent Office: browser entry point.
// Chooses live mode (events from the local server) or demo mode (simulated
// agents), then wires state, world, renderer and UI together.

import { buildLayout } from './core/layout.js';
import { ACTIVE, BLOCKED, STATUS, applyEvent, createState, normalizeEvent, restore, summarize, tick } from './core/model.js';
import { RosterError, normalizeRoster } from './core/roster.js';
import { OfficeRenderer } from './office/renderer.js';
import { World } from './office/world.js';
import { createSimulator } from './sim/demo.js';
import { loadSettings, loadStoredRoster, saveSettings, storeRoster, clearStoredRoster } from './ui/settings.js';
import { sounds } from './ui/sound.js';
import { Palette } from './ui/palette.js';
import { UI } from './ui/ui.js';

const params = new URLSearchParams(location.search);

const app = {
  settings: loadSettings(),
  mode: 'demo',
  state: null,
  world: null,
  layout: null,
  renderer: null,
  ui: null,
  sim: null,
  eventSource: null,
  lastSeq: 0,
  rosterJson: '',
  getState: () => app.state,
};

// URL parameters override saved settings for this visit only (handy for links
// and screenshots): unknown values are ignored and overrides are never saved.
const saved = { ...app.settings };
const urlKeys = new Set();
const ALLOWED = {
  lang: ['en', 'uz', 'ru'],
  theme: ['auto', 'dark', 'light'],
  names: ['always', 'hover', 'off'],
  lighting: ['auto', 'day', 'night'],
  breaks: ['off', 'rare', 'normal'],
  look: ['classic', 'neon', 'cozy'],
};
for (const [key, values] of Object.entries(ALLOWED)) {
  if (params.has(key) && values.includes(params.get(key))) {
    app.settings[key] = params.get(key);
    urlKeys.add(key);
  }
}
if (params.has('speed')) {
  app.settings.speed = Math.max(0.25, Math.min(8, Number(params.get('speed')) || 1));
  urlKeys.add('speed');
}
if (params.has('motion')) {
  app.settings.reduceMotion = params.get('motion') === 'reduced';
  urlKeys.add('reduceMotion');
}

const canvas = document.getElementById('office');
const stage = document.getElementById('stage');

app.renderer = new OfficeRenderer(canvas, {
  getAgent: (id) => app.state?.agents[id],
  getSettings: () => app.settings,
  getMeeting: () => (app.state?.meeting && Date.now() < app.state.meeting.endsAt ? app.state.meeting : null),
  t: (key, vars) => (app.ui ? app.ui.t(key, vars) : key),
  onPick: (id) => app.actions.selectAgent(id),
  onHover: (id, e) => app.ui?.showTooltip(id, e || { clientX: 0, clientY: 0 }),
  onCinema: (on) => app.ui?.setCinemaUi(on),
  onShot: () => app.ui?.renderNow(),
});
app.ui = new UI(app);
app.palette = new Palette(app);

// --- actions -----------------------------------------------------------------
app.actions = {
  selectAgent(id, { focus = false } = {}) {
    app.ui.setSelected(id);
    if (!id) app.renderer.followId = null;
    if (id && focus) app.renderer.focusOn(id);
    if (id && document.body.dataset.sidebar === 'open') document.body.dataset.sidebar = 'closed';
  },
  toggleFollow(id) {
    if (app.renderer.followId === id) app.renderer.followId = null;
    else app.renderer.follow(id);
    app.ui.updateDrawer();
  },
  nextLook() {
    const looks = ALLOWED.look;
    app.updateSettings({ look: looks[(looks.indexOf(app.settings.look) + 1) % looks.length] });
  },
  nextLang() {
    const langs = ALLOWED.lang;
    app.updateSettings({ lang: langs[(langs.indexOf(app.settings.lang) + 1) % langs.length] });
  },
  giveTask(id) {
    app.sim?.assign(id, Date.now());
  },
  pickRosterFile() {
    if (app.mode === 'live') return app.ui.toast(app.ui.t('toast.liveOnly'), 'info');
    document.getElementById('file').click();
  },
  async loadRosterFile(file) {
    if (app.mode === 'live') return app.ui.toast(app.ui.t('toast.liveOnly'), 'info');
    try {
      if (file.size > 400_000) throw new RosterError(['file is larger than 400 KB']);
      const json = JSON.parse(await file.text());
      const roster = normalizeRoster(json);
      storeRoster(json);
      startDemo(roster);
      app.ui.toast(app.ui.t('toast.loaded', { n: roster.agents.length, name: file.name }), 'ok');
    } catch (err) {
      const issues = err instanceof RosterError ? err.issues.slice(0, 6).join('\n') : String(err.message || err);
      app.ui.toast(app.ui.t('toast.invalid', { issues }), 'error', 8000);
    }
  },
  async resetRoster() {
    if (app.mode === 'live') return app.ui.toast(app.ui.t('toast.liveOnly'), 'info');
    clearStoredRoster();
    startDemo(await fetchExampleRoster());
    document.getElementById('settings').close();
    app.ui.toast(app.ui.t('toast.reset'), 'ok');
  },
};

app.updateSettings = (patch) => {
  const before = { ...app.settings };
  Object.assign(app.settings, patch);
  for (const k of Object.keys(patch)) urlKeys.delete(k); // chosen by hand: keep it
  const toSave = { ...app.settings };
  for (const k of urlKeys) toSave[k] = saved[k];
  saveSettings(toSave);
  if ('lang' in patch && patch.lang !== before.lang) {
    app.ui.applyI18n();
    if (document.getElementById('settings').open) app.ui.buildSettings();
  }
  if ('theme' in patch || 'reduceMotion' in patch || 'look' in patch) {
    app.ui.applyTheme();
    if (app.world) app.world.reduceMotion = app.settings.reduceMotion;
  }
  if ('breaks' in patch) app.world?.setBreaks(app.settings.breaks);
  if ('speed' in patch) app.sim?.setSpeed(app.settings.speed);
};

document.getElementById('file').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) app.actions.loadRosterFile(f);
  e.target.value = '';
});

// --- data ----------------------------------------------------------------------
async function fetchJson(url, ms = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchExampleRoster() {
  try {
    return normalizeRoster(await fetchJson('api/roster', 1500));
  } catch {
    return normalizeRoster(await fetchJson('agents.example.json'));
  }
}

/** (Re)build the office for the current state's roster. */
function rebuild({ keepView = false } = {}) {
  const roster = app.state.roster;
  app.layout = buildLayout(roster);
  // keep the same world on roster updates, so characters do not pop in again
  if (app.world && keepView) app.world.setLayout(roster, app.layout);
  else app.world = new World(roster, app.layout, { seed: 11, reduceMotion: app.settings.reduceMotion, breaks: app.settings.breaks });
  app.renderer.setWorld(app.world, app.layout, roster, { keepView });
  const rosterJson = JSON.stringify(roster);
  if (roster.warnings?.length && rosterJson !== app.rosterJson) {
    for (const w of roster.warnings) console.warn('[agent-office]', w);
    app.ui.toast(app.ui.t('roster.warnings', { n: roster.warnings.length }), 'info', 7000);
  }
  app.rosterJson = rosterJson;
  app.ui.setTitle(roster);
  app.ui.buildRoster();
  // a roster update keeps the activity log; a fresh start shows the last entries
  if (!keepView || app.state.log.every((e) => e.seq > app.lastSeq)) {
    app.ui.resetLog();
    app.lastSeq = 0;
  }
  for (const entry of app.state.log.slice(-12)) {
    if (entry.seq <= app.lastSeq) continue;
    app.ui.addLog(entry);
    app.lastSeq = entry.seq;
  }
  if (app.ui.selectedId && !app.state.agents[app.ui.selectedId]) app.ui.setSelected(null);
  else if (app.ui.selectedId) app.ui.setSelected(app.ui.selectedId);
  refreshAll();
}

function refreshAll() {
  for (const id of Object.keys(app.state.agents)) app.ui.refreshRow(id);
  app.ui.renderStats(summarize(app.state));
  app.ui.renderTasks();
  app.ui.updateDrawer();
  app.ui.applyFilter();
}

const NOTIFY = new Set([STATUS.DONE, STATUS.WAITING, STATUS.PERMISSION, STATUS.ERROR]);

function ingest(raw) {
  const evt = normalizeEvent(raw);
  if (!evt || !app.state) return;
  const before = evt.type === 'status' ? app.state.agents[evt.agent]?.status : null;
  const res = applyEvent(app.state, evt, Date.now());
  if (res.rosterChanged) {
    rebuild({ keepView: true });
    return;
  }
  app.world.onEvent(evt, Date.now());
  for (const id of res.changed) app.ui.refreshRow(id);
  for (const entry of app.state.log) {
    if (entry.seq > app.lastSeq) {
      app.ui.addLog(entry);
      app.lastSeq = entry.seq;
    }
  }
  app.ui.renderStats(summarize(app.state));
  app.ui.renderNow();
  app.ui.renderTasks();
  app.ui.updateDrawer();
  if (app.ui.filter !== 'all') app.ui.applyFilter();
  if (app.settings.sound && evt.type === 'status' && before !== evt.status && NOTIFY.has(evt.status)) {
    if (evt.status === STATUS.DONE) sounds.done();
    else if (evt.status === STATUS.ERROR) sounds.error();
    else sounds.attention();
  }
}

function stopSources() {
  app.sim?.stop();
  app.sim = null;
  app.eventSource?.close();
  app.eventSource = null;
}

function startDemo(roster) {
  stopSources();
  app.mode = 'demo';
  app.state = createState(roster);
  const seed = params.has('seed') ? Number(params.get('seed')) || 1 : (Date.now() % 1_000_000) | 0;
  app.sim = createSimulator({
    getRoster: () => app.state.roster,
    emit: ingest,
    seed,
    speed: app.settings.speed,
    maxScenarios: Math.min(4, Math.max(2, Math.round(roster.agents.length / 6))),
  });
  app.ui.setConn('demo');
  rebuild();
}

function startLive(snapshot) {
  stopSources();
  app.mode = 'live';
  app.state = restore(snapshot);
  app.ui.setConn('live');
  rebuild();

  const es = new EventSource('api/stream');
  app.eventSource = es;
  es.addEventListener('open', () => app.ui.setConn('live'));
  es.addEventListener('error', () => app.ui.setConn('offline'));
  es.addEventListener('snapshot', (e) => {
    const snap = JSON.parse(e.data);
    const same = JSON.stringify(snap.roster) === app.rosterJson;
    app.state = restore(snap);
    if (same) {
      app.lastSeq = app.state.seq;
      refreshAll();
    } else rebuild({ keepView: true });
    app.ui.setConn('live');
  });
  es.addEventListener('evt', (e) => ingest(JSON.parse(e.data)));
}

// --- main loop -----------------------------------------------------------------
let last = Date.now();
function frame() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.world && app.state && !document.hidden) {
    app.sim?.tick(now);
    app.world.update(dt, now, (id) => app.state.agents[id]?.status ?? STATUS.IDLE, app.state.meeting);
    app.renderer.render(now);
  }
  requestAnimationFrame(frame);
}

setInterval(() => {
  if (!app.state) return;
  for (const id of tick(app.state, Date.now())) app.ui.refreshRow(id);
  app.ui.renderStats(summarize(app.state));
  app.ui.renderNow();
  app.ui.renderTasks();
  app.ui.updateDrawer();
  if (app.ui.filter !== 'all') app.ui.applyFilter();
}, 1000);

// --- keyboard ------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || document.getElementById('settings').open) {
    if (e.key === 'Escape' && tag === 'INPUT') e.target.blur();
    return;
  }
  const r = app.renderer;
  switch (e.key) {
    case 'f':
      r.setCinema(false);
      r.fit();
      break;
    case 'c':
      r.setCinema(!r.cinema);
      break;
    case '+':
    case '=':
      r.zoomBy(1.25);
      break;
    case '-':
      r.zoomBy(0.8);
      break;
    case '/':
      e.preventDefault();
      document.getElementById('search').focus();
      break;
    case 'Escape':
      app.actions.selectAgent(null);
      break;
    case 'l':
      document.getElementById('log-toggle').click();
      break;
    case 't':
      document.getElementById('btn-theme').click();
      break;
    default:
  }
});

// Keep the view fitted when the window changes, unless the user zoomed or panned.
new ResizeObserver(() => {
  const r = app.renderer;
  r.resize();
  if (r.layout && !r.userMoved && !r.followId && !r.cinema) r.fit();
}).observe(stage);
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => app.ui.applyTheme());

// --- boot ----------------------------------------------------------------------
async function boot() {
  app.ui.applyTheme();
  app.ui.applyI18n();
  app.ui.setConn('connecting');
  document.getElementById('legend').dataset.open = String(app.settings.legendOpen);
  document.getElementById('log').dataset.open = String(app.settings.logOpen);
  app.ui.setTasksOpen(app.settings.tasksOpen !== false && window.innerWidth > 900);
  app.ui.reserveForLog();

  if (!params.has('demo')) {
    try {
      const snap = await fetchJson('api/state', 1500);
      if (snap && snap.roster) {
        startLive(snap);
        return;
      }
    } catch {
      /* no server: fall through to demo */
    }
  }

  let roster = null;
  const stored = loadStoredRoster();
  if (stored) {
    try {
      roster = normalizeRoster(stored);
    } catch {
      clearStoredRoster();
    }
  }
  if (!roster) {
    try {
      roster = await fetchExampleRoster();
    } catch (err) {
      app.ui.setConn('offline');
      app.ui.toast(app.ui.t('boot.failed', { error: err.message }), 'error', 10000);
      return;
    }
  }
  startDemo(roster);
}

window.agentOffice = app; // for debugging in the console
boot().then(() => requestAnimationFrame(frame));
