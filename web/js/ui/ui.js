// DOM user interface: roster, details drawer, activity log, settings, toasts.
// Text from rosters or events is always inserted with textContent, never as HTML.

import { ACTIVE, BLOCKED, STATUS, STATUS_LIST } from '../core/model.js';
import { defaultLook } from '../core/roster.js';
import { drawCharacter } from '../office/character.js';
import { STATUS_COLOR } from '../office/palette.js';
import { LANGS, makeT } from './i18n.js';

/** Tiny element factory. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

export function drawAvatar(canvas, look, scale) {
  canvas.width = 16 * scale;
  canvas.height = 26 * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  drawCharacter(ctx, look, { x: 8, y: 26, dir: 'down', shadow: false });
}

/**
 * Department members in org-chart order: every manager directly followed by
 * their own people, so two teams never interleave.
 */
export function treeOrder(members) {
  const ids = new Set(members.map((a) => a.id));
  const byId = new Map(members.map((a) => [a.id, a]));
  const roots = members.filter((a) => !a.reportsTo || !ids.has(a.reportsTo)).sort((a, b) => (a.level || 0) - (b.level || 0));
  const out = [];
  const visit = (a) => {
    out.push(a);
    for (const id of a.team || []) if (byId.has(id)) visit(byId.get(id));
  };
  roots.forEach(visit);
  return out.length === members.length ? out : members;
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const pad = (n) => String(n).padStart(2, '0');
export const fmtClock = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export class UI {
  /**
   * @param {object} app  { getState, settings, renderer, actions }
   */
  constructor(app) {
    this.app = app;
    this.$ = (id) => document.getElementById(id);
    this.t = makeT(app.settings.lang);
    this.filter = 'all';
    this.query = '';
    this.selectedId = null;
    this.rows = new Map();
    this.groups = new Map();
    this.drawerRefs = null;
    this.logCount = 0;
    this._bindStatic();
  }

  get state() {
    return this.app.getState();
  }
  agentInfo(id) {
    return this.state.roster.agents.find((a) => a.id === id);
  }
  deptOf(agent) {
    return this.state.roster.departments.find((d) => d.id === agent.department);
  }
  statusLabel(s) {
    return this.t(`status.${s}`);
  }

  // --- static wiring ---------------------------------------------------------
  _bindStatic() {
    const $ = this.$;
    $('search').addEventListener('input', (e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.applyFilter();
    });
    $('filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      this.filter = b.dataset.filter;
      for (const p of $('filters').children) p.classList.toggle('is-on', p === b);
      this.applyFilter();
    });
    $('btn-sidebar').addEventListener('click', () => {
      document.body.dataset.sidebar = document.body.dataset.sidebar === 'open' ? 'closed' : 'open';
    });
    $('legend-toggle').addEventListener('click', () => {
      const open = $('legend').dataset.open !== 'false';
      $('legend').dataset.open = String(!open);
      $('legend-toggle').setAttribute('aria-expanded', String(!open));
      this.app.updateSettings({ legendOpen: !open });
    });
    $('log-toggle').addEventListener('click', () => {
      const open = $('log').dataset.open !== 'false';
      $('log').dataset.open = String(!open);
      $('log-toggle').setAttribute('aria-expanded', String(!open));
      this.app.updateSettings({ logOpen: !open });
      this.reserveForLog();
    });
    $('btn-zoom-in').addEventListener('click', () => this.app.renderer.zoomBy(1.3));
    $('btn-zoom-out').addEventListener('click', () => this.app.renderer.zoomBy(1 / 1.3));
    $('btn-fit').addEventListener('click', () => this.app.renderer.fit());
    $('btn-cine').addEventListener('click', () => this.app.renderer.setCinema(!this.app.renderer.cinema));
    $('btn-palette').addEventListener('click', () => this.app.palette?.open());
    $('now').addEventListener('click', () => {
      if (this.nowId) this.app.actions.selectAgent(this.nowId, { focus: true });
    });
    $('btn-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    $('btn-settings').addEventListener('click', () => {
      this.buildSettings();
      $('settings').showModal();
    });
    $('btn-theme').addEventListener('click', () => {
      const order = ['auto', 'dark', 'light'];
      const next = order[(order.indexOf(this.app.settings.theme) + 1) % order.length];
      this.app.updateSettings({ theme: next });
    });
    $('btn-load').addEventListener('click', () => this.app.actions.pickRosterFile());
    $('btn-reset-roster').addEventListener('click', () => this.app.actions.resetRoster());
    $('settings').addEventListener('click', (e) => {
      if (e.target === $('settings')) $('settings').close();
    });
    const stage = $('stage');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth++;
      $('drop').hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) $('drop').hidden = true;
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      $('drop').hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) this.app.actions.loadRosterFile(f);
    });
  }

  /** Keep the office clear of the activity log when it is open. */
  reserveForLog() {
    const r = this.app.renderer;
    const open = this.$('log').dataset.open !== 'false';
    r.reserveBottom = open ? 176 : 48;
    if (r.layout && !r.userMoved && !r.followId) r.fit();
  }

  // --- translations ----------------------------------------------------------
  applyI18n() {
    this.t = makeT(this.app.settings.lang);
    document.documentElement.lang = this.app.settings.lang;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = this.t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = this.t(el.dataset.i18nTitle);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', this.t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = this.t(el.dataset.i18nPlaceholder);
    this.buildLegend();
    this.setConn(this.connMode || 'connecting');
    if (this.state) {
      this.buildRoster();
      if (this.selectedId) this.openDrawer(this.selectedId, { keepView: true });
    }
  }

  applyTheme() {
    const s = this.app.settings;
    const dark = s.theme === 'auto' ? !window.matchMedia('(prefers-color-scheme: light)').matches : s.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
    document.documentElement.dataset.look = s.look || 'classic';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0d1020' : '#eceff8';
  }

  buildLegend() {
    const list = this.$('legend-list');
    list.replaceChildren(
      ...STATUS_LIST.filter((s) => s !== STATUS.SLEEPING).map((s) => h('li', {}, h('i', { style: { '--st': STATUS_COLOR[s] } }), h('span', { text: this.statusLabel(s) }))),
    );
  }

  // --- header ----------------------------------------------------------------
  setTitle(roster) {
    this.$('office-title').textContent = roster.office.title;
    this.$('office-subtitle').textContent = roster.office.subtitle || `${roster.agents.length} agents`;
    document.title = `${roster.office.title}`;
  }

  setConn(mode) {
    this.connMode = mode;
    const el = this.$('conn');
    el.dataset.mode = mode;
    this.$('conn-text').textContent = this.t(`conn.${mode}`);
    el.title = this.t(`conn.${mode}.title`) === `conn.${mode}.title` ? '' : this.t(`conn.${mode}.title`);
  }

  /** Cinema button state (the camera can also stop by itself when you move it). */
  setCinemaUi(on) {
    const b = this.$('btn-cine');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-on', on);
    document.body.dataset.cinema = String(on);
    this.renderNow();
  }

  /** The "Now" pill: what the director is filming, or else the agent that acted last. */
  renderNow() {
    const el = this.$('now');
    const r = this.app.renderer;
    const shot = r.director.on ? r.director.shot : null;
    let id = shot?.kind === 'agent' ? shot.id : null;
    if (!id) {
      let best = null;
      for (const a of this.state?.roster.agents || []) {
        const st = this.state.agents[a.id];
        if (st && ACTIVE.has(st.status) && (!best || st.lastEventAt > best.lastEventAt)) best = st;
      }
      id = best?.id || null;
    }
    const st = id ? this.state.agents[id] : null;
    // while the meeting is filmed its banner sits where the pill would be
    if (shot?.kind === 'meeting' || !st || !ACTIVE.has(st.status)) {
      el.hidden = true;
      this.nowId = null;
      return;
    }
    this.nowId = id;
    el.hidden = false;
    el.style.setProperty('--st', STATUS_COLOR[st.status] || STATUS_COLOR.idle);
    this.$('now-name').textContent = this.state.roster.agents.find((a) => a.id === id)?.name || id;
    this.$('now-text').textContent = st.activity || this.statusLabel(st.status);
  }

  renderStats(sum) {
    this.$('n-active').textContent = sum.active;
    this.$('n-blocked').textContent = sum.blocked;
    this.$('n-idle').textContent = sum.total - sum.active - sum.blocked;
    this.$('stats').querySelector('[data-kind="blocked"]').classList.toggle('has', sum.blocked > 0);
  }

  // --- roster ----------------------------------------------------------------
  buildRoster() {
    const roster = this.state.roster;
    const root = this.$('roster');
    this.rows.clear();
    this.groups.clear();
    const frag = document.createDocumentFragment();
    for (const dept of roster.departments) {
      const members = treeOrder(roster.agents.filter((a) => a.department === dept.id));
      if (!members.length) continue;
      const base = Math.min(...members.map((a) => a.level || 0));
      const count = h('span', { class: 'count' });
      const group = h(
        'details',
        { class: 'group', open: true, style: { '--dept': dept.color } },
        h('summary', {}, h('span', { class: 'swatch' }), h('span', { text: dept.id === 'guests' ? this.t('dept.guests') : dept.name }), count),
      );
      for (const a of members) {
        const row = this._buildRow(a);
        row.el.dataset.indent = String(Math.min(3, Math.max(0, (a.level || 0) - base)));
        group.append(row.el);
        this.rows.set(a.id, row);
      }
      this.groups.set(dept.id, { el: group, count, members });
      frag.append(group);
    }
    frag.append(h('div', { class: 'roster-empty', id: 'roster-empty', hidden: true, text: this.t('roster.empty') }));
    root.replaceChildren(frag);
    for (const a of roster.agents) this.refreshRow(a.id);
    this.applyFilter();
  }

  _buildRow(agent) {
    const canvas = h('canvas', { class: 'avatar', 'aria-hidden': 'true' });
    const dept = this.deptOf(agent);
    drawAvatar(canvas, agent.look || defaultLook(agent.id, dept?.color), 2);
    const name = h('span', { class: 'name', text: agent.name });
    const sub = h('span', { class: 'sub' });
    const dot = h('span', { class: 'dot' });
    const label = h('span', { class: 'label' });
    const state = h('span', { class: 'state' }, dot, label);
    const el = h(
      'button',
      {
        class: 'agent',
        type: 'button',
        dataset: { id: agent.id, tier: agent.tier || 'doer' },
        title: this.t(`tier.${agent.tier || 'doer'}`),
        onclick: () => this.app.actions.selectAgent(agent.id, { focus: true }),
      },
      canvas,
      h('span', { class: 'meta' }, name, sub),
      state,
    );
    return { el, sub, state, label, agent };
  }

  refreshRow(id) {
    const row = this.rows.get(id);
    const a = this.state.agents[id];
    if (!row || !a) return;
    const color = STATUS_COLOR[a.status] || STATUS_COLOR.idle;
    row.el.style.setProperty('--st', color);
    row.state.style.setProperty('--st', color);
    row.state.dataset.live = String(ACTIVE.has(a.status) || BLOCKED.has(a.status));
    row.state.dataset.attn = String(BLOCKED.has(a.status));
    const m = this.state.meeting;
    const inMeeting = Boolean(m && Date.now() < m.endsAt && (m.host === id || m.agents.includes(id)));
    row.label.textContent = inMeeting && a.status === STATUS.IDLE ? this.t('meeting.in') : this.statusLabel(a.status);
    row.state.dataset.meeting = String(inMeeting);
    const showActivity = a.status !== STATUS.IDLE && a.activity;
    row.sub.textContent = showActivity ? a.activity : inMeeting ? `📋 ${this.t('meeting.in')}` : row.agent.role || '';
    row.sub.classList.toggle('live', Boolean(showActivity));
    row.el.classList.toggle('is-selected', id === this.selectedId);
    this._updateGroupCount(row.agent.department);
  }

  _updateGroupCount(deptId) {
    const g = this.groups.get(deptId);
    if (!g) return;
    const active = g.members.filter((m) => {
      const s = this.state.agents[m.id]?.status;
      return ACTIVE.has(s) || BLOCKED.has(s);
    }).length;
    g.count.replaceChildren(h('span', { class: active ? 'on' : '', text: String(active) }), `/${g.members.length}`);
  }

  applyFilter() {
    let visible = 0;
    for (const [dept, g] of this.groups) {
      let shown = 0;
      for (const m of g.members) {
        const row = this.rows.get(m.id);
        const st = this.state.agents[m.id]?.status;
        const matchesFilter =
          this.filter === 'all' ||
          (this.filter === 'active' && ACTIVE.has(st)) ||
          (this.filter === 'blocked' && BLOCKED.has(st)) ||
          (this.filter === 'idle' && !ACTIVE.has(st) && !BLOCKED.has(st));
        const hay = `${m.name} ${m.role} ${m.description} ${m.id} ${(m.tools || []).join(' ')} ${(m.skills || []).join(' ')} ${dept}`.toLowerCase();
        const ok = matchesFilter && (!this.query || hay.includes(this.query));
        row.el.hidden = !ok;
        if (ok) shown++;
      }
      g.el.hidden = shown === 0;
      visible += shown;
    }
    const empty = this.$('roster-empty');
    if (empty) empty.hidden = visible > 0;
  }

  // --- selection + drawer ----------------------------------------------------
  setSelected(id) {
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev) this.refreshRow(prev);
    if (id) {
      this.refreshRow(id);
      this.rows.get(id)?.el.scrollIntoView({ block: 'nearest' });
    }
    if (id) this.openDrawer(id);
    else this.closeDrawer();
    this.app.renderer.selectedId = id;
  }

  closeDrawer() {
    const d = this.$('drawer');
    d.hidden = true;
    d.replaceChildren();
    this.drawerRefs = null;
  }

  openDrawer(id) {
    const agent = this.agentInfo(id);
    const st = this.state.agents[id];
    if (!agent || !st) return this.closeDrawer();
    const dept = this.deptOf(agent);
    const look = agent.look || defaultLook(agent.id, dept?.color);
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    drawAvatar(canvas, look, 5);

    const badge = h('span', { class: 'badge' }, h('i'), h('span'));
    const nowText = h('span');
    const now = h('div', { class: 'd-now' }, h('small', { text: this.t('drawer.now') }), nowText);
    const stats = h('div', { class: 'kv' });
    const timeline = h('ul', { class: 'timeline' });

    const followBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => this.app.actions.toggleFollow(id) });
    const actions = h('div', { class: 'd-actions' }, followBtn);
    if (this.app.mode === 'demo') actions.append(h('button', { class: 'btn', type: 'button', text: this.t('drawer.task'), onclick: () => this.app.actions.giveTask(id) }));
    const copy = h('button', {
      class: 'btn ghost',
      type: 'button',
      text: this.t('drawer.copy'),
      onclick: async (e) => {
        try {
          await navigator.clipboard.writeText(id);
          e.target.textContent = this.t('drawer.copied');
          setTimeout(() => (e.target.textContent = this.t('drawer.copy')), 1200);
        } catch {
          /* clipboard unavailable */
        }
      },
    });
    actions.append(copy);

    const section = (title, ...kids) => h('section', { class: 'd-sec' }, h('h3', { text: title }), ...kids);
    const byId = new Map(this.state.roster.agents.map((a) => [a.id, a]));
    const person = (a) => h('button', { class: 'tag person', type: 'button', dataset: { tier: a.tier || 'doer' }, text: a.name, onclick: () => this.app.actions.selectAgent(a.id, { focus: true }) });
    const boss = agent.reportsTo ? byId.get(agent.reportsTo) : null;
    const reports = (agent.team || []).map((x) => byId.get(x)).filter(Boolean);
    const hierarchy = h(
      'div',
      { class: 'hier' },
      h('div', {}, h('small', { text: this.t('drawer.reportsTo') }), boss ? person(boss) : h('span', { class: 'muted', text: this.t('drawer.noManager') })),
      reports.length ? h('div', {}, h('small', { text: `${this.t('drawer.team')} (${reports.length})` }), h('div', { class: 'tags' }, reports.map(person))) : null,
    );
    const tagList = (items, soft) => h('div', { class: 'tags' }, items.map((x) => h('span', { class: `tag${soft ? ' soft' : ''}`, text: x })));

    const d = this.$('drawer');
    const kids = [
      h('button', { class: 'icon-btn close', type: 'button', 'aria-label': this.t('drawer.close'), onclick: () => this.app.actions.selectAgent(null) }, h('span', { 'aria-hidden': 'true', text: '✕' })),
      h(
        'div',
        { class: 'd-head' },
        canvas,
        h('div', {}, h('h2', { text: agent.name }), h('p', { text: agent.role || '' }), h('div', { class: 'badges' }, h('span', { class: 'badge', style: { '--st': dept?.color } }, h('i'), h('span', { text: dept?.id === 'guests' ? this.t('dept.guests') : dept?.name || '' })), h('span', { class: 'badge tier', dataset: { tier: agent.tier || 'doer' } }, h('span', { text: this.t(`tier.${agent.tier || 'doer'}`) })), agent.model ? h('span', { class: 'badge' }, h('span', { text: agent.model })) : null)),
      ),
      h('div', { class: 'badges' }, badge),
      now,
      agent.description ? section(this.t('drawer.about'), h('p', { text: agent.description })) : null,
      section(this.t('drawer.hierarchy'), hierarchy),
      agent.tools?.length ? section(this.t('drawer.tools'), tagList(agent.tools)) : null,
      agent.skills?.length ? section(this.t('drawer.skills'), tagList(agent.skills, true)) : null,
      section(this.t('drawer.stats'), stats),
      section(this.t('drawer.recent'), timeline),
      actions,
    ].filter(Boolean); // replaceChildren(null) would insert the text "null"
    d.replaceChildren(...kids);
    d.hidden = false;
    this.drawerRefs = { id, badge, nowText, now, stats, timeline, followBtn };
    this.updateDrawer();
  }

  updateDrawer() {
    const r = this.drawerRefs;
    if (!r) return;
    const st = this.state.agents[r.id];
    if (!st) return;
    const color = STATUS_COLOR[st.status] || STATUS_COLOR.idle;
    r.badge.style.setProperty('--st', color);
    r.now.style.setProperty('--st', color);
    r.badge.lastChild.textContent = this.statusLabel(st.status);
    r.nowText.textContent = st.activity || this.statusLabel(st.status);

    let activeMs = 0;
    for (const [k, v] of Object.entries(st.time)) if (ACTIVE.has(k)) activeMs += v;
    if (ACTIVE.has(st.status)) activeMs += Date.now() - st.since;
    const kv = (value, label) => h('div', {}, h('b', { text: String(value) }), h('small', { text: label }));
    r.stats.replaceChildren(
      kv(st.counters.done, this.t('stat.done')),
      kv(st.counters.tools, this.t('stat.tools')),
      kv(fmtDuration(activeMs), this.t('stat.active')),
      kv(st.counters.delegated, this.t('stat.delegated')),
      kv(st.counters.received, this.t('stat.received')),
      kv(st.counters.events, this.t('stat.events')),
    );
    const hist = st.history.slice(-8).reverse();
    r.timeline.replaceChildren(
      ...(hist.length
        ? hist.map((x) => h('li', { style: { '--st': STATUS_COLOR[x.status] || STATUS_COLOR.idle } }, h('time', { text: fmtClock(x.ts) }), h('i'), h('span', { text: x.activity || this.statusLabel(x.status) })))
        : [h('li', { text: this.t('drawer.nothing') })]),
    );
    r.followBtn.textContent = this.app.renderer.followId === r.id ? this.t('drawer.unfollow') : this.t('drawer.follow');
  }

  // --- tooltip ---------------------------------------------------------------
  showTooltip(id, evt) {
    const tip = this.$('tooltip');
    if (!id || this.drawerRefs?.id === id) {
      tip.hidden = true;
      return;
    }
    const agent = this.agentInfo(id);
    const st = this.state.agents[id];
    if (!agent || !st) return;
    tip.replaceChildren(h('b', { text: agent.name }), h('span', { text: `${this.statusLabel(st.status)}${st.activity && st.status !== STATUS.IDLE ? ` · ${st.activity}` : ''}` }));
    tip.hidden = false;
    const r = this.$('stage').getBoundingClientRect();
    const x = Math.min(evt.clientX - r.left + 14, r.width - tip.offsetWidth - 8);
    const y = Math.min(evt.clientY - r.top + 16, r.height - tip.offsetHeight - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  // --- log -------------------------------------------------------------------
  resetLog() {
    this.$('log-list').replaceChildren(h('li', { class: 'empty', text: this.t('log.empty') }));
    this.logCount = 0;
  }

  addLog(entry) {
    const list = this.$('log-list');
    if (this.logCount === 0) list.replaceChildren();
    const info = this.agentInfo(entry.agent);
    const name = info?.name || entry.agent;
    let what;
    let color;
    if (entry.kind === 'delegate') {
      const to = this.agentInfo(entry.to)?.name || entry.to;
      what = `${this.t('log.delegate', { from: name, to })}${entry.activity ? `: ${entry.activity}` : ''}`;
      color = STATUS_COLOR.delegating;
    } else if (entry.kind === 'meeting') {
      what = `${this.t('log.meeting', { n: entry.count || 0 })}${entry.activity ? `: ${entry.activity}` : ''}`;
      color = '#f0a03c';
    } else if (entry.kind === 'message') {
      what = entry.activity;
      color = STATUS_COLOR.waiting;
    } else {
      what = entry.activity ? `${this.statusLabel(entry.status)}: ${entry.activity}` : this.statusLabel(entry.status);
      color = STATUS_COLOR[entry.status] || STATUS_COLOR.idle;
    }
    const li = h('li', { style: { '--st': color } }, h('time', { text: fmtClock(entry.ts) }), h('span', { class: 'who', text: entry.kind === 'delegate' ? '' : name }), h('span', { class: 'what', title: what, text: what }));
    list.prepend(li);
    this.logCount++;
    while (list.children.length > 60) list.lastChild.remove();
  }

  // --- toasts ----------------------------------------------------------------
  toast(message, kind = 'info', ms = 4500) {
    const el = h('div', { class: 'toast', dataset: { kind }, text: message });
    this.$('toasts').append(el);
    setTimeout(() => el.remove(), ms);
  }

  // --- settings --------------------------------------------------------------
  buildSettings() {
    const s = this.app.settings;
    const t = this.t;
    const select = (key, options, labelKey) =>
      h('select', { onchange: (e) => this.app.updateSettings({ [key]: e.target.value }) }, options.map(([v, l]) => h('option', { value: v, selected: s[key] === v, text: l })));
    const toggle = (key) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: Boolean(s[key]), onchange: (e) => this.app.updateSettings({ [key]: e.target.checked }) }), h('span'));
    const field = (title, control, hint) => {
      const input = control.matches('input, select') ? control : control.querySelector('input, select');
      input?.setAttribute('aria-label', title);
      return h('div', { class: 'field' }, h('label', {}, title, hint ? h('small', { text: hint }) : null), control);
    };

    const fields = [
      field(t('settings.language'), select('lang', LANGS.map((l) => [l.code, l.label]))),
      field(t('settings.theme'), select('theme', [['auto', t('settings.theme.auto')], ['dark', t('settings.theme.dark')], ['light', t('settings.theme.light')]])),
      field(t('settings.look'), select('look', [['classic', t('settings.look.classic')], ['neon', t('settings.look.neon')], ['cozy', t('settings.look.cozy')]]), t('settings.look.hint')),
      field(t('settings.names'), select('names', [['always', t('settings.names.always')], ['hover', t('settings.names.hover')], ['off', t('settings.names.off')]])),
      field(t('settings.lighting'), select('lighting', [['auto', t('settings.lighting.auto')], ['day', t('settings.lighting.day')], ['night', t('settings.lighting.night')]])),
      field(t('settings.breaks'), select('breaks', [['off', t('settings.breaks.off')], ['rare', t('settings.breaks.rare')], ['normal', t('settings.breaks.normal')]]), t('settings.breaks.hint')),
      field(t('settings.bubbles'), toggle('bubbles')),
      field(t('settings.motion'), toggle('reduceMotion'), t('settings.motion.hint')),
      field(t('settings.sound'), toggle('sound'), t('settings.sound.hint')),
    ];
    if (this.app.mode === 'demo') {
      fields.push(
        field(
          t('settings.speed'),
          h('input', {
            type: 'range',
            min: '0.5',
            max: '4',
            step: '0.5',
            value: String(s.speed),
            oninput: (e) => this.app.updateSettings({ speed: Number(e.target.value) }),
          }),
        ),
      );
    }
    this.$('settings-fields').replaceChildren(...fields);
  }
}
