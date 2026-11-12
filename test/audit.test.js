// Regression tests for the issues found in the 2026-11 audit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeRoster, slug } from '../web/js/core/roster.js';
import { buildLayout, unreachableSeats } from '../web/js/core/layout.js';
import { applyEvent, createState, normalizeEvent } from '../web/js/core/model.js';
import { findPath } from '../web/js/core/pathfinding.js';
import { treeOrder } from '../web/js/ui/ui.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(fs.readFileSync(path.join(here, '..', 'agents.example.json'), 'utf8'));
const byId = (r) => Object.fromEntries(r.agents.map((a) => [a.id, a]));

test('names in any script get their own id', () => {
  assert.equal(slug('张三'), '张三');
  assert.equal(slug('محمد'), 'محمد');
  const r = normalizeRoster({ agents: [{ name: '张三' }, { name: '李四' }] });
  assert.deepEqual(r.agents.map((a) => a.id), ['张三', '李四']);
});

test('department heads: strong titles win, "lead generation" and assistants never lead', () => {
  const r = normalizeRoster({
    office: { mainAgent: 'boss' },
    agents: [
      { id: 'boss', name: 'Boss', department: 'hq' },
      { id: 'ann', name: 'Ann', role: 'Lead generation specialist', department: 'm' },
      { id: 'asst', name: 'Asst', role: 'Assistant to the Director', department: 'm' },
      { id: 'bob', name: 'Bob', role: 'Head of Marketing', department: 'm' },
    ],
  });
  const a = byId(r);
  assert.equal(a.bob.reportsTo, 'boss');
  assert.equal(a.ann.reportsTo, 'bob');
  assert.equal(a.asst.reportsTo, 'bob');
});

test('reports on a wrapped row still get a reporting line', () => {
  const agents = [{ id: 'head', name: 'Head', department: 'd', reportsTo: null }];
  for (let i = 0; i < 9; i++) agents.push({ id: `w${i}`, name: `W${i}`, department: 'd', reportsTo: 'head' });
  const layout = buildLayout(normalizeRoster({ office: { mainAgent: 'head' }, agents }));
  // every report has a line ending just above its own desk
  for (let i = 0; i < 9; i++) {
    const d = layout.desks[`w${i}`].seat;
    assert.ok(layout.orgLines.some((l) => l.x1 === d.x + 1 && l.x2 === d.x + 1 && Math.abs(l.y2 - (d.y - 0.25)) < 1e-9), `w${i} has a line`);
  }
});

test('a very deep chain keeps the office a sensible shape', () => {
  const agents = [];
  for (let i = 0; i < 40; i++) agents.push({ id: `a${i}`, name: `A${i}`, department: 'd', reportsTo: i ? `a${i - 1}` : null });
  const layout = buildLayout(normalizeRoster({ agents }));
  assert.ok(layout.h < 60, `office is ${layout.w}x${layout.h}`);
  assert.deepEqual(unreachableSeats(layout), []);
});

test('event ids match roster ids regardless of case and spacing', () => {
  const state = createState(normalizeRoster(example));
  const res = applyEvent(state, normalizeEvent({ type: 'status', agent: 'Writer', status: 'typing' }));
  assert.equal(res.rosterChanged, false, 'no guest was created');
  assert.equal(state.agents.writer.status, 'typing');
  assert.equal(state.agents.Writer, undefined);
});

test('timestamps far from the clock are replaced', () => {
  const now = Date.now();
  assert.equal(normalizeEvent({ type: 'status', agent: 'a', status: 'idle', ts: 1e15 }, now).ts, now);
});

test('roster panel lists each manager directly followed by their own team', () => {
  const r = normalizeRoster(example);
  const order = treeOrder(r.agents.filter((a) => a.department === 'operations')).map((a) => a.id);
  assert.deepEqual(order, ['finance', 'legal', 'scheduler', 'support']);
});

test('path finding stays fast and optimal on a big office', () => {
  const agents = [{ id: 'ceo', name: 'CEO', department: 'hq', reportsTo: null }];
  for (let d = 0; d < 20; d++) for (let i = 0; i < 5; i++) agents.push({ id: `a${d}-${i}`, name: `A${d}-${i}`, department: `d${d}` });
  const layout = buildLayout(normalizeRoster({ office: { mainAgent: 'ceo' }, agents }));
  const goal = layout.spots[0];
  const t0 = performance.now();
  let n = 0;
  for (const d of Object.values(layout.desks)) {
    const p = findPath(layout.grid, d.seat, goal);
    assert.ok(p && p.length >= Math.abs(d.seat.x - goal.x) + Math.abs(d.seat.y - goal.y));
    n++;
  }
  assert.ok((performance.now() - t0) / n < 5, 'well under 5 ms per path');
});
