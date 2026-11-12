// Drawing of the office itself: static floor/walls and animated furniture.
// All art is generated from rectangles in a 16px tile grid.

import { TILE, WALL_TOP } from '../core/layout.js';
import { hash32 } from '../core/rng.js';
import { mix, shade, STATUS_COLOR } from './palette.js';

const T = TILE;
const rect = (ctx, x, y, w, h, c) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

const FLOOR_A = '#d9d4c6';
const FLOOR_B = '#d2ccbd';
const WOOD = '#c8a173';
const WOOD_L = '#dcb98a';
const WOOD_D = '#9a7650';

// ---------------------------------------------------------------------------
// Static layer: floor, carpets, walls, windows
// ---------------------------------------------------------------------------

export function drawStatic(ctx, layout, { night = false } = {}) {
  const { w, h, pxW, pxH } = layout;
  rect(ctx, 0, 0, pxW, pxH, night ? '#10132a' : '#262c48');

  // floor
  for (let y = WALL_TOP; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const px = x * T;
      const py = y * T;
      rect(ctx, px, py, T, T, (x + y) % 2 ? FLOOR_A : FLOOR_B);
      rect(ctx, px, py, T, 1, 'rgba(255,255,255,0.35)');
      rect(ctx, px, py, 1, T, 'rgba(255,255,255,0.25)');
    }
  }

  // department carpets
  for (const z of layout.zones) {
    const base = mix('#e8e3d4', z.color, 0.3);
    const px = z.x * T;
    const py = z.y * T;
    const zw = z.w * T;
    const zh = z.h * T;
    rect(ctx, px, py, zw, zh, mix(z.color, '#2a2f4a', 0.45));
    rect(ctx, px + 1, py + 1, zw - 2, zh - 2, base);
    for (let ty = 0; ty < z.h; ty++) {
      for (let tx = 0; tx < z.w; tx++) {
        if ((tx + ty) % 2 === 0) rect(ctx, px + tx * T + 1, py + ty * T + 1, T, T, 'rgba(255,255,255,0.10)');
        if ((tx * 7 + ty * 13) % 5 === 0) rect(ctx, px + tx * T + 5, py + ty * T + 7, 2, 1, 'rgba(0,0,0,0.05)');
      }
    }
    // header band (the department name is drawn on top by the renderer)
    rect(ctx, px + 3, py + 3, zw - 6, 12, mix(z.color, '#1f2440', 0.62));
    rect(ctx, px + 3, py + 3, zw - 6, 1, mix(z.color, '#ffffff', 0.35));
    rect(ctx, px + 3, py + 14, zw - 6, 1, 'rgba(0,0,0,0.25)');
  }

  // reporting lines (org chart painted on the floor)
  drawOrgLines(ctx, layout);

  // rugs and other floor decor
  for (const d of layout.decor) if (d.type === 'rug') drawRug(ctx, d);

  // soft shadow under the top wall
  rect(ctx, T, WALL_TOP * T, (w - 2) * T, 3, 'rgba(20,20,40,0.22)');
  rect(ctx, T, WALL_TOP * T + 3, (w - 2) * T, 2, 'rgba(20,20,40,0.10)');

  drawWalls(ctx, layout, night);
}

function drawOrgLines(ctx, layout) {
  for (const l of layout.orgLines || []) {
    const x1 = Math.round(Math.min(l.x1, l.x2) * T);
    const y1 = Math.round(Math.min(l.y1, l.y2) * T);
    const x2 = Math.round(Math.max(l.x1, l.x2) * T);
    const y2 = Math.round(Math.max(l.y1, l.y2) * T);
    const accent = l.color ? mix(l.color, '#1f2440', 0.35) : '#59628a';
    const col = l.kind === 'trunk' ? '#59628a' : accent;
    const thick = l.kind === 'tree' ? 1 : 2;
    const half = Math.floor(thick / 2);
    if (x1 === x2) rect(ctx, x1 - half, y1, thick, y2 - y1, col);
    else rect(ctx, x1, y1 - half, x2 - x1, thick, col);
  }
  // junction dots where a line meets a department or a desk
  for (const l of layout.orgLines || []) {
    if (l.kind === 'branch') {
      const x = Math.round(l.x2 * T);
      const y = Math.round(l.y2 * T);
      rect(ctx, x - 2, y - 3, 5, 3, l.color ? mix(l.color, '#ffffff', 0.15) : '#8b93b8');
    }
  }
}

function drawRug(ctx, d) {
  const px = d.x * T;
  const py = d.y * T;
  const pw = d.w * T;
  const ph = d.h * T;
  rect(ctx, px, py, pw, ph, '#4b3d7a');
  rect(ctx, px + 2, py + 2, pw - 4, ph - 4, '#6a58a8');
  rect(ctx, px + 5, py + 5, pw - 10, ph - 10, '#5a4a92');
  for (let x = px + 8; x < px + pw - 8; x += 8) rect(ctx, x, py + 6, 3, 1, '#9a88d8');
  for (let x = px + 8; x < px + pw - 8; x += 8) rect(ctx, x, py + ph - 7, 3, 1, '#9a88d8');
}

