import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describeTool, fromClaudeHook, resolveAgent, statusForTool } from '../server/events.js';
import { CORE_EVENTS, buildHookConfig, mergeHooks, readSettings, removeHooks, writeSettings } from '../server/hooks.js';
import { createSimulator } from '../web/js/sim/demo.js';
import { applyEvent, createState, normalizeEvent, STATUS } from '../web/js/core/model.js';
import { normalizeRoster } from '../web/js/core/roster.js';

const ids = new Set(['director', 'backend', 'qa']);
const ctx = (extra = {}) => ({ has: (id) => ids.has(id), main: 'director', ...extra });

test('describeTool: short labels, never full paths or contents', () => {
  assert.equal(describeTool('Read', { file_path: 'C:\\Users\\me\\proj\\src\\app.js' }), 'Reading app.js');
  assert.equal(describeTool('Edit', { file_path: '/home/me/x/y.ts' }), 'Editing y.ts');
  assert.equal(describeTool('Write', { file_path: '/a/b.md' }), 'Writing b.md');
  assert.equal(describeTool('Bash', { command: 'npm test --silent' }), 'Running npm');
  assert.equal(describeTool('Bash', { command: 'ls', description: 'List files' }), 'Running: List files');
  assert.equal(describeTool('Grep', { pattern: 'TODO' }), 'Searching code: TODO');
  assert.equal(describeTool('WebSearch', { query: 'node test runner' }), 'Searching the web: node test runner');
  assert.equal(describeTool('Task', { subagent_type: 'qa' }), 'Delegating to qa');
  assert.equal(describeTool('mcp__github__create_issue', {}), 'Using github: create_issue');
  assert.equal(describeTool('Weird', null), 'Using Weird');
  assert.ok(describeTool('Bash', { description: 'x'.repeat(500) }).length < 100);
});

test('statusForTool maps tool families to statuses', () => {
  assert.equal(statusForTool('Read'), STATUS.READING);
  assert.equal(statusForTool('MultiEdit'), STATUS.TYPING);
  assert.equal(statusForTool('Bash'), STATUS.RUNNING);
  assert.equal(statusForTool('WebFetch'), STATUS.SEARCHING);
  assert.equal(statusForTool('Task'), STATUS.DELEGATING);
  assert.equal(statusForTool('mcp__x__y'), STATUS.RUNNING);
});

test('resolveAgent: pin > agent_type > main', () => {
  assert.equal(resolveAgent({}, ctx()), 'director');
  assert.equal(resolveAgent({ agent_type: 'qa' }, ctx()), 'qa');
  assert.equal(resolveAgent({ agent_type: 'QA' }, ctx()), 'qa');
  assert.equal(resolveAgent({ agent_type: 'qa' }, ctx({ pinned: 'backend' })), 'backend');
  assert.equal(resolveAgent({}, ctx({ pinned: 'stranger' })), 'stranger');
  assert.equal(resolveAgent({ agent_type: 'new-one' }, ctx()), 'new-one');
});

test('hook events: full session lifecycle', () => {
  const ev = (name, extra = {}) => fromClaudeHook({ hook_event_name: name, ...extra }, ctx());
  assert.equal(ev('UserPromptSubmit', { prompt: 'secret' })[0].activity, 'Received a task');
  assert.equal(fromClaudeHook({ hook_event_name: 'UserPromptSubmit', prompt: 'Fix the login bug' }, ctx({ sharePrompts: true }))[0].activity, 'Task: Fix the login bug');
  assert.equal(ev('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.js' } })[0].status, 'typing');
  assert.equal(ev('PostToolUse', { tool_name: 'Edit' })[0].status, 'thinking');
  assert.equal(ev('Notification', { message: 'Claude needs your permission to use Bash' })[0].status, 'permission');
  assert.equal(ev('Notification', { message: 'Claude is waiting for your input' })[0].status, 'waiting');
  assert.equal(ev('Stop')[0].status, 'done');
  assert.equal(ev('PostToolUseFailure', { tool_name: 'Bash' })[0].status, 'error');
  assert.equal(ev('PermissionRequest', { tool_name: 'Bash' })[0].status, 'permission');
  assert.equal(ev('SessionEnd')[0].status, 'idle');
  assert.deepEqual(ev('SomethingNew'), []);
  assert.deepEqual(fromClaudeHook(null, ctx()), []);
  assert.deepEqual(fromClaudeHook({}, ctx()), []);
});

test('hook events: Task tool produces a delegation to the named subagent', () => {
  const out = fromClaudeHook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'qa', description: 'Run the tests' } }, ctx());
  assert.equal(out.length, 2);
  assert.equal(out[0].status, 'delegating');
  assert.deepEqual({ type: out[1].type, from: out[1].from, to: out[1].to, task: out[1].task }, { type: 'delegate', from: 'director', to: 'qa', task: '' });
  // a subagent calling Task is the delegator itself
  const nested = fromClaudeHook({ hook_event_name: 'PreToolUse', agent_type: 'backend', tool_name: 'Task', tool_input: { subagent_type: 'qa' } }, ctx());
  assert.equal(nested[1].from, 'backend');
});

