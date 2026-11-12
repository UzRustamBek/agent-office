import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RosterError, normalizeRoster } from '../web/js/core/roster.js';
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
  assert.throws(
    () => normalizeRoster({ agents: [{ id: 'a', name: 'A', reportsTo: 'nobody-here' }] }),
    (e) => e instanceof RosterError && /not an agent/.test(e.message),
  );
  assert.throws(
    () => normalizeRoster({ agents: [{ id: 'a', name: 'A', reportsTo: 'a' }] }),
    (e) => e instanceof RosterError && /itself/.test(e.message),
  );
  assert.throws(
    () =>
      normalizeRoster({
        agents: [
          { id: 'a', name: 'A', reportsTo: 'b' },
          { id: 'b', name: 'B', reportsTo: 'a' },
        ],
      }),
    (e) => e instanceof RosterError && /cycle/.test(e.message),
  );
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