function drawWalls(ctx, layout, night) {
  const { w, h, pxW, pxH } = layout;
  const wallTop = night ? '#2a3050' : '#434b6d';
  const wallMid = night ? '#232943' : '#394061';
  const wallLow = night ? '#1d2238' : '#2f3552';
  // top wall face (3 tiles)
  rect(ctx, 0, 0, pxW, WALL_TOP * T, wallMid);
  rect(ctx, 0, 0, pxW, 5, wallTop);
  rect(ctx, 0, 2 * T, pxW, T, wallLow);
  rect(ctx, 0, 2 * T, pxW, 1, mix(wallLow, '#ffffff', 0.18));
  rect(ctx, 0, WALL_TOP * T - 3, pxW, 3, night ? '#14172b' : '#222742');
  // wallpaper pinstripes
  for (let x = 4; x < pxW; x += 8) rect(ctx, x, 6, 1, T * 2 - 6, 'rgba(255,255,255,0.045)');

  // side and bottom walls (thin)
  rect(ctx, 0, 0, T, pxH, wallMid);
  rect(ctx, pxW - T, 0, T, pxH, wallMid);
  rect(ctx, 0, pxH - T, pxW, T, wallMid);
  rect(ctx, T - 2, WALL_TOP * T, 2, pxH - WALL_TOP * T - T, 'rgba(10,12,30,0.35)');
  rect(ctx, pxW - T, WALL_TOP * T, 2, pxH - WALL_TOP * T - T, 'rgba(10,12,30,0.35)');
  rect(ctx, T, pxH - T, pxW - 2 * T, 2, 'rgba(10,12,30,0.35)');
  rect(ctx, 0, pxH - 3, pxW, 3, '#171a30');
  rect(ctx, 0, pxH - T, pxW, 1, wallTop);

  for (const win of layout.wall) drawWindow(ctx, win, night);
}

function drawWindow(ctx, win, night) {
  const px = win.x * T;
  const py = 7;
  const pw = win.w * T;
  const ph = 28;
  rect(ctx, px - 1, py - 1, pw + 2, ph + 2, '#161a30');
  rect(ctx, px, py, pw, ph, '#e6e2d6');
  const gx = px + 2;
  const gy = py + 2;
  const gw = pw - 4;
  const gh = ph - 4;
  const bands = night ? ['#0f1538', '#161d4a', '#1d2658', '#262f68'] : ['#7cc3ff', '#97d0ff', '#b4defe', '#cdeaff'];
  bands.forEach((c, i) => rect(ctx, gx, gy + Math.floor((gh / 4) * i), gw, Math.ceil(gh / 4), c));
  const seed = hash32(`win${win.x}`);
  if (night) {
    for (let i = 0; i < 7; i++) rect(ctx, gx + ((seed >>> (i * 3)) % (gw - 2)) + 1, gy + ((seed >>> (i * 2 + 1)) % 12), 1, 1, '#dfe6ff');
    rect(ctx, gx + gw - 10, gy + 3, 6, 6, '#f4efc9');
    rect(ctx, gx + gw - 8, gy + 3, 5, 5, '#10163a');
  } else {
    rect(ctx, gx + 4 + (seed % 12), gy + 3, 10, 3, '#ffffff');
    rect(ctx, gx + 7 + (seed % 12), gy + 2, 6, 2, '#ffffff');
    rect(ctx, gx + gw - 9, gy + 3, 5, 5, '#ffe58a');
    // distant skyline
    rect(ctx, gx, gy + gh - 4, gw, 4, '#8ab4d8');
    for (let i = 0; i < gw; i += 5) rect(ctx, gx + i, gy + gh - 4 - ((seed >>> (i % 24)) % 4), 3, 6, '#7aa3c8');
  }
  rect(ctx, px + pw / 2 - 1, py, 2, ph, '#e6e2d6');
  rect(ctx, px, py + ph / 2 - 1, pw, 2, '#e6e2d6');
  rect(ctx, px - 2, py + ph, pw + 4, 3, '#cfc9b8');
  rect(ctx, px - 2, py + ph + 2, pw + 4, 1, '#9a947f');
}

// ---------------------------------------------------------------------------
// Dynamic wall decor
// ---------------------------------------------------------------------------

export function drawClock(ctx, layout, now = new Date()) {
  const d = layout.decor.find((x) => x.type === 'clock');
  if (!d) return;
  const cx = d.x * T + 8;
  const cy = 18;
  rect(ctx, cx - 7, cy - 7, 14, 14, '#161a30');
  rect(ctx, cx - 6, cy - 6, 12, 12, '#f1eee3');
  rect(ctx, cx - 6, cy - 6, 12, 1, '#fff');
  const m = now.getMinutes();
  const hr = (now.getHours() % 12) + m / 60;
  const hand = (len, a, c) => {
    for (let i = 1; i <= len; i++) rect(ctx, Math.round(cx - 0.5 + Math.sin(a) * i), Math.round(cy - 0.5 - Math.cos(a) * i), 1, 1, c);
  };
  hand(3, (hr / 12) * Math.PI * 2, '#222');
  hand(5, (m / 60) * Math.PI * 2, '#222');
  rect(ctx, cx - 1, cy - 1, 2, 2, '#c0392b');
  for (const [dx, dy] of [[0, -6], [6, 0], [0, 6], [-6, 0]]) rect(ctx, cx + dx - (dx > 0 ? 1 : 0), cy + dy - (dy > 0 ? 1 : 0), 1, 1, '#555');
}

