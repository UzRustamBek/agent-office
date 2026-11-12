import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE,
  STATUS,
  applyEvent,
  createState,
  ensureAgent,
  normalizeEvent,
  restore,
  snapshot,
  summarize,
  tick,
} from '../web/js/core/model.js';
import { RosterError, defaultLook, normalizeRoster, prettify, slug } from '../web/js/core/roster.js';
import { findPath, reachable } from '../web/js/core/pathfinding.js';
import { buildLayout, unreachableSeats, zoneGrid } from '../web/js/core/layout.js';
import { hash32, mulberry32 } from '../web/js/core/rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(fs.readFileSync(path.join(here, '..', 'agents.example.json'), 'utf8'));

const mini = () =>
  normalizeRoster({
    office: { mainAgent: 'lead' },
    departments: [{ id: 'a', name: 'Alpha' }],
    agents: [
      { id: 'lead', name: 'Lead', department: 'a' },
      { id: 'dev', name: 'Dev', department: 'a' },
    ],
  });

// --- rng -------------------------------------------------------------------
test('rng: hash and seeded generator are deterministic', () => {
  assert.equal(hash32('abc'), hash32('abc'));
  assert.notEqual(hash32('abc'), hash32('abd'));
  const a = mulberry32(5);
  const b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.ok(v >= 0 && v < 1);
  }
});

// --- roster ----------------------------------------------------------------
test('roster: bundled example is valid and complete', () => {
  const r = normalizeRoster(example);
  assert.equal(r.agents.length, 22);
  assert.equal(r.departments.length, 5);
  assert.equal(r.office.mainAgent, 'director');
  for (const a of r.agents) {
    assert.ok(a.look && a.look.hair, `${a.id} has a look`);
    assert.ok(r.departments.some((d) => d.id === a.department));
  }
});

test('roster: accepts a bare array and fills defaults', () => {
  const r = normalizeRoster([{ name: 'Oʻrganuvchi Bot' }, { name: 'Second' }]);
  assert.equal(r.agents.length, 2);
  assert.equal(r.agents[0].id, 'organuvchi-bot');
  assert.equal(r.departments[0].id, 'general');
  assert.equal(r.office.mainAgent, 'organuvchi-bot');
});

test('roster: reports every problem at once', () => {
  assert.throws(
    () => normalizeRoster({ agents: [{ id: 'x', name: 'X' }, { id: 'x', name: 'Y' }, { role: 'no name' }, { name: 'Z', look: { hair: 'mohawk', skin: 99 } }] }),
    (err) => err instanceof RosterError && err.issues.length >= 3,
  );
  assert.throws(() => normalizeRoster({}), RosterError);
  assert.throws(() => normalizeRoster(null), RosterError);
});

test('roster: slug and prettify', () => {
  assert.equal(slug("Gʻayrat's Agent!"), 'gayrats-agent');
  assert.equal(slug('Привет мир'), 'привет-мир');
  assert.equal(slug('   '), 'agent');
  assert.equal(prettify('marketing-sotuv'), 'Marketing Sotuv');
  assert.equal(prettify('it'), 'IT');
  assert.equal(prettify('seo-qa lead'), 'SEO QA Lead');
});

test('roster: default look is stable per id', () => {
  assert.deepEqual(defaultLook('same', '#3fb68b'), defaultLook('same', '#3fb68b'));
  assert.notDeepEqual(defaultLook('one'), defaultLook('two'));
});

// --- model -----------------------------------------------------------------
test('model: normalizeEvent validates and sanitizes', () => {
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent({ agent: 'a', status: 'flying' }), null);
  assert.equal(normalizeEvent({ agent: 'bad id!', status: 'idle' }), null);
  assert.equal(normalizeEvent({ type: 'delegate', from: 'a', to: 'a' }), null);
  assert.equal(normalizeEvent({ type: 'nope' }), null);
  const e = normalizeEvent({ agent: 'dev', status: 'typing', activity: '  Editing\nfile\u0000.js  ', tool: 'Edit' }, 123);
  assert.equal(e.activity, 'Editing file .js');
  assert.equal(e.ts, 123);
  assert.equal(normalizeEvent({ type: 'message', agent: 'dev', text: '  ' }), null);
  const long = normalizeEvent({ agent: 'dev', status: 'idle', activity: 'x'.repeat(1000) });
  assert.equal(long.activity.length, 140);
});

