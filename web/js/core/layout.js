// Procedural office layout. Departments become carpeted zones with one desk per
// agent; a shared band at the bottom holds the lounge, pantry and meeting room.
// Everything is described in tile coordinates (1 tile = 16 logical pixels) and
// the module is pure, so it runs in Node tests as well as in the browser.

import { reachable } from './pathfinding.js';

export const TILE = 16;
export const WALL_TOP = 3; // rows of wall face at the top
const LOUNGE_ROWS = 8;
const MIN_INTERIOR_W = 24;
const TARGET_ASPECT = 1.9;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Desk grid for a department with n agents. */
export function zoneGrid(n) {
  const cols = clamp(Math.round(Math.sqrt(n * 1.5)), 1, 5);
  const rows = Math.ceil(n / cols);
  return { cols, rows, w: cols * 3 + 1, h: 2 + rows * 3 };
}

function packZones(zones, width) {
  const rows = [];
  let cur = { items: [], w: 0, h: 0 };
  for (const z of zones) {
    const add = cur.items.length ? z.w + 1 : z.w;
    if (cur.items.length && cur.w + add > width) {
      rows.push(cur);
      cur = { items: [], w: 0, h: 0 };
    }
    cur.w += cur.items.length ? z.w + 1 : z.w;
    cur.h = Math.max(cur.h, z.h);
    cur.items.push(z);
  }
  if (cur.items.length) rows.push(cur);
  const height = rows.reduce((s, r) => s + r.h, 0) + Math.max(0, rows.length - 1);
  return { rows, height };
}

function chooseWidth(zones) {
  if (!zones.length) return MIN_INTERIOR_W;
  const maxZoneW = Math.max(...zones.map((z) => z.w));
  const minW = Math.max(MIN_INTERIOR_W, maxZoneW);
  const sumW = zones.reduce((s, z) => s + z.w, 0) + zones.length - 1;
  const maxW = Math.max(minW, sumW);
  let best = null;
  for (let w = minW; w <= maxW; w++) {
    const { height } = packZones(zones, w);
    const officeW = w + 2;
    const officeH = WALL_TOP + height + 2 + LOUNGE_ROWS + 1;
    const score = Math.abs(Math.log(officeW / officeH / TARGET_ASPECT));
    if (!best || score < best.score - 1e-9) best = { w, score };
  }
  return best.w;
}

// Lounge components: [id, width]. Placed in priority order while they fit.
const LOUNGE_COMPONENTS = [
  { id: 'lounge', w: 14 },
  { id: 'pantry', w: 10 },
  { id: 'meeting', w: 14 },
];