// ---------------------------------------------------------------------------
// Monitor screens
// ---------------------------------------------------------------------------

const GLYPHS = {
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  ok: ['00000', '00001', '00010', '10100', '01000', '00000', '00000'],
  x: ['10001', '01010', '00100', '01010', '10001', '00000', '00000'],
};

function glyph(ctx, g, x, y, c) {
  GLYPHS[g].forEach((row, j) => {
    for (let i = 0; i < 5; i++) if (row[i] === '1') rect(ctx, x + i, y + j, 1, 1, c);
  });
}

/** Animated content for a monitor. (x, y, w, h) is the inner screen rectangle. */
export function drawScreen(ctx, x, y, w, h, status, t, seed = 0) {
  const R = (a, b, c, d, col) => rect(ctx, x + a, y + b, c, d, col);
  switch (status) {
    case 'typing': {
      R(0, 0, w, h, '#12182c');
      const cols = ['#6c8cff', '#a78bfa', '#4cd08b', '#f0883e', '#d8dcea'];
      const step = Math.floor(t * 3);
      for (let k = 0; k < 5; k++) {
        const hsh = hash32(`${seed}:${k + step}`);
        R(1 + (hsh % 2), 1 + k * 2, 2 + (hsh % 7), 1, cols[(hsh >>> 5) % cols.length]);
      }
      break;
    }
    case 'running': {
      R(0, 0, w, h, '#09130f');
      const step = Math.floor(t * 4);
      for (let k = 0; k < 4; k++) {
        const hsh = hash32(`${seed}r${k + step}`);
        R(1, 1 + k * 2, 1, 1, '#3fb68b');
        R(3, 1 + k * 2, 1 + (hsh % 7), 1, k === 3 ? '#9be8c9' : '#2f8f6e');
      }
      if (Math.floor(t * 2) % 2) R(3 + (hash32(`${seed}c`) % 4), 7, 2, 1, '#9be8c9');
      break;
    }
    case 'reading': {
      R(0, 0, w, h, '#efece1');
      for (let k = 0; k < 4; k++) R(1, 1 + k * 2, w - 3 - ((k * 5) % 4), 1, '#9a947f');
      const bar = Math.floor(t * 1.5) % 4;
      R(0, bar * 2, w, 2, 'rgba(108,140,255,0.35)');
      break;
    }
    case 'searching': {
      R(0, 0, w, h, '#0f2a3c');
      R(1, 1, w - 2, 2, '#e8f6ff');
      R(2, 1, 1 + (Math.floor(t * 4) % 5), 2, '#2b7fb8');
      for (let k = 0; k < 2; k++) {
        R(1, 4 + k * 2, 2, 1, '#38bdf8');
        R(4, 4 + k * 2, w - 6 - k * 2, 1, '#5d7d92');
      }
      break;
    }
    case 'thinking': {
      R(0, 0, w, h, '#221b40');
      const n = Math.floor(t * 3) % 4;
      for (let i = 0; i < 3; i++) R(3 + i * 3, 4 + (i === n ? -1 : 0), 2, 2, i === n ? '#d7c8ff' : '#7a63c4');
      break;
    }
    case 'delegating': {
      R(0, 0, w, h, '#2a1b10');
      const pulse = Math.floor(t * 3) % 3;
      R(5, 1, 2, 2, '#f0883e');
      R(2, 6, 2, 2, pulse === 0 ? '#ffd2a6' : '#a85c24');
      R(5, 6, 2, 2, pulse === 1 ? '#ffd2a6' : '#a85c24');
      R(8, 6, 2, 2, pulse === 2 ? '#ffd2a6' : '#a85c24');
      R(3, 3, 1, 3, '#7a4a20');
      R(6, 3, 1, 3, '#7a4a20');
      R(9, 3, 1, 3, '#7a4a20');
      break;
    }
    case 'waiting': {
      R(0, 0, w, h, '#3a2f0f');
      glyph(ctx, '?', x + Math.floor((w - 5) / 2), y + 1, Math.floor(t * 2) % 2 ? '#ffe28a' : '#f5c542');
      break;
    }
    case 'permission': {
      R(0, 0, w, h, Math.floor(t * 3) % 2 ? '#4a1228' : '#3a1020');
      glyph(ctx, '!', x + Math.floor((w - 5) / 2), y + 1, '#ff8db0');
      break;
    }
    case 'done': {
      R(0, 0, w, h, '#0f2a1e');
      glyph(ctx, 'ok', x + Math.floor((w - 5) / 2), y + 1, '#7ff0b4');
      break;
    }
    case 'error': {
      R(0, 0, w, h, '#3a0f12');
      glyph(ctx, 'x', x + Math.floor((w - 5) / 2), y + 1, '#ff7a80');
      break;
    }
    case 'sleeping': {
      R(0, 0, w, h, '#0c0e17');
      R(w - 3, h - 2, 1, 1, '#2a3050');
      break;
    }
    default: {
      // idle: slow screensaver
      R(0, 0, w, h, '#1a2038');
      const px = Math.abs(((t * 4 + seed) % ((w - 3) * 2)) - (w - 3));
      const py = Math.abs(((t * 3 + seed * 0.7) % ((h - 3) * 2)) - (h - 3));
      R(1 + Math.floor(px), 1 + Math.floor(py), 2, 2, '#4a5890');
      R(1, h - 2, w - 2, 1, '#242b4a');
    }
  }
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/**
 * Returns drawing layers for a furniture item: [{ z, draw(ctx) }].
 * Layers are depth-sorted together with characters (z = foot y in px).
 */
export function furnitureLayers(f, env) {
  const px = f.x * T;
  const py = f.y * T;
  switch (f.type) {
    case 'desk':
      return deskLayers(f, px, py, env);
    case 'sofa':
      return [
        { z: (f.y + 2) * T - 0.6, draw: (c) => sofaBack(c, px, py) },
        { z: (f.y + 2) * T + 0.3, draw: (c) => sofaFront(c, px, py) },
      ];
    case 'armchair':
      return [
        { z: (f.y + 2) * T - 0.6, draw: (c) => armchairBack(c, px, py) },
        { z: (f.y + 2) * T + 0.3, draw: (c) => armchairFront(c, px, py) },
      ];
    case 'tv':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawTv(c, px, py, env) }];
    case 'bookshelf':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawBookshelf(c, px, py, f) }];
    case 'plant':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawPlant(c, px, py, f.variant || 0, env.t) }];
    case 'coffee':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawCoffee(c, px, py, env.t) }];
    case 'fridge':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawFridge(c, px, py) }];
    case 'vending':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawVending(c, px, py, env.t) }];
    case 'cooler':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawCooler(c, px, py, env.t) }];
    case 'cafe_table':
      return [{ z: (f.y + 1) * T - 0.1, draw: (c) => drawCafeTable(c, px, py) }];
    case 'stool':
      return [{ z: (f.y + 1) * T - 0.5, draw: (c) => drawStool(c, px, py) }];
    case 'bin':
      return [{ z: (f.y + 1) * T - 0.1, draw: (c) => drawBin(c, px, py) }];
    case 'whiteboard':
      return [{ z: (f.y + 2) * T - 0.1, draw: (c) => drawWhiteboard(c, px, py, env) }];
    case 'meeting_table':
      return [{ z: (f.y + 2) * T - 0.2, draw: (c) => drawMeetingTable(c, px, py) }];
    case 'low_table':
      return [{ z: (f.y + 1) * T - 0.1, draw: (c) => drawLowTable(c, px, py) }];
    case 'chair':
      return f.face === 'up'
        ? [{ z: (f.y + 1) * T + 0.3, draw: (c) => drawChairFront(c, px, py) }]
        : [{ z: (f.y + 1) * T - 0.5, draw: (c) => drawChairBack(c, px, py) }];
    default:
      return [];
  }
}

