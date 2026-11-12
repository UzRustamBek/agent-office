// Tasks dashboard: the model (start/end, crew, phases, stale), the hook mapping and the server.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, applyEvent, createState, normalizeEvent, restore, snapshot, sortedTasks, taskPhase, tick } from '../web/js/core/model.js';
import { normalizeRoster } from '../web/js/core/roster.js';
import { fromClaudeHook } from '../server/events.js';
import { createOfficeServer, loadRosterFile } from '../server/server.js';

const roster = () =>
  normalizeRoster({
    office: { mainAgent: 'boss' },
    agents: [
      { id: 'boss', name: 'Boss' },
      { id: 'a', name: 'A', reportsTo: 'boss' },
      { id: 'b', name: 'B', reportsTo: 'boss' },
    ],
  });
const T0 = 1_000_000;
const send = (state, raw, now) => applyEvent(state, normalizeEvent(raw, now), now);
const start = (state, id = 't1', title = 'Fix it', now = T0) => send(state, { type: 'task', action: 'start', id, agent: 'boss', title, ts: now }, now);

test('task events are validated and clipped', () => {
  assert.equal(normalizeEvent({ type: 'task', action: 'start', id: '', agent: 'boss' }), null);
  assert.equal(normalizeEvent({ type: 'task', action: 'start', id: 'x', agent: 'bad agent!' }), null);
  assert.equal(normalizeEvent({ type: 'task', action: 'nope', id: 'x', agent: 'boss' }), null);
  assert.equal(normalizeEvent({ type: 'task', action: 'end', id: 'x', outcome: 'weird' }).outcome, 'done');
  const e = normalizeEvent({ type: 'status', agent: 'a', status: 'typing', taskId: 'x'.repeat(200) });
  assert.equal(e.taskId.length, LIMITS.taskIdLen);
  assert.equal(normalizeEvent({ type: 'status', agent: 'a', status: 'typing' }).taskId, undefined);
});

test('a task collects its crew, tool calls and an activity trail, then ends', () => {
  const s = createState(roster(), T0);
  start(s);
  send(s, { type: 'status', agent: 'boss', status: 'thinking', activity: 'Planning', taskId: 't1' }, T0 + 1000);
  send(s, { type: 'delegate', from: 'boss', to: 'a', taskId: 't1' }, T0 + 2000);
  send(s, { type: 'status', agent: 'a', status: 'reading', activity: 'Reading x.md', tool: 'Read', taskId: 't1' }, T0 + 3000);
  send(s, { type: 'status', agent: 'a', status: 'reading', activity: 'Reading x.md', tool: 'Read', taskId: 't1' }, T0 + 3500);
  send(s, { type: 'status', agent: 'a', status: 'error', activity: 'Read failed', tool: 'Read', taskId: 't1' }, T0 + 4000);
  const t = s.tasks[0];
  assert.deepEqual(t.agents, ['boss', 'a']);
  assert.equal(t.tools, 3);
  assert.equal(t.errors, 1);
  assert.deepEqual(t.steps.map((x) => x.text), ['Planning', 'Reading x.md'], 'repeats are not listed twice; errors are not "steps"');
  assert.equal(taskPhase(s, t, T0 + 5000), 'working');

  send(s, { type: 'task', action: 'end', id: 't1', outcome: 'done' }, T0 + 6000);
  assert.equal(t.endedAt, T0 + 6000);
  assert.equal(taskPhase(s, t, T0 + 6000), 'done');
  // late events no longer change a finished task
  send(s, { type: 'status', agent: 'b', status: 'typing', tool: 'Edit', taskId: 't1' }, T0 + 7000);
  assert.deepEqual(t.agents, ['boss', 'a']);
  assert.equal(t.tools, 3);
});

test('events for an unknown task id change nothing about tasks', () => {
  const s = createState(roster(), T0);
  send(s, { type: 'status', agent: 'a', status: 'typing', tool: 'Edit', taskId: 'ghost' }, T0);
  assert.equal(s.tasks.length, 0);
});