test('hook events: subagent start/stop', () => {
  const start = fromClaudeHook({ hook_event_name: 'SubagentStart', agent_type: 'qa' }, ctx());
  assert.equal(start[0].agent, 'qa');
  const stop = fromClaudeHook({ hook_event_name: 'SubagentStop', agent_type: 'qa' }, ctx());
  assert.deepEqual(stop.map((e) => [e.agent, e.status]), [['qa', 'done'], ['director', 'thinking']]);
});

test('every produced event survives normalizeEvent', () => {
  for (const name of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop']) {
    for (const e of fromClaudeHook({ hook_event_name: name, tool_name: 'Read', tool_input: { file_path: 'a' }, message: 'm', agent_type: 'qa' }, ctx())) {
      assert.ok(normalizeEvent(e), `${name} -> ${JSON.stringify(e)}`);
    }
  }
});

// --- hook installer --------------------------------------------------------
test('hooks: config covers the core events and is idempotent to merge', () => {
  const cfg = buildHookConfig({ scriptPath: 'C:\\tools\\agent-office\\hook\\agent-office-hook.js' });
  assert.deepEqual(Object.keys(cfg.hooks), CORE_EVENTS);
  const cmd = cfg.hooks.Stop[0].hooks[0].command;
  assert.equal(cmd, 'node "C:/tools/agent-office/hook/agent-office-hook.js"');
  assert.equal(cfg.hooks.PreToolUse[0].matcher, '*');
  assert.equal(cfg.hooks.Stop[0].matcher, undefined);
  assert.ok(buildHookConfig({ all: true }).hooks.PermissionRequest);
  assert.match(buildHookConfig({ pinnedAgent: 'backend' }).hooks.Stop[0].hooks[0].command, /^AGENT_OFFICE_AGENT=backend node /);

  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, theme: 'dark' };
  const once = mergeHooks(mine, cfg);
  const twice = mergeHooks(once, cfg);
  assert.deepEqual(once, twice);
  assert.equal(twice.hooks.Stop.length, 2, 'the user hook is kept, ours added once');
  assert.equal(twice.theme, 'dark');
});

test('hooks: uninstall removes only our entries', () => {
  const cfg = buildHookConfig({});
  const merged = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, cfg);
  const cleaned = removeHooks(merged);
  assert.deepEqual(Object.keys(cleaned.hooks), ['Stop']);
  assert.equal(cleaned.hooks.Stop[0].hooks[0].command, 'echo mine');
  assert.equal(removeHooks(mergeHooks({}, cfg)).hooks, undefined);
  assert.deepEqual(removeHooks({}), {});
});

test('hooks: writeSettings makes a backup and readSettings rejects broken JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-settings-'));
  const file = path.join(dir, '.claude', 'settings.json');
  assert.deepEqual(readSettings(file), {});
  assert.equal(writeSettings(file, { a: 1 }), null);
  const backup = writeSettings(file, { a: 2 });
  assert.ok(backup && fs.existsSync(backup));
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).a, 1);
  fs.writeFileSync(file, '{ broken');
  assert.throws(() => readSettings(file), /not valid JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- simulator -------------------------------------------------------------
test('simulator: produces valid events, is reproducible and never leaves agents stuck', () => {
  const roster = normalizeRoster(JSON.parse(fs.readFileSync(new URL('../agents.example.json', import.meta.url), 'utf8')));
  const run = (seed) => {
    const events = [];
    const sim = createSimulator({ getRoster: () => roster, emit: (e) => events.push(e), seed, speed: 20 });
    let now = 1_000_000;
    for (let i = 0; i < 4000; i++) {
      now += 50;
      sim.tick(now);
    }
    return events;
  };
  const a = run(3);
  const b = run(3);
  assert.ok(a.length > 50, `got ${a.length} events`);
  assert.deepEqual(a.map((e) => [e.type, e.agent, e.status, e.from, e.to]), b.map((e) => [e.type, e.agent, e.status, e.from, e.to]));
  const state = createState(roster);
  for (const e of a) assert.ok(normalizeEvent(e), JSON.stringify(e));
  for (const e of a) applyEvent(state, normalizeEvent(e));
  assert.ok(a.some((e) => e.type === 'delegate'));
  assert.ok(a.some((e) => e.status === 'permission'));
  assert.ok(a.some((e) => e.status === 'done'));
  assert.ok(new Set(a.filter((e) => e.type === 'status').map((e) => e.agent)).size >= 6, 'many different agents work');
});

test('simulator: assign gives a specific agent a task, and refuses while busy', () => {
  const roster = normalizeRoster({ agents: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  const events = [];
  const sim = createSimulator({ getRoster: () => roster, emit: (e) => events.push(e), seed: 1, speed: 50, maxScenarios: 0 });
  assert.equal(sim.assign('b', 0), true);
  assert.equal(sim.assign('b', 0), false);
  assert.equal(sim.assign('zzz', 0), false);
  for (let t = 0; t < 60_000; t += 50) sim.tick(t);
  assert.ok(events.length > 0 && events.every((e) => e.agent === 'b'));
  assert.equal(events.at(-1).status, 'done');
});