const TIER_WOOD = {
  chief: { top: '#8a5c38', light: '#b07f55', dark: '#5f3e25' },
  manager: { top: '#b98d62', light: '#d3aa7e', dark: '#85623f' },
};

function deskLayers(f, px, py, env) {
  const seatFoot = py + T;
  const wood = TIER_WOOD[f.tier] || { top: WOOD, light: WOOD_L, dark: WOOD_D };
  const status = env.statusOf(f.agent) || 'idle';
  const zone = env.colorOfAgent(f.agent);
  return [
    {
      z: seatFoot - 0.5,
      draw: (c) => {
        // chair back behind the character
        rect(c, px + 2, py + 4, 12, 11, '#3d4562');
        rect(c, px + 2, py + 4, 12, 1, '#5b6488');
        rect(c, px + 3, py + 5, 10, 9, '#4a5373');
        rect(c, px + 2, py + 13, 12, 2, '#2d3350');
      },
    },
    {
      z: py + 2 * T - 0.2,
      draw: (c) => {
        const t = env.t;
        const sleeping = status === 'sleeping';
        // desk top + front panel
        rect(c, px, py + T, 2 * T, 12, wood.top);
        rect(c, px, py + T, 2 * T, 1, wood.light);
        rect(c, px, py + T + 11, 2 * T, 1, shade(wood.top, -20));
        rect(c, px, py + T + 12, 2 * T, 4, wood.dark);
        rect(c, px + 1, py + T + 12, 2, 4, shade(wood.dark, -25));
        rect(c, px + 2 * T - 3, py + T + 12, 2, 4, shade(wood.dark, -25));
        rect(c, px, py + T + 15, 2 * T, 1, 'rgba(0,0,0,0.25)');
        // nameplate: gold for the chief, steel for managers
        if (f.tier === 'chief') {
          rect(c, px + 11, py + T + 13, 10, 2, '#e8c547');
          rect(c, px + 11, py + T + 13, 10, 1, '#fff0a8');
        } else if (f.tier === 'manager') {
          rect(c, px + 12, py + T + 13, 8, 2, '#aab8d8');
          rect(c, px + 12, py + T + 13, 8, 1, '#dfe7fa');
        }
        // laptop (lid seen from behind)
        rect(c, px + 3, py + T + 2, 10, 2, '#6c748c');
        rect(c, px + 4, py + 11, 8, 5, sleeping ? '#7a8196' : '#aab2c6');
        rect(c, px + 4, py + 11, 8, 1, '#d2d8e6');
        rect(c, px + 4, py + 15, 8, 1, '#7d86a0');
        rect(c, px + 7, py + 12, 2, 2, zone);
        // desk accessory, one per desk
        const v = (f.variant || 0) % 4;
        if (v === 0) {
          rect(c, px + 14, py + T + 3, 3, 3, '#f1eee3');
          rect(c, px + 14, py + T + 3, 3, 1, '#8a5a38');
          rect(c, px + 17, py + T + 4, 1, 1, '#f1eee3');
          if (status !== 'sleeping' && status !== 'idle') rect(c, px + 15, py + T + 1 - (Math.floor(t * 2) % 2), 1, 1, 'rgba(255,255,255,0.6)');
        } else if (v === 1) {
          rect(c, px + 14, py + T + 4, 3, 3, '#b86a3c');
          rect(c, px + 14, py + T + 1, 3, 3, '#3fa06a');
          rect(c, px + 15, py + T, 1, 2, '#58c487');
        } else if (v === 2) {
          rect(c, px + 14, py + T + 4, 4, 2, '#f1eee3');
          rect(c, px + 14, py + T + 3, 4, 1, '#d8d3c3');
          rect(c, px + 15, py + T + 2, 3, 1, '#f1eee3');
        } else {
          rect(c, px + 15, py + T + 2, 2, 4, '#e5534b');
          rect(c, px + 15, py + T + 1, 2, 1, '#f2c94c');
        }
        // monitor facing the camera
        const mx = px + 18;
        const my = py + 3;
        rect(c, mx, my, 13, 12, '#232838');
        rect(c, mx, my, 13, 1, '#3a4262');
        rect(c, mx + 6, my + 12, 2, 3, '#3a4262');
        rect(c, mx + 3, my + 15, 8, 1, '#2d3350');
        drawScreen(c, mx + 1, my + 1, 11, 9, status, t, hash32(f.agent) % 97);
        env.glows.push({ x: mx - 1, y: my - 1, w: 15, h: 14, status });
        rect(c, mx + 12, my + 10, 1, 1, status === 'idle' || sleeping ? '#4a5170' : STATUS_COLOR[status] || '#4cd08b');
      },
    },
  ];
}