test('model: status events update state, counters and time accounting', () => {
  const s = createState(mini(), 1000);
  const r = applyEvent(s, normalizeEvent({ agent: 'dev', status: STATUS.TYPING, activity: 'Editing a.js', tool: 'Edit' }, 2000), 2000);
  assert.deepEqual(r.changed, ['dev']);
  assert.equal(s.agents.dev.status, 'typing');
  assert.equal(s.agents.dev.counters.tools, 1);
  assert.equal(s.agents.dev.time.idle, 1000);
  applyEvent(s, normalizeEvent({ agent: 'dev', status: STATUS.DONE, activity: 'Finished' }, 5000), 5000);
  assert.equal(s.agents.dev.counters.done, 1);
  assert.equal(s.agents.dev.time.typing, 3000);
  assert.equal(s.log.length, 2);
  // an identical repeat does not spam the log
  applyEvent(s, normalizeEvent({ agent: 'dev', status: STATUS.DONE, activity: 'Finished' }, 5100), 5100);
  assert.equal(s.log.length, 2);
});

test('model: delegation updates counters and reports the pair', () => {
  const s = createState(mini());
  const r = applyEvent(s, normalizeEvent({ type: 'delegate', from: 'lead', to: 'dev', task: 'Build it' }));
  assert.deepEqual(r.delegation, { from: 'lead', to: 'dev' });
  assert.equal(s.agents.lead.counters.delegated, 1);
  assert.equal(s.agents.dev.counters.received, 1);
});

test('model: unknown agents become guests instead of being lost', () => {
  const s = createState(mini());
  const r = applyEvent(s, normalizeEvent({ agent: 'stranger', status: 'reading', activity: 'Reading x' }));
  assert.equal(r.rosterChanged, true);
  assert.ok(s.agents.stranger);
  assert.equal(s.roster.agents.find((a) => a.id === 'stranger').department, 'guests');
  assert.equal(ensureAgent(s, 'stranger'), false);
});

test('model: tick fades done/error and resets stale active agents', () => {
  const s = createState(mini(), 0);
  applyEvent(s, normalizeEvent({ agent: 'lead', status: 'done' }, 0), 0);
  applyEvent(s, normalizeEvent({ agent: 'dev', status: 'typing' }, 0), 0);
  assert.deepEqual(tick(s, 1000), []);
  assert.deepEqual(tick(s, 4001), ['lead']);
  assert.equal(s.agents.lead.status, 'idle');
  assert.deepEqual(tick(s, 121000), ['dev']);
  // blocked states never time out on their own
  applyEvent(s, normalizeEvent({ agent: 'dev', status: 'permission' }, 130000), 130000);
  assert.deepEqual(tick(s, 900000), []);
});

test('model: summarize, snapshot and restore round-trip', () => {
  const s = createState(mini());
  applyEvent(s, normalizeEvent({ agent: 'dev', status: 'running' }));
  applyEvent(s, normalizeEvent({ agent: 'lead', status: 'waiting' }));
  const sum = summarize(s);
  assert.equal(sum.active, 1);
  assert.equal(sum.blocked, 1);
  const copy = restore(JSON.parse(JSON.stringify(snapshot(s))));
  assert.equal(copy.agents.dev.status, 'running');
  assert.ok(ACTIVE.has(copy.agents.dev.status));
});

// --- pathfinding -----------------------------------------------------------
function gridFrom(rows) {
  const h = rows.length;
  const w = rows[0].length;
  return { w, h, isWalkable: (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] === '.' };
}

