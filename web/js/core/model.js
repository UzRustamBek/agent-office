// Agent state model: statuses, the event protocol and a pure reducer.
// Used by the server (to keep snapshots), the browser (to drive the office)
// and the tests. It never touches the DOM or Node-only APIs.

import { slug } from './roster.js';

export const PROTOCOL_VERSION = 1;

export const STATUS = Object.freeze({
  IDLE: 'idle',
  THINKING: 'thinking',
  TYPING: 'typing',
  READING: 'reading',
  RUNNING: 'running',
  SEARCHING: 'searching',
  DELEGATING: 'delegating',
  WAITING: 'waiting',
  PERMISSION: 'permission',
  DONE: 'done',
  ERROR: 'error',
  SLEEPING: 'sleeping',
});

export const STATUS_LIST = Object.freeze(Object.values(STATUS));

/** Statuses where the agent is busy executing its turn. */
export const ACTIVE = new Set([
  STATUS.THINKING,
  STATUS.TYPING,
  STATUS.READING,
  STATUS.RUNNING,
  STATUS.SEARCHING,
  STATUS.DELEGATING,
]);

/** Statuses where the agent is blocked on a human. */
export const BLOCKED = new Set([STATUS.WAITING, STATUS.PERMISSION]);

export const isActive = (s) => ACTIVE.has(s);
export const isBlocked = (s) => BLOCKED.has(s);

export const EVENT_TYPES = Object.freeze(['status', 'delegate', 'message', 'meeting']);

export const LIMITS = Object.freeze({
  idLen: 64,
  activityLen: 140,
  taskLen: 140,
  textLen: 240,
  logSize: 400,
  historySize: 24,
  meetingSize: 12,
  meetingMinMs: 4000,
  meetingMaxMs: 120000,
});

export const DEFAULT_TIMING = Object.freeze({
  /** "done" bubble stays this long before the agent becomes idle. */
  doneMs: 4000,
  /** "error" state stays this long before the agent becomes idle. */
  errorMs: 8000,
  /** An active agent with no event for this long is considered idle again. */
  staleMs: 120000,
});

const ID_RE = /^[\p{L}\p{N}._:@-]{1,64}$/u;

export const isValidAgentId = (id) => typeof id === 'string' && ID_RE.test(id);

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '');

/**
 * Validate and sanitize an untrusted event (from HTTP, hooks or the demo).
 * Returns a clean event object or null when it must be dropped.
 */
export function normalizeEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type ?? 'status';
  if (!EVENT_TYPES.includes(type)) return null;
  // timestamps from clients are trusted only within a day of our clock
  const ts = Number.isFinite(raw.ts) && Math.abs(raw.ts - now) < 86_400_000 ? raw.ts : now;

  if (type === 'status') {
    if (!isValidAgentId(raw.agent)) return null;
    if (!STATUS_LIST.includes(raw.status)) return null;
    return {
      v: PROTOCOL_VERSION,
      type,
      agent: raw.agent,
      status: raw.status,
      activity: clip(raw.activity, LIMITS.activityLen),
      tool: clip(raw.tool, 48) || null,
      ts,
    };
  }
  if (type === 'delegate') {
    if (!isValidAgentId(raw.from) || !isValidAgentId(raw.to) || raw.from === raw.to) return null;
    return { v: PROTOCOL_VERSION, type, from: raw.from, to: raw.to, task: clip(raw.task, LIMITS.taskLen), ts };
  }
  if (type === 'meeting') {
    // A short stand-up before the work is split: the host and its people meet
    // at the meeting table, then everyone walks back to their desk.
    if (!isValidAgentId(raw.host)) return null;
    const list = Array.isArray(raw.agents) ? raw.agents : [];
    const agents = [...new Set(list.filter((a) => isValidAgentId(a) && a !== raw.host))].slice(0, LIMITS.meetingSize);
    if (!agents.length) return null;
    const dur = Number.isFinite(raw.durationMs) ? raw.durationMs : 20000;
    return {
      v: PROTOCOL_VERSION,
      type,
      host: raw.host,
      agents,
      topic: clip(raw.topic, LIMITS.taskLen),
      durationMs: Math.round(Math.min(LIMITS.meetingMaxMs, Math.max(LIMITS.meetingMinMs, dur))),
      ts,
    };
  }
  // message
  if (!isValidAgentId(raw.agent)) return null;
  const text = clip(raw.text, LIMITS.textLen);
  if (!text) return null;
  return { v: PROTOCOL_VERSION, type, agent: raw.agent, text, ts };
}