function sofaBack(c, px, py) {
  rect(c, px, py + 2, 48, 14, '#2f6870');
  rect(c, px + 1, py + 1, 46, 2, '#3d7f86');
  rect(c, px + 3, py + 4, 42, 12, '#3d7f86');
  rect(c, px + 3, py + 4, 42, 1, '#58a0a8');
  // arms
  rect(c, px, py + 8, 5, 22, '#2f6870');
  rect(c, px + 43, py + 8, 5, 22, '#2f6870');
  rect(c, px, py + 8, 5, 2, '#4f98a0');
  rect(c, px + 43, py + 8, 5, 2, '#4f98a0');
  // seat base
  rect(c, px + 5, py + 18, 38, 10, '#3d7f86');
  rect(c, px + 5, py + 17, 38, 1, '#58a0a8');
  [15, 31].forEach((x) => rect(c, px + x, py + 17, 1, 11, '#2f6870'));
}
function sofaFront(c, px, py) {
  rect(c, px + 5, py + 26, 38, 6, '#4f98a0');
  rect(c, px + 5, py + 26, 38, 1, '#6dbac2');
  rect(c, px + 5, py + 31, 38, 1, '#2f6870');
  rect(c, px, py + 28, 5, 4, '#2f6870');
  rect(c, px + 43, py + 28, 5, 4, '#2f6870');
  rect(c, px + 2, py + 31, 2, 2, '#1d2238');
  rect(c, px + 44, py + 31, 2, 2, '#1d2238');
}
function armchairBack(c, px, py) {
  rect(c, px, py + 2, 16, 14, '#8a4f6a');
  rect(c, px + 2, py + 4, 12, 12, '#a3627f');
  rect(c, px + 2, py + 4, 12, 1, '#c27e9a');
  rect(c, px, py + 10, 3, 20, '#6f3d55');
  rect(c, px + 13, py + 10, 3, 20, '#6f3d55');
  rect(c, px + 3, py + 18, 10, 10, '#a3627f');
}
function armchairFront(c, px, py) {
  rect(c, px + 3, py + 26, 10, 6, '#b97593');
  rect(c, px + 3, py + 26, 10, 1, '#d493af');
  rect(c, px, py + 28, 3, 4, '#6f3d55');
  rect(c, px + 13, py + 28, 3, 4, '#6f3d55');
}