test('pathfinding: straight line, detour, unreachable, same tile', () => {
  const g = gridFrom(['.....', '.###.', '.....']);
  const p = findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 });
  assert.ok(p && p.length > 4);
  assert.deepEqual(p.at(-1), { x: 4, y: 1 });
  assert.deepEqual(findPath(g, { x: 0, y: 0 }, { x: 0, y: 0 }), []);
  const blocked = gridFrom(['..#..', '..#..']);
  assert.equal(findPath(blocked, { x: 0, y: 0 }, { x: 4, y: 0 }), null);
});

test('pathfinding: the goal may be a blocked seat; fewer turns preferred', () => {
  const g = gridFrom(['....', '....', '....']);
  const p = findPath(g, { x: 0, y: 0 }, { x: 3, y: 2 });
  const turns = p.reduce((n, s, i) => {
    const prev = i === 0 ? { x: 0, y: 0 } : p[i - 1];
    const before = i < 2 ? null : p[i - 2];
    const d1 = before ? { x: prev.x - before.x, y: prev.y - before.y } : null;
    const d2 = { x: s.x - prev.x, y: s.y - prev.y };
    return d1 && (d1.x !== d2.x || d1.y !== d2.y) ? n + 1 : n;
  }, 0);
  assert.ok(turns <= 2, `expected a path with few turns, got ${turns}`);
  const seatGrid = { w: 3, h: 1, isWalkable: (x) => x !== 2 };
  assert.deepEqual(findPath(seatGrid, { x: 0, y: 0 }, { x: 2, y: 0 }).at(-1), { x: 2, y: 0 });
  assert.ok(reachable(g, { x: 0, y: 0 }).size === 12);
});

// --- layout ----------------------------------------------------------------
test('layout: zoneGrid scales sensibly', () => {
  assert.deepEqual(zoneGrid(1), { cols: 1, rows: 1, w: 4, h: 5 });
  assert.equal(zoneGrid(10).cols, 4);
  assert.equal(zoneGrid(100).cols, 5);
});

function checkLayout(roster) {
  const l = buildLayout(roster);
  // every agent has exactly one desk
  assert.equal(Object.keys(l.desks).length, roster.agents.length);
  // no two furniture footprints overlap
  const owner = new Map();
  for (const f of l.furniture) {
    for (let y = f.y; y < f.y + f.h; y++) {
      for (let x = f.x; x < f.x + f.w; x++) {
        const key = `${x},${y}`;
        // stools and chairs sit on their own spot tile only once
        assert.ok(!owner.has(key), `overlap at ${key}: ${f.type} vs ${owner.get(key)}`);
        owner.set(key, f.type);
        assert.ok(x > 0 && y >= 3 && x < l.w - 1 && y < l.h - 1, `${f.type} outside interior at ${key}`);
      }
    }
  }
  assert.deepEqual(unreachableSeats(l), []);
  return l;
}

test('layout: example roster (22 agents, 5 departments)', () => {
  const l = checkLayout(normalizeRoster(example));
  assert.ok(l.w >= 26 && l.h >= 20);
  assert.ok(l.spots.length >= 10, 'lounge has places to relax');
  const aspect = l.w / l.h;
  assert.ok(aspect > 1.3 && aspect < 2.6, `aspect ${aspect}`);
});

test('layout: tiny and huge rosters stay valid', () => {
  checkLayout(mini());
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, department: `d${i % 7}` }));
  const l = checkLayout(normalizeRoster({ agents: many }));
  assert.ok(l.w < 120, `width ${l.w}`);
  const one = checkLayout(normalizeRoster({ agents: [{ name: 'Solo' }] }));
  assert.equal(Object.keys(one.desks).length, 1);
});

test('layout: is deterministic', () => {
  const r = normalizeRoster(example);
  const a = buildLayout(r);
  const b = buildLayout(r);
  assert.deepEqual(a.furniture, b.furniture);
  assert.deepEqual(a.desks, b.desks);
});
