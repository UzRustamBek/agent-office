import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRoster } from '../web/js/core/roster.js';
import { ensureAgent, createState } from '../web/js/core/model.js';
import { buildLayout, unreachableSeats } from '../web/js/core/layout.js';
import { createSimulator } from '../web/js/sim/demo.js';
import { World } from '../web/js/office/world.js';
import { STATUS } from '../web/js/core/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(fs.readFileSync(path.join(here, '..', 'agents.example.json'), 'utf8'));

const byId = (roster) => Object.fromEntries(roster.agents.map((a) => [a.id, a]));

test('explicit reportsTo builds levels, tiers and teams', () => {
  const r = normalizeRoster(example);
  const a = byId(r);
  assert.equal(a.director.reportsTo, null);
  assert.equal(a.director.level, 0);
  assert.equal(a.director.tier, 'chief');
  assert.equal(a.architect.reportsTo, 'director');
  assert.equal(a.architect.tier, 'manager');
  assert.equal(a.security.level, 3); // director > architect > devops > security
  assert.equal(a.security.tier, 'doer');
  assert.deepEqual(a.devops.team, ['security']);
  assert.ok(a.director.team.includes('architect'));
});

test('without hints: main agent on top, department heads recognised by title', () => {
  const r = normalizeRoster({
    office: { mainAgent: 'boss' },
    agents: [
      { id: 'boss', name: 'Boss', department: 'hq' },
      { id: 'dev1', name: 'Dev One', department: 'it' },
      { id: 'cto', name: 'Chief Tech', role: 'CTO and team lead', department: 'it' },
      { id: 'dev2', name: 'Dev Two', department: 'it' },
      { id: 'ops', name: 'Ops', department: 'ops' },
    ],
  });
  const a = byId(r);
  assert.equal(a.boss.tier, 'chief');
  assert.equal(a.cto.reportsTo, 'boss');
  assert.equal(a.dev1.reportsTo, 'cto');
  assert.equal(a.dev2.reportsTo, 'cto');
  assert.equal(a.ops.reportsTo, 'boss'); // no head in the department: straight to the main agent
  assert.equal(a.dev1.level, 2);
});

test('`lead: true` marks a department head', () => {
  const r = normalizeRoster({
    agents: [
      { id: 'boss', name: 'Boss', department: 'hq' },
      { id: 'a', name: 'A', department: 'x' },
      { id: 'b', name: 'B', department: 'x', lead: true },
    ],
  });
  assert.equal(byId(r).a.reportsTo, 'b');
  assert.equal(byId(r).b.reportsTo, 'boss');
});

test('reportsTo accepts names, null means top-level, and bad values are reported', () => {
  const r = normalizeRoster({
    agents: [
      { id: 'a', name: 'Alpha', department: 'x', reportsTo: null },
      { id: 'b', name: 'Beta', department: 'x', reportsTo: 'alpha' },
      { id: 'c', name: 'Gamma', department: 'x', reportsTo: 'Beta' },
      { id: 'd', name: 'Delta', department: 'x', reportsTo: null },
    ],
  });
  assert.equal(byId(r).c.reportsTo, 'b');
  assert.equal(byId(r).d.level, 0); // several top-level agents are allowed
  // problems do not throw the roster away: the agent is placed automatically and a warning is listed
  const typo = normalizeRoster({ agents: [{ id: 'boss', name: 'Boss' }, { id: 'a', name: 'A', reportsTo: 'nobody-here' }] });
  assert.equal(byId(typo).a.reportsTo, 'boss');
  assert.match(typo.warnings[0], /not an agent/);
  const self = normalizeRoster({ agents: [{ id: 'a', name: 'A', reportsTo: 'a' }] });
  assert.equal(byId(self).a.reportsTo, null);
  assert.match(self.warnings[0], /itself/);
  const loop = normalizeRoster({
    agents: [
      { id: 'a', name: 'A', reportsTo: 'b' },
      { id: 'b', name: 'B', reportsTo: 'a' },
    ],
  });
  assert.match(loop.warnings[0], /cycle/);
  assert.ok(loop.agents.some((x) => x.level === 0), 'the loop is broken at the top');
  assert.deepEqual(normalizeRoster(example).warnings, []);
});