export function buildLayout(roster) {
  const byDept = new Map(roster.departments.map((d) => [d.id, []]));
  for (const a of roster.agents) {
    if (!byDept.has(a.department)) byDept.set(a.department, []);
    byDept.get(a.department).push(a);
  }

  const zones = roster.departments
    .filter((d) => byDept.get(d.id).length)
    .map((d) => {
      const agents = byDept.get(d.id);
      return { id: d.id, name: d.name, color: d.color, agents, ...zoneGrid(agents.length) };
    })
    .sort((a, b) => b.agents.length - a.agents.length);

  const innerW = chooseWidth(zones);
  const packed = packZones(zones, innerW);
  const usedW = Math.max(MIN_INTERIOR_W, ...packed.rows.map((r) => r.w));
  const W = Math.max(innerW, usedW);

  const ox = 1;
  const oy = WALL_TOP;
  const loungeY = oy + packed.height + 1;
  const width = W + 2;
  const height = loungeY + LOUNGE_ROWS + 1;

  const blocked = new Uint8Array(width * height);
  const block = (x, y, w = 1, h = 1) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < width && j < height) blocked[j * width + i] = 1;
  };
  // walls
  block(0, 0, width, WALL_TOP);
  block(0, height - 1, width, 1);
  block(0, 0, 1, height);
  block(width - 1, 0, 1, height);

  const furniture = [];
  const decor = [];
  const spots = [];
  const desks = {};
  const placedZones = [];
  let spotSeq = 0;

  const addFurniture = (type, x, y, w, h, extra = {}) => {
    furniture.push({ type, x, y, w, h, ...extra });
    block(x, y, w, h);
  };
  const addSpot = (kind, x, y, face, extra = {}) => {
    spots.push({ id: `${kind}-${spotSeq++}`, kind, x, y, face, ...extra });
  };

  // zones + desks --------------------------------------------------------
  let cursorY = oy;
  for (const row of packed.rows) {
    let cursorX = ox + Math.floor((W - row.w) / 2);
    for (const z of row.items) {
      const placed = { id: z.id, name: z.name, color: z.color, x: cursorX, y: cursorY, w: z.w, h: z.h, cols: z.cols, rows: z.rows };
      placedZones.push(placed);
      z.agents.forEach((agent, i) => {
        const col = i % z.cols;
        const r = Math.floor(i / z.cols);
        const cx = cursorX + 1 + col * 3;
        const cy = cursorY + 2 + r * 3;
        addFurniture('desk', cx, cy, 2, 2, { agent: agent.id, variant: i });
        desks[agent.id] = { agent: agent.id, zone: z.id, seat: { x: cx, y: cy }, face: 'down' };
      });
      cursorX += z.w + 1;
    }
    cursorY += row.h + 1;
  }

  // lounge band -----------------------------------------------------------
  let chosen = [];
  let used = 0;
  for (const c of LOUNGE_COMPONENTS) {
    if (used + c.w + (chosen.length ? 1 : 0) <= W) {
      used += c.w + (chosen.length ? 1 : 0);
      chosen.push(c);
    }
  }
  if (!chosen.length) chosen = [LOUNGE_COMPONENTS[0]];
  // keep the visual order pantry | lounge | meeting
  const order = { pantry: 0, lounge: 1, meeting: 2 };
  chosen.sort((a, b) => order[a.id] - order[b.id]);
  const totalW = chosen.reduce((s, c) => s + c.w, 0);
  const spare = Math.max(0, W - totalW);
  const gap = chosen.length > 1 ? Math.floor(spare / (chosen.length + 1)) : Math.floor(spare / 2);
  let bx = ox + (chosen.length > 1 ? gap : Math.floor(spare / 2));
  const by = loungeY;
  const bands = [];

  for (const c of chosen) {
    bands.push({ id: c.id, x: bx, y: by, w: c.w });
    if (c.id === 'lounge') buildLounge(bx, by);
    else if (c.id === 'pantry') buildPantry(bx, by);
    else buildMeeting(bx, by);
    bx += c.w + gap;
  }

  function buildLounge(x, y) {
    decor.push({ type: 'rug', x: x + 1, y: y + 3, w: 12, h: 4, color: 'lounge' });
    addFurniture('bookshelf', x + 1, y, 2, 2);
    addFurniture('tv', x + 5, y, 4, 2);
    addFurniture('plant', x + 4, y, 1, 2, { variant: 0 });
    addFurniture('plant', x + 13, y, 1, 2, { variant: 1 });
    addFurniture('plant', x, y + 6, 1, 2, { variant: 2 });
    // sofa: backrest on row y+3, seats on row y+4
    addFurniture('sofa', x + 5, y + 3, 3, 2);
    for (let i = 0; i < 3; i++) addSpot('sofa', x + 5 + i, y + 4, 'down', { sink: 5, group: 'lounge' });
    addFurniture('armchair', x + 2, y + 3, 1, 2);
    addSpot('armchair', x + 2, y + 4, 'down', { sink: 5, group: 'lounge' });
    addFurniture('armchair', x + 10, y + 3, 1, 2);
    addSpot('armchair', x + 10, y + 4, 'down', { sink: 5, group: 'lounge' });
    addFurniture('low_table', x + 5, y + 6, 3, 1);
  }

  function buildPantry(x, y) {
    addFurniture('coffee', x + 1, y, 1, 2);
    addSpot('coffee', x + 1, y + 2, 'up', { standing: true, group: 'pantry' });
    addFurniture('fridge', x + 3, y, 1, 2);
    addFurniture('vending', x + 5, y, 2, 2);
    addSpot('vending', x + 5, y + 2, 'up', { standing: true, group: 'pantry' });
    addSpot('vending', x + 6, y + 2, 'up', { standing: true, group: 'pantry' });
    addFurniture('cooler', x + 8, y, 1, 2);
    addSpot('cooler', x + 8, y + 2, 'up', { standing: true, group: 'pantry' });
    addFurniture('cafe_table', x + 4, y + 4, 2, 1);
    addFurniture('stool', x + 3, y + 4, 1, 1);
    addSpot('stool', x + 3, y + 4, 'right', { sink: 3, group: 'pantry' });
    addFurniture('stool', x + 6, y + 4, 1, 1);
    addSpot('stool', x + 6, y + 4, 'left', { sink: 3, group: 'pantry' });
    addFurniture('plant', x + 9, y + 5, 1, 2, { variant: 3 });
    addFurniture('bin', x, y + 5, 1, 1);
  }

  function buildMeeting(x, y) {
    addFurniture('whiteboard', x + 3, y, 4, 2);
    addSpot('board', x + 4, y + 2, 'up', { standing: true, group: 'meeting' });
    addSpot('board', x + 5, y + 2, 'up', { standing: true, group: 'meeting' });
    addFurniture('plant', x, y, 1, 2, { variant: 4 });
    addFurniture('plant', x + 13, y, 1, 2, { variant: 5 });
    // long table with chairs on both sides
    addFurniture('meeting_table', x + 3, y + 4, 6, 2);
    for (let i = 0; i < 6; i++) {
      addFurniture('chair', x + 3 + i, y + 3, 1, 1, { face: 'down' });
      addSpot('chair', x + 3 + i, y + 3, 'down', { sink: 6, group: 'meeting' });
    }
    for (const i of [1, 4]) {
      addFurniture('chair', x + 3 + i, y + 6, 1, 1, { face: 'up' });
      addSpot('chair', x + 3 + i, y + 6, 'up', { sink: 4, group: 'meeting' });
    }
  }

  // top-wall decoration ----------------------------------------------------
  const wall = [];
  for (let x = 2; x + 3 <= width - 2; x += 6) wall.push({ type: 'window', x, y: 0, w: 3, h: 2 });
  const clockX = Math.floor(width / 2);
  decor.push({ type: 'clock', x: clockX, y: 0, w: 1, h: 1 });

  const isWalkable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && !blocked[y * width + x];

  return {
    w: width,
    h: height,
    pxW: width * TILE,
    pxH: height * TILE,
    zones: placedZones,
    bands,
    desks,
    furniture,
    decor,
    wall,
    spots,
    blocked,
    isWalkable,
    grid: { w: width, h: height, isWalkable },
  };
}

/** Tile a character can start from: the free tile next to a seat. */
export function approachTiles(layout, seat) {
  const out = [];
  for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
    const x = seat.x + dx;
    const y = seat.y + dy;
    if (layout.isWalkable(x, y)) out.push({ x, y });
  }
  return out;
}

/** Sanity check used by tests: every seat/spot must be reachable from the lounge. */
export function unreachableSeats(layout) {
  const start = layout.bands.length
    ? { x: layout.bands[0].x + 1, y: layout.bands[0].y + 7 }
    : { x: 1, y: layout.h - 2 };
  const seen = reachable(layout.grid, start);
  const bad = [];
  const check = (id, t) => {
    const ok = approachTiles(layout, t).some((p) => seen.has(p.y * layout.w + p.x)) || seen.has(t.y * layout.w + t.x);
    if (!ok) bad.push(id);
  };
  for (const d of Object.values(layout.desks)) check(d.agent, d.seat);
  for (const s of layout.spots) check(s.id, s);
  return bad;
}