function blankAgent(id, now) {
  return {
    id,
    status: STATUS.IDLE,
    activity: '',
    tool: null,
    since: now,
    lastEventAt: now,
    counters: { events: 0, tools: 0, done: 0, errors: 0, delegated: 0, received: 0 },
    time: {},
    history: [],
  };
}

/** Create the live state for a normalized roster. */
export function createState(roster, now = Date.now()) {
  const state = { roster, agents: {}, log: [], seq: 0, startedAt: now, meeting: null };
  for (const a of roster.agents) state.agents[a.id] = blankAgent(a.id, now);
  return state;
}

/**
 * Make sure an agent exists. Unknown agents are added to a "guests"
 * department so that events from agents missing in the roster are never lost.
 */
export function ensureAgent(state, id, now = Date.now()) {
  if (state.agents[id]) return false;
  const roster = state.roster;
  if (!roster.departments.some((d) => d.id === 'guests')) {
    roster.departments.push({ id: 'guests', name: 'Guests', color: '#8b93a7' });
  }
  roster.agents.push({
    id,
    name: id,
    role: 'Guest agent',
    department: 'guests',
    description: 'Appeared in the event stream but is not listed in the roster.',
    model: '',
    tools: [],
    skills: [],
    look: null,
    reportsTo: roster.office.mainAgent || null,
    level: 1,
    tier: 'doer',
    team: [],
    guest: true,
  });
  state.agents[id] = blankAgent(id, now);
  return true;
}

function pushLog(state, entry) {
  state.seq += 1;
  state.log.push({ seq: state.seq, ...entry });
  if (state.log.length > LIMITS.logSize) state.log.splice(0, state.log.length - LIMITS.logSize);
}

function setStatus(state, agent, status, activity, tool, ts, now) {
  const prev = agent.status;
  const changedStatus = prev !== status;
  const changedActivity = agent.activity !== activity;
  if (changedStatus) {
    agent.time[prev] = (agent.time[prev] || 0) + Math.max(0, now - agent.since);
    agent.since = now;
    if (status === STATUS.DONE) agent.counters.done += 1;
    if (status === STATUS.ERROR) agent.counters.errors += 1;
  }
  if (tool && (changedStatus || changedActivity)) agent.counters.tools += 1;
  agent.status = status;
  agent.activity = activity;
  agent.tool = tool;
  agent.lastEventAt = now;
  agent.counters.events += 1;
  if (changedStatus || changedActivity) {
    agent.history.push({ ts, status, activity });
    if (agent.history.length > LIMITS.historySize) agent.history.shift();
    pushLog(state, { kind: 'status', ts, agent: agent.id, status, activity });
  }
  return changedStatus || changedActivity;
}

/**
 * Apply one normalized event. Returns
 * `{ changed: string[], rosterChanged: boolean, delegation: {from,to}|null }`.
 */