function drawTv(c, px, py, env) {
  rect(c, px + 2, py + 20, 60, 12, '#7a5a3c');
  rect(c, px + 2, py + 20, 60, 1, '#9b7650');
  rect(c, px + 4, py + 24, 26, 7, '#5f452e');
  rect(c, px + 34, py + 24, 26, 7, '#5f452e');
  rect(c, px + 2, py + 31, 60, 1, '#3d2c1c');
  // screen
  rect(c, px + 6, py + 2, 52, 17, '#14172a');
  rect(c, px + 7, py + 3, 50, 15, '#0d1124');
  rect(c, px + 28, py + 19, 8, 2, '#2b2f40');
  const n = Math.max(1, env.activeCount);
  for (let i = 0; i < 12; i++) {
    const hsh = hash32(`tv${i}${Math.floor(env.t * 2)}`);
    const bh = 2 + ((hsh % 9) * Math.min(1, 0.35 + n / 8)) | 0;
    rect(c, px + 10 + i * 4, py + 16 - bh, 3, bh, i % 3 === 0 ? '#6c8cff' : i % 3 === 1 ? '#3fb68b' : '#f0883e');
  }
  rect(c, px + 9, py + 5, 12, 1, '#e8ecff');
  rect(c, px + 9, py + 7, 7, 1, '#7d86a8');
  env.glows.push({ x: px + 6, y: py + 2, w: 52, h: 17, status: 'tv' });
}

function drawBookshelf(c, px, py, f) {
  rect(c, px, py + 2, 32, 30, '#7a5a3c');
  rect(c, px + 1, py + 3, 30, 28, '#5f452e');
  for (let r = 0; r < 3; r++) {
    const y = py + 4 + r * 9;
    rect(c, px + 2, y + 7, 28, 2, '#9b7650');
    let x = px + 3;
    let i = 0;
    while (x < px + 29) {
      const hsh = hash32(`bk${f.x}${f.y}${r}${i++}`);
      const bw = 2 + (hsh % 3);
      const bh = 5 + ((hsh >>> 3) % 3);
      const cols = ['#e5534b', '#6c8cff', '#f2c94c', '#3fb68b', '#c07cf0', '#f0883e', '#e8e3d4'];
      if ((hsh >>> 6) % 9 === 0) {
        x += 2;
        continue;
      }
      rect(c, x, y + 7 - bh, bw, bh, cols[(hsh >>> 8) % cols.length]);
      rect(c, x, y + 7 - bh, bw, 1, 'rgba(255,255,255,0.25)');
      x += bw + 1;
    }
  }
  rect(c, px, py + 30, 32, 2, '#3d2c1c');
}

function drawPlant(c, px, py, variant, t) {
  const sway = Math.round(Math.sin(t * 1.3 + variant)) * 1;
  const greens = [
    ['#2f8a5a', '#3fb878', '#5fd39a'],
    ['#3a8f4a', '#52b868', '#7dd88a'],
    ['#2c7d70', '#3ba596', '#6bd0c0'],
  ][variant % 3];
  rect(c, px + 3, py + 22, 10, 10, '#b4643c');
  rect(c, px + 3, py + 22, 10, 2, '#cf7f52');
  rect(c, px + 4, py + 30, 8, 2, '#8a4a28');
  rect(c, px + 3, py + 22, 1, 10, 'rgba(255,255,255,0.12)');
  rect(c, px + 4, py + 23, 8, 2, '#3a2a1c');
  // leaves
  rect(c, px + 7, py + 12, 2, 11, greens[0]);
  rect(c, px + 3 + sway, py + 8, 5, 6, greens[0]);
  rect(c, px + 8 + sway, py + 6, 5, 7, greens[1]);
  rect(c, px + 5 + sway, py + 3, 6, 6, greens[1]);
  rect(c, px + 2 + sway, py + 13, 5, 5, greens[1]);
  rect(c, px + 9 + sway, py + 14, 5, 5, greens[0]);
  rect(c, px + 6 + sway, py + 4, 2, 2, greens[2]);
  rect(c, px + 9 + sway, py + 8, 2, 2, greens[2]);
  rect(c, px + 3 + sway, py + 14, 2, 2, greens[2]);
}