test('phase: needs-you beats meeting beats working; finished tasks report how they ended', () => {
  const s = createState(roster(), T0);
  start(s);
  send(s, { type: 'meeting', host: 'boss', agents: ['a'], topic: 'x', durationMs: 20000, taskId: 't1' }, T0 + 100);
  const t = s.tasks[0];
  assert.equal(taskPhase(s, t, T0 + 1000), 'meeting');
  assert.equal(taskPhase(s, t, T0 + 30000), 'working', 'meeting is over');
  send(s, { type: 'status', agent: 'a', status: 'permission', activity: 'Needs approval', taskId: 't1' }, T0 + 31000);
  assert.equal(taskPhase(s, t, T0 + 32000), 'needs-you');
  send(s, { type: 'task', action: 'end', id: 't1', outcome: 'abandoned' }, T0 + 40000);
  assert.equal(taskPhase(s, t, T0 + 41000), 'stale');
  start(s, 't2');
  send(s, { type: 'task', action: 'end', id: 't2', outcome: 'error' }, T0 + 42000);
  assert.equal(taskPhase(s, s.tasks[1], T0 + 43000), 'failed');
});

test('an unfinished task with no events is closed as abandoned; busy ones are not', () => {
  const s = createState(roster(), T0);
  start(s, 'quiet');
  start(s, 'busy');
  send(s, { type: 'status', agent: 'a', status: 'typing', activity: 'x', tool: 'Edit', taskId: 'busy' }, T0 + LIMITS.taskStaleMs - 1000);
  tick(s, T0 + LIMITS.taskStaleMs + 1);
  const by = Object.fromEntries(s.tasks.map((t) => [t.id, t]));
  assert.equal(by.quiet.outcome, 'abandoned');
  assert.equal(by.busy.endedAt, null);
});

test('sorted: open first (newest first), then finished (latest first); old finished tasks are trimmed, open ones never', () => {
  const s = createState(roster(), T0);
  for (let i = 0; i < LIMITS.tasksKept + 10; i++) {
    start(s, `d${i}`, '', T0 + i);
    send(s, { type: 'task', action: 'end', id: `d${i}`, outcome: 'done' }, T0 + i + 1);
  }
  start(s, 'open1', '', T0 + 1000);
  start(s, 'open2', '', T0 + 2000);
  assert.ok(s.tasks.length <= LIMITS.tasksKept);
  const order = sortedTasks(s).map((t) => t.id);
  assert.deepEqual(order.slice(0, 2), ['open2', 'open1']);
  assert.equal(order[2], `d${LIMITS.tasksKept + 9}`);
});

test('snapshot and restore keep the tasks', () => {
  const s = createState(roster(), T0);
  start(s);
  const r = restore(JSON.parse(JSON.stringify(snapshot(s))));
  assert.equal(r.tasks[0].id, 't1');
  assert.equal(r.taskSeq, 1);
  assert.deepEqual(restore({ roster: s.roster, agents: s.agents }).tasks, [], 'old snapshots without tasks still load');
});

// --- hook mapping ----------------------------------------------------------------
function makeCtx(extra = {}) {
  const sessions = new Map();
  let n = 0;
  return {
    sessions,
    ctx: {
      has: (id) => ['boss', 'a', 'b'].includes(id),
      main: 'boss',
      team: (id) => (id === 'boss' ? ['a', 'b'] : []),
      meetingMs: 0,
      taskFor: (sid, mode) => {
        const known = sessions.get(sid);
        if (known && mode !== 'start') return { key: known, created: false };
        if (mode === 'peek') return null;
        const key = `${sid}-${++n}`;
        sessions.set(sid, key);
        return { key, created: true, previous: mode === 'start' ? known : undefined };
      },
      endTask: (sid) => sessions.delete(sid),
      ...extra,
    },
  };
}
const hook = (ctx, name, extra = {}) => fromClaudeHook({ hook_event_name: name, session_id: 's1', ...extra }, ctx);