export function applyEvent(state, evt, now = Date.now()) {
  const out = { changed: [], rosterChanged: false, delegation: null };
  if (!evt) return out;
  // "Writer" or "writer " from a script means the roster's "writer", not a new guest
  const known = (id) => (state.agents[id] || !id ? id : state.agents[slug(id)] ? slug(id) : id);
  evt = { ...evt };
  for (const k of ['agent', 'from', 'to', 'host']) if (evt[k]) evt[k] = known(evt[k]);
  if (evt.agents) evt.agents = evt.agents.map(known);

  if (evt.type === 'status') {
    out.rosterChanged = ensureAgent(state, evt.agent, now);
    const agent = state.agents[evt.agent];
    if (setStatus(state, agent, evt.status, evt.activity, evt.tool, evt.ts, now)) out.changed.push(agent.id);
    return out;
  }

  if (evt.type === 'delegate') {
    out.rosterChanged = ensureAgent(state, evt.from, now) || out.rosterChanged;
    out.rosterChanged = ensureAgent(state, evt.to, now) || out.rosterChanged;
    state.agents[evt.from].counters.delegated += 1;
    state.agents[evt.to].counters.received += 1;
    pushLog(state, { kind: 'delegate', ts: evt.ts, agent: evt.from, to: evt.to, activity: evt.task });
    out.delegation = { from: evt.from, to: evt.to };
    out.changed.push(evt.from, evt.to);
    return out;
  }

  if (evt.type === 'meeting') {
    for (const id of [evt.host, ...evt.agents]) out.rosterChanged = ensureAgent(state, id, now) || out.rosterChanged;
    const ended = state.meeting ? [state.meeting.host, ...state.meeting.agents] : [];
    state.meeting = { host: evt.host, agents: evt.agents, topic: evt.topic, startedAt: now, endsAt: now + evt.durationMs };
    pushLog(state, { kind: 'meeting', ts: evt.ts, agent: evt.host, count: evt.agents.length, activity: evt.topic });
    out.changed.push(...new Set([...ended, evt.host, ...evt.agents]));
    return out;
  }

  if (evt.type === 'message') {
    out.rosterChanged = ensureAgent(state, evt.agent, now);
    pushLog(state, { kind: 'message', ts: evt.ts, agent: evt.agent, activity: evt.text });
    out.changed.push(evt.agent);
  }
  return out;
}

/**
 * Time-based transitions: done/error fade to idle, stale active states reset.
 * Returns the ids of agents whose status changed.
 */
export function tick(state, now = Date.now(), timing = DEFAULT_TIMING) {
  const changed = [];
  if (state.meeting && now >= state.meeting.endsAt) {
    changed.push(state.meeting.host, ...state.meeting.agents);
    state.meeting = null;
  }
  for (const agent of Object.values(state.agents)) {
    const age = now - agent.since;
    let next = null;
    if (agent.status === STATUS.DONE && age >= timing.doneMs) next = STATUS.IDLE;
    else if (agent.status === STATUS.ERROR && age >= timing.errorMs) next = STATUS.IDLE;
    else if (ACTIVE.has(agent.status) && now - agent.lastEventAt >= timing.staleMs) next = STATUS.IDLE;
    if (next) {
      agent.time[agent.status] = (agent.time[agent.status] || 0) + Math.max(0, now - agent.since);
      agent.status = next;
      agent.activity = '';
      agent.tool = null;
      agent.since = now;
      changed.push(agent.id);
    }
  }
  return changed;
}

/** Aggregate counters for the header. */
export function summarize(state) {
  const sum = { total: 0, active: 0, blocked: 0, idle: 0, done: 0, error: 0, sleeping: 0 };
  for (const a of Object.values(state.agents)) {
    sum.total += 1;
    if (ACTIVE.has(a.status)) sum.active += 1;
    else if (BLOCKED.has(a.status)) sum.blocked += 1;
    else if (a.status === STATUS.DONE) sum.done += 1;
    else if (a.status === STATUS.ERROR) sum.error += 1;
    else if (a.status === STATUS.SLEEPING) sum.sleeping += 1;
    else sum.idle += 1;
  }
  return sum;
}

/** Ids of everyone in the meeting that is running right now, or an empty list. */
export function meetingMembers(state, now = Date.now()) {
  const m = state.meeting;
  if (!m || now >= m.endsAt) return [];
  return [m.host, ...m.agents];
}

/** Serializable snapshot for new clients. */
export function snapshot(state) {
  return {
    v: PROTOCOL_VERSION,
    roster: state.roster,
    agents: state.agents,
    log: state.log.slice(-120),
    startedAt: state.startedAt,
    meeting: state.meeting,
  };
}

/** Restore a state from a snapshot (client side). */
export function restore(snap) {
  return {
    roster: snap.roster,
    agents: snap.agents,
    log: snap.log || [],
    seq: (snap.log && snap.log.length ? snap.log[snap.log.length - 1].seq : 0) || 0,
    startedAt: snap.startedAt || Date.now(),
    meeting: snap.meeting && Number.isFinite(snap.meeting.endsAt) ? snap.meeting : null,
  };
}