test('layout: the top zone sits alone above the departments, desks follow the levels', () => {
  const roster = normalizeRoster(example);
  const layout = buildLayout(roster);
  const top = layout.zones.find((z) => z.top);
  assert.equal(top.id, 'command');
  const others = layout.zones.filter((z) => !z.top);
  assert.ok(others.length >= 4);
  for (const z of others) assert.ok(z.y >= top.y + top.h + 2, 'departments start below the corridor');

  // the chief's desk is above everyone else's in the same zone
  const dir = layout.desks.director.seat;
  for (const id of ['planner', 'reviewer', 'analyst']) assert.ok(layout.desks[id].seat.y > dir.y);
  // a deeper level is always further down
  assert.ok(layout.desks.security.seat.y > layout.desks.devops.seat.y);
  assert.ok(layout.desks.devops.seat.y > layout.desks.architect.seat.y);

  assert.ok(layout.orgLines.length > 0);
  assert.deepEqual(unreachableSeats(layout), []);
  // desks carry their tier so they can be drawn differently
  const f = layout.furniture.find((x) => x.type === 'desk' && x.agent === 'director');
  assert.equal(f.tier, 'chief');
});

test('layout stays valid for flat rosters and for a single department', () => {
  const flat = normalizeRoster({ agents: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, department: `d${i % 3}` })) });
  const l1 = buildLayout(flat);
  assert.deepEqual(unreachableSeats(l1), []);
  assert.equal(l1.zones.filter((z) => z.top).length, 1);
  const one = normalizeRoster({ agents: [{ id: 'solo', name: 'Solo' }] });
  assert.deepEqual(unreachableSeats(buildLayout(one)), []);
});

test('a large organisation lays out without overlap and stays reachable', () => {
  const agents = [{ id: 'ceo', name: 'CEO', department: 'hq', reportsTo: null }];
  for (let d = 0; d < 6; d++) {
    agents.push({ id: `h${d}`, name: `Head ${d}`, department: `dep${d}`, reportsTo: 'ceo' });
    for (let i = 0; i < 9; i++) agents.push({ id: `w${d}-${i}`, name: `W ${d}-${i}`, department: `dep${d}`, reportsTo: `h${d}` });
  }
  const layout = buildLayout(normalizeRoster({ office: { mainAgent: 'ceo' }, agents }));
  assert.deepEqual(unreachableSeats(layout), []);
  const seats = new Set();
  for (const d of Object.values(layout.desks)) {
    const key = `${d.seat.x},${d.seat.y}`;
    assert.ok(!seats.has(key), `two desks share ${key}`);
    seats.add(key);
  }
  assert.equal(seats.size, agents.length);
});

test('guest agents report to the main agent', () => {
  const state = createState(normalizeRoster(example));
  ensureAgent(state, 'stranger');
  const g = state.roster.agents.find((a) => a.id === 'stranger');
  assert.equal(g.reportsTo, 'director');
  assert.equal(g.tier, 'doer');
});

test('demo simulator delegates down the reporting lines only', () => {
  const roster = normalizeRoster(example);
  const events = [];
  const sim = createSimulator({ getRoster: () => roster, emit: (e) => events.push(e), seed: 5, speed: 8 });
  for (let t = 0; t < 120000; t += 100) sim.tick(t);
  const delegations = events.filter((e) => e.type === 'delegate');
  assert.ok(delegations.length > 5, 'some delegations happened');
  const a = byId(roster);
  for (const d of delegations) assert.equal(a[d.to].reportsTo, d.from, `${d.from} -> ${d.to} is not a reporting line`);
  // a manager's reports are briefed before they start working
  assert.ok(delegations.some((d) => a[d.to].tier === 'doer'));
  assert.ok(delegations.some((d) => a[d.from].tier === 'manager'));
});

test('breaks: off keeps everyone seated, rare keeps most seated, normal lets them roam', () => {
  const roster = normalizeRoster(example);
  const layout = buildLayout(roster);
  const idle = () => STATUS.IDLE;
  const away = (mode) => {
    const world = new World(roster, layout, { seed: 3, now: 0, breaks: mode });
    let peak = 0;
    for (let t = 0; t < 600000; t += 200) {
      world.update(0.2, t, idle);
      peak = Math.max(peak, [...world.chars.values()].filter((c) => c.mode !== 'seated').length);
    }
    return peak;
  };
  assert.equal(away('off'), 0);
  const rare = away('rare');
  const normal = away('normal');
  assert.ok(rare <= Math.max(1, Math.round(roster.agents.length * 0.1)));
  assert.ok(normal > rare);
});

test('switching breaks off sends strolling agents back to their desks', () => {
  const roster = normalizeRoster(example);
  const layout = buildLayout(roster);
  const world = new World(roster, layout, { seed: 3, now: 0, breaks: 'normal' });
  const idle = () => STATUS.IDLE;
  let t = 0;
  for (; t < 120000; t += 200) world.update(0.2, t, idle);
  world.setBreaks('off');
  for (let i = 0; i < 600; i++, t += 200) world.update(0.2, t, idle);
  assert.equal([...world.chars.values()].filter((c) => c.mode !== 'seated').length, 0);
});