test('hooks: a prompt starts a task, its events carry the id, Stop ends it', () => {
  const { ctx, sessions } = makeCtx({ sharePrompts: true });
  const first = hook(ctx, 'UserPromptSubmit', { prompt: 'Fix the login bug' });
  assert.deepEqual(first.map((e) => e.type), ['task', 'status']);
  assert.equal(first[0].title, 'Fix the login bug');
  const id = first[0].id;
  assert.equal(first[1].taskId, id);
  const tool = hook(ctx, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x.md' } });
  assert.deepEqual(tool.map((e) => e.type), ['status']);
  assert.equal(tool[0].taskId, id);
  const stop = hook(ctx, 'Stop');
  assert.deepEqual(stop.map((e) => [e.type, e.action ?? e.status]), [['status', 'done'], ['task', 'end']]);
  assert.equal(stop[1].id, id);
  assert.equal(sessions.has('s1'), false);
  // after Stop nothing belongs to the finished task
  assert.equal(hook(ctx, 'Notification', { message: 'waiting' })[0].taskId, undefined);
});

test('hooks: without --share-prompts the title stays empty', () => {
  const { ctx } = makeCtx();
  assert.equal(hook(ctx, 'UserPromptSubmit', { prompt: 'secret' })[0].title, '');
});

test('hooks: a session we meet mid-way gets a task on its first work event', () => {
  const { ctx } = makeCtx();
  const out = hook(ctx, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.deepEqual(out.map((e) => e.type), ['task', 'status']);
  assert.equal(out[0].agent, 'boss');
  assert.equal(hook(ctx, 'PostToolUse').length, 1, 'the second work event does not start another task');
});

test('hooks: a new prompt closes the previous unfinished task (you pressed Esc)', () => {
  const { ctx } = makeCtx();
  const a = hook(ctx, 'UserPromptSubmit', { prompt: 'one' })[0].id;
  const out = hook(ctx, 'UserPromptSubmit', { prompt: 'two' });
  assert.deepEqual([out[0].type, out[0].action, out[0].id, out[0].outcome], ['task', 'end', a, 'abandoned']);
  assert.equal(out[1].action, 'start');
  assert.notEqual(out[1].id, a);
});

test('hooks: delegation and meeting carry the task id; no session id means no tasks', () => {
  const { ctx } = makeCtx({ meetingMs: 20000 });
  const out = hook(ctx, 'UserPromptSubmit', { prompt: 'x' });
  assert.equal(out.find((e) => e.type === 'meeting').taskId, out[0].id);
  const d = hook(ctx, 'PreToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'a' } });
  assert.equal(d.find((e) => e.type === 'delegate').taskId, out[0].id);
  const none = fromClaudeHook({ hook_event_name: 'PreToolUse', tool_name: 'Read' }, ctx);
  assert.ok(none.every((e) => e.type !== 'task' && e.taskId === undefined));
});

// --- server -----------------------------------------------------------------------
const TOKEN = 'tasks-token';
let office;
let base;
before(async () => {
  process.env.AGENT_OFFICE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-tasks-'));
  const here = path.dirname(fileURLToPath(import.meta.url));
  office = createOfficeServer({ roster: loadRosterFile(path.join(here, '..', 'agents.example.json')), port: 0, token: TOKEN, quiet: true, meetingMs: 0 });
  base = (await office.start()).url;
});
after(async () => {
  await office.stop();
});
function post(route, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, base);
    const data = JSON.stringify(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${TOKEN}` } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(data);
  });
}
const state = () => fetch(`${base}/api/state`).then((r) => r.json());

test('server: two Claude Code sessions are two tasks, and Stop finishes only its own', async () => {
  const h = (session_id, hook_event_name, extra = {}) => post('/api/hook', { source: 'claude', payload: { session_id, hook_event_name, ...extra } });
  await h('aaaa1111', 'UserPromptSubmit', { prompt: 'p1' });
  await h('bbbb2222', 'UserPromptSubmit', { prompt: 'p2' });
  await h('aaaa1111', 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } });
  let s = await state();
  assert.equal(s.tasks.length, 2);
  assert.ok(s.tasks.every((t) => !t.endedAt));
  assert.equal(s.tasks.find((t) => t.id.startsWith('aaaa1111')).tools, 1);
  await h('aaaa1111', 'Stop');
  s = await state();
  const by = Object.fromEntries(s.tasks.map((t) => [t.id.slice(0, 8), t]));
  assert.equal(by.aaaa1111.outcome, 'done');
  assert.equal(by.bbbb2222.endedAt, null);
  // the snapshot a new browser gets contains the tasks
  assert.equal(s.tasks.length, 2);
});

test('hooks install --share-prompts puts the opt-in in the command', async () => {
  const { buildHookConfig } = await import('../server/hooks.js');
  const cmd = (o) => buildHookConfig(o).hooks.UserPromptSubmit[0].hooks[0].command;
  assert.ok(!cmd({}).includes('SHARE_PROMPTS'));
  assert.match(cmd({ sharePrompts: true }), /^AGENT_OFFICE_SHARE_PROMPTS=1 node /);
  assert.match(cmd({ sharePrompts: true, pinnedAgent: 'a' }), /^AGENT_OFFICE_AGENT=a AGENT_OFFICE_SHARE_PROMPTS=1 node /);
});
