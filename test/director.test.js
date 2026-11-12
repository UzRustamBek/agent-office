import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DWELL_MS, MIN_BUSY_MS, pickShot } from '../web/js/office/director.js';
import { rank } from '../web/js/ui/palette.js';

const A = (id, status, since, x = 0, y = 0) => ({ id, status, since, x, y });
const T = 1_000_000;

test('director: a meeting is always the shot', () => {
  const room = { x: 10, y: 20, w: 14, h: 6 };
  const s = pickShot({ agents: [A('a', 'typing', T - 5000)], meeting: { room }, prev: null, now: T });
  assert.equal(s.kind, 'meeting');
  assert.equal(s.x, (10 + 7) * 16);
});

test('director: everybody idle shows the whole office', () => {
  assert.equal(pickShot({ agents: [A('a', 'idle', 0), A('b', 'done', 0)], meeting: null, prev: null, now: T }).kind, 'overview');
});

test('director: a flicker shorter than MIN_BUSY_MS does not steal the camera', () => {
  const s = pickShot({ agents: [A('a', 'typing', T - (MIN_BUSY_MS - 100))], meeting: null, prev: null, now: T });
  assert.equal(s.kind, 'overview');
});

test('director: blocked agents (need you) count as busy', () => {
  const s = pickShot({ agents: [A('a', 'permission', T - 5000)], meeting: null, prev: null, now: T });
  assert.deepEqual([s.kind, s.id], ['agent', 'a']);
});

test('director: stays on one agent until the dwell time ends, then rotates to the one shown longest ago', () => {
  const agents = [A('a', 'typing', T - 9000), A('b', 'reading', T - 8000)];
  const shown = { a: T - 1000, b: 0 };
  const stay = pickShot({ agents, meeting: null, prev: { kind: 'agent', id: 'a', at: T - 1000 }, shown, now: T });
  assert.equal(stay.id, 'a');
  const later = T + DWELL_MS;
  const next = pickShot({ agents, meeting: null, prev: { kind: 'agent', id: 'a', at: T - 1000 }, shown, now: later });
  assert.equal(next.id, 'b');
  assert.equal(next.at, later);
});

test('director: a single busy agent keeps the camera however long it works', () => {
  const s = pickShot({ agents: [A('a', 'typing', 0)], meeting: null, prev: { kind: 'agent', id: 'a', at: 0 }, shown: { a: 0 }, now: T * 10 });
  assert.equal(s.id, 'a');
  assert.equal(s.at, 0);
});

test('director: when the filmed agent stops, the camera moves on', () => {
  const s = pickShot({ agents: [A('a', 'idle', 0), A('b', 'typing', T - 4000)], meeting: null, prev: { kind: 'agent', id: 'a', at: T - 500 }, shown: {}, now: T });
  assert.equal(s.id, 'b');
});

test('palette: every word must match, word starts rank first', () => {
  const items = ['Marketolog marketing sotuv', 'Blog Muharrir marketing', 'Buxgalter moliya'].map((h, i) => ({ id: i, haystack: h.toLowerCase() }));
  assert.deepEqual(rank(items, 'mark').map((x) => x.id), [0, 1]);
  assert.deepEqual(rank(items, 'blog mark').map((x) => x.id), [1]);
  assert.deepEqual(rank(items, 'zzz'), []);
  assert.equal(rank(items, '  ').length, 3);
});