function drawCoffee(c, px, py, t) {
  rect(c, px + 2, py + 6, 12, 25, '#2e3347');
  rect(c, px + 2, py + 6, 12, 2, '#4a5170');
  rect(c, px + 3, py + 9, 10, 6, '#1b1f30');
  rect(c, px + 4, py + 10, 3, 1, '#4cd08b');
  rect(c, px + 9, py + 10, 3, 1, Math.floor(t) % 2 ? '#f5c542' : '#7a6620');
  rect(c, px + 5, py + 17, 6, 3, '#14172a');
  rect(c, px + 6, py + 21, 4, 4, '#f1eee3');
  rect(c, px + 6, py + 21, 4, 1, '#8a5a38');
  rect(c, px + 2, py + 29, 12, 2, '#1b1f30');
}
function drawFridge(c, px, py) {
  rect(c, px + 2, py + 3, 12, 28, '#c7d2d6');
  rect(c, px + 2, py + 3, 12, 1, '#eef4f6');
  rect(c, px + 2, py + 14, 12, 1, '#8c999f');
  rect(c, px + 11, py + 6, 1, 6, '#6d787e');
  rect(c, px + 11, py + 17, 1, 8, '#6d787e');
  rect(c, px + 4, py + 6, 3, 3, '#e5534b');
  rect(c, px + 2, py + 29, 12, 2, '#8c999f');
}
function drawVending(c, px, py, t) {
  rect(c, px + 1, py + 2, 30, 29, '#c0392b');
  rect(c, px + 1, py + 2, 30, 2, '#e5574a');
  rect(c, px + 3, py + 5, 20, 21, '#14172a');
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 5; i++) {
      const cols = ['#f2c94c', '#6c8cff', '#3fb68b', '#e8e3d4', '#f0883e'];
      rect(c, px + 4 + i * 4, py + 6 + r * 5, 3, 4, cols[(r * 3 + i) % cols.length]);
    }
  }
  rect(c, px + 24, py + 6, 6, 8, '#2b2f40');
  rect(c, px + 25, py + 7, 4, 2, Math.floor(t * 2) % 2 ? '#4cd08b' : '#2f8f6e');
  rect(c, px + 25, py + 11, 4, 1, '#7d86a8');
  rect(c, px + 24, py + 22, 6, 4, '#14172a');
  rect(c, px + 3, py + 27, 20, 3, '#14172a');
}
function drawCooler(c, px, py, t) {
  rect(c, px + 4, py + 2, 8, 10, 'rgba(120,190,255,0.85)');
  rect(c, px + 4, py + 2, 8, 2, '#a9d8ff');
  rect(c, px + 5, py + 5 + (Math.floor(t) % 2), 2, 2, 'rgba(255,255,255,0.7)');
  rect(c, px + 3, py + 12, 10, 18, '#e8ecf2');
  rect(c, px + 3, py + 12, 10, 1, '#fff');
  rect(c, px + 5, py + 16, 2, 2, '#4a8fe0');
  rect(c, px + 9, py + 16, 2, 2, '#e5534b');
  rect(c, px + 5, py + 22, 6, 3, '#9aa4b6');
  rect(c, px + 3, py + 29, 10, 2, '#b8c0d0');
}
function drawCafeTable(c, px, py) {
  rect(c, px + 2, py + 4, 28, 8, '#d9c4a0');
  rect(c, px + 2, py + 4, 28, 1, '#efe0c4');
  rect(c, px + 2, py + 11, 28, 1, '#a08a64');
  rect(c, px + 14, py + 12, 4, 4, '#7a5a3c');
  rect(c, px + 7, py + 5, 3, 3, '#f1eee3');
  rect(c, px + 21, py + 6, 4, 2, '#e5534b');
}
function drawStool(c, px, py) {
  rect(c, px + 3, py + 8, 10, 4, '#b4643c');
  rect(c, px + 3, py + 8, 10, 1, '#cf7f52');
  rect(c, px + 4, py + 12, 2, 3, '#6d7388');
  rect(c, px + 10, py + 12, 2, 3, '#6d7388');
}
function drawBin(c, px, py) {
  rect(c, px + 4, py + 7, 8, 8, '#6d7388');
  rect(c, px + 3, py + 6, 10, 2, '#8a92a8');
  rect(c, px + 5, py + 9, 1, 5, '#555b70');
}
function drawWhiteboard(c, px, py, env) {
  rect(c, px + 8, py + 22, 2, 10, '#7c859b');
  rect(c, px + 54, py + 22, 2, 10, '#7c859b');
  rect(c, px + 4, py + 2, 56, 21, '#9aa3b8');
  rect(c, px + 5, py + 3, 54, 19, '#f6f4ec');
  rect(c, px + 5, py + 21, 54, 1, '#d6d2c2');
  // diagram
  rect(c, px + 9, py + 6, 10, 6, '#cfe0ff');
  rect(c, px + 9, py + 6, 10, 1, '#6c8cff');
  rect(c, px + 27, py + 6, 10, 6, '#d9f5e6');
  rect(c, px + 27, py + 6, 10, 1, '#3fb68b');
  rect(c, px + 45, py + 6, 10, 6, '#ffe6cf');
  rect(c, px + 45, py + 6, 10, 1, '#f0883e');
  rect(c, px + 19, py + 9, 8, 1, '#555b70');
  rect(c, px + 37, py + 9, 8, 1, '#555b70');
  rect(c, px + 26, py + 8, 1, 3, '#555b70');
  rect(c, px + 44, py + 8, 1, 3, '#555b70');
  rect(c, px + 9, py + 15, 20, 1, '#aab2c6');
  rect(c, px + 9, py + 18, 14, 1, '#aab2c6');
  const blink = env.delegating > 0 && Math.floor(env.t * 2) % 2;
  rect(c, px + 47, py + 15, 6, 5, blink ? '#ffe28a' : '#f2c94c');
  rect(c, px + 33, py + 15, 6, 5, '#ff9ec0');
  // marker tray
  rect(c, px + 14, py + 23, 36, 2, '#7c859b');
  rect(c, px + 18, py + 22, 4, 1, '#3fb68b');
  rect(c, px + 24, py + 22, 4, 1, '#e5534b');
}
function drawMeetingTable(c, px, py) {
  rect(c, px + 2, py + 4, 92, 24, '#b98b5d');
  rect(c, px + 2, py + 4, 92, 2, '#d1a678');
  rect(c, px + 2, py + 24, 92, 4, '#8a6440');
  rect(c, px + 4, py + 28, 4, 4, '#6a4a2c');
  rect(c, px + 88, py + 28, 4, 4, '#6a4a2c');
  rect(c, px + 30, py + 28, 4, 4, '#6a4a2c');
  rect(c, px + 62, py + 28, 4, 4, '#6a4a2c');
  // laptops and papers
  [[10, 9], [40, 12], [70, 9]].forEach(([x, y], i) => {
    rect(c, px + x, py + y, 12, 7, i === 1 ? '#aab2c6' : '#f1eee3');
    rect(c, px + x, py + y, 12, 1, i === 1 ? '#d2d8e6' : '#cfc9b8');
    if (i !== 1) rect(c, px + x + 2, py + y + 3, 7, 1, '#9a947f');
  });
  rect(c, px + 56, py + 11, 5, 5, '#3a4262');
  rect(c, px + 57, py + 12, 3, 3, '#4cd08b');
}
function drawLowTable(c, px, py) {
  rect(c, px + 3, py + 5, 42, 7, '#d7c3a0');
  rect(c, px + 3, py + 5, 42, 1, '#efe0c4');
  rect(c, px + 3, py + 11, 42, 1, '#9a8660');
  rect(c, px + 5, py + 12, 2, 3, '#6a4a2c');
  rect(c, px + 41, py + 12, 2, 3, '#6a4a2c');
  rect(c, px + 10, py + 6, 5, 4, '#f1eee3');
  rect(c, px + 28, py + 6, 3, 3, '#e5534b');
  rect(c, px + 34, py + 6, 5, 4, '#6c8cff');
}
function drawChairBack(c, px, py) {
  rect(c, px + 3, py + 4, 10, 9, '#3d4562');
  rect(c, px + 3, py + 4, 10, 1, '#5b6488');
  rect(c, px + 4, py + 5, 8, 7, '#4a5373');
}
function drawChairFront(c, px, py) {
  rect(c, px + 3, py + 7, 10, 8, '#3d4562');
  rect(c, px + 3, py + 7, 10, 1, '#5b6488');
  rect(c, px + 4, py + 8, 8, 6, '#4a5373');
  rect(c, px + 3, py + 14, 10, 1, '#2d3350');
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export function drawSparkle(ctx, x, y, age, color) {
  const p = age;
  const a = Math.max(0, 1 - p);
  ctx.globalAlpha = a;
  const r = 2 + p * 8;
  rect(ctx, x - r, y, 2, 1, color);
  rect(ctx, x + r, y, 2, 1, color);
  rect(ctx, x, y - r, 1, 2, color);
  rect(ctx, x, y + r, 1, 2, color);
  rect(ctx, x - r * 0.7, y - r * 0.7, 1, 1, color);
  rect(ctx, x + r * 0.7, y - r * 0.7, 1, 1, color);
  rect(ctx, x - r * 0.7, y + r * 0.7, 1, 1, color);
  rect(ctx, x + r * 0.7, y + r * 0.7, 1, 1, color);
  ctx.globalAlpha = 1;
}

export function drawEnvelope(ctx, x, y, color = '#ffd2a6') {
  rect(ctx, x - 4, y - 3, 8, 6, '#f6f4ec');
  rect(ctx, x - 4, y - 3, 8, 1, color);
  rect(ctx, x - 3, y - 2, 1, 1, color);
  rect(ctx, x - 2, y - 1, 1, 1, color);
  rect(ctx, x - 1, y, 2, 1, color);
  rect(ctx, x + 1, y - 1, 1, 1, color);
  rect(ctx, x + 2, y - 2, 1, 1, color);
  rect(ctx, x - 4, y + 3, 8, 1, 'rgba(0,0,0,0.25)');
}

export function drawZ(ctx, x, y, t, i) {
  const p = (t * 0.5 + i * 0.33) % 1;
  ctx.globalAlpha = 1 - p;
  const s = 2 + Math.floor(p * 3);
  rect(ctx, x + p * 6, y - p * 12, s, 1, '#cfd6ff');
  rect(ctx, x + p * 6 + s - 1, y - p * 12 + 1, 1, 1, '#cfd6ff');
  rect(ctx, x + p * 6, y - p * 12 + 2, s, 1, '#cfd6ff');
  ctx.globalAlpha = 1;
}