// --- meetings ---------------------------------------------------------------
import { applyEvent, meetingMembers, normalizeEvent, tick, snapshot, restore } from '../web/js/core/model.js';
import { fromClaudeHook } from '../server/events.js';

test('meeting events are validated and kept in the state until they end', () => {
  assert.equal(normalizeEvent({ type: 'meeting', host: 'a', agents: [] }), null);
  assert.equal(normalizeEvent({ type: 'meeting', host: 'bad id!', agents: ['b'] }), null);
  const e = normalizeEvent({ type: 'meeting', host: 'director', agents: ['director', 'planner', 'planner', 'x y'], topic: 'Plan', durationMs: 5 });
  assert.deepEqual(e.agents, ['planner']); // host, duplicates and invalid ids removed
  assert.equal(e.durationMs, 4000); // clamped to the minimum

  const state = createState(normalizeRoster(example));
  applyEvent(state, normalizeEvent({ type: 'meeting', host: 'director', agents: ['planner', 'analyst'], topic: 'Q3', durationMs: 10000 }), 1000);
  assert.deepEqual(meetingMembers(state, 2000), ['director', 'planner', 'analyst']);
  assert.equal(state.log.at(-1).kind, 'meeting');
  assert.equal(restore(JSON.parse(JSON.stringify(snapshot(state)))).meeting.host, 'director');
  assert.ok(tick(state, 11001).includes('planner'));
  assert.equal(state.meeting, null);
});

test('a prompt in Claude Code opens a kick-off meeting with the direct reports', () => {
  const roster = normalizeRoster(example);
  const team = (id) => roster.agents.find((a) => a.id === id)?.team || [];
  const ctx = { has: (id) => roster.agents.some((a) => a.id === id), main: 'director', team, meetingMs: 15000 };
  const out = fromClaudeHook({ hook_event_name: 'UserPromptSubmit', prompt: 'secret text' }, ctx);
  const m = out.find((e) => e.type === 'meeting');
  assert.equal(m.host, 'director');
  assert.deepEqual(m.agents, team('director').slice(0, 8));
  assert.equal(m.topic, ''); // prompts stay private without --share-prompts
  assert.ok(!fromClaudeHook({ hook_event_name: 'UserPromptSubmit' }, { ...ctx, meetingMs: 0 }).some((e) => e.type === 'meeting'));
  // an agent without a team just starts thinking
  const solo = fromClaudeHook({ hook_event_name: 'UserPromptSubmit', agent_type: 'security' }, ctx);
  assert.ok(!solo.some((e) => e.type === 'meeting'));
});

test('world: attendees walk to the meeting, sit, and go back to their desks afterwards', () => {
  const roster = normalizeRoster(example);
  const layout = buildLayout(roster);
  const world = new World(roster, layout, { seed: 2, now: 0, breaks: 'off' });
  const meeting = { host: 'director', agents: ['planner', 'architect', 'writer'], topic: 'x', startedAt: 0, endsAt: 60000 };
  const idle = () => STATUS.IDLE;
  let t = 0;
  for (; t < 40000; t += 100) world.update(0.1, t, idle, meeting);
  const seats = new Set();
  for (const id of ['director', 'planner', 'architect', 'writer']) {
    const ch = world.get(id);
    assert.equal(ch.mode, 'spot', `${id} is seated in the meeting`);
    assert.ok(ch.meeting);
    seats.add(ch.spot.id);
  }
  assert.equal(seats.size, 4, 'everyone has their own place');
  assert.equal(world.get('director').spot.kind, 'board', 'the host stands at the whiteboard');
  assert.ok(world.speakerAt(t));
  for (; t < 120000; t += 100) world.update(0.1, t, idle, meeting); // meeting ended at 60 s
  for (const id of ['director', 'planner', 'architect', 'writer']) assert.equal(world.get(id).mode, 'seated', `${id} is back at the desk`);
});

test('demo: big tasks open with a meeting, delegations follow it, one meeting at a time', () => {
  const roster = normalizeRoster(example);
  const events = [];
  const sim = createSimulator({ getRoster: () => roster, emit: (e) => events.push({ ...e, at: clock }), seed: 9, speed: 1, maxScenarios: 3 });
  let clock = 0;
  for (; clock < 400000; clock += 100) sim.tick(clock);
  const meetings = events.filter((e) => e.type === 'meeting');
  assert.ok(meetings.length >= 2);
  for (let i = 1; i < meetings.length; i++) assert.ok(meetings[i].at >= meetings[i - 1].at + meetings[i - 1].durationMs, 'meetings never overlap');
  const m = meetings[0];
  const first = events.find((e) => e.type === 'delegate' && e.from === m.host && e.at >= m.at);
  assert.ok(first.at >= m.at + m.durationMs, 'work is handed out after the meeting');
});
