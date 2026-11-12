// Colors shared by the canvas renderer and the DOM UI.

export const SKINS = ['#f7d9bf', '#eec3a0', '#d8a47a', '#b9835a', '#8a5a3c', '#5b3a27'];
export const HAIRS = ['#2a2018', '#5b3b24', '#8c5a2e', '#c79a52', '#e6cc7e', '#b4472c', '#8e93a2', '#3d4b9a'];

export const OUTLINE = '#1c1830';
export const SHOE = '#2a2433';

export const STATUS_COLOR = {
  idle: '#8b93a7',
  thinking: '#a78bfa',
  typing: '#6c8cff',
  reading: '#38bdf8',
  running: '#2dd4bf',
  searching: '#22d3ee',
  delegating: '#f0883e',
  waiting: '#f5c542',
  permission: '#ff5d8f',
  done: '#4cd08b',
  error: '#e5484d',
  sleeping: '#5b6478',
};

const cache = new Map();

/** Lighten (positive) or darken (negative) a #rrggbb color. */
export function shade(hex, amount) {
  const key = hex + amount;
  let v = cache.get(key);
  if (v) return v;
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amount)));
  v = '#' + ((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1);
  cache.set(key, v);
  return v;
}

/** Linear mix of two #rrggbb colors. */
export function mix(a, b, t) {
  const key = `${a}|${b}|${t}`;
  let v = cache.get(key);
  if (v) return v;
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const m = (s, e) => Math.round(s + (e - s) * t);
  v = '#' + ((1 << 24) | (m(x >> 16, y >> 16) << 16) | (m((x >> 8) & 255, (y >> 8) & 255) << 8) | m(x & 255, y & 255)).toString(16).slice(1);
  cache.set(key, v);
  return v;
}

export const resolveSkin = (v) => (typeof v === 'string' ? v : SKINS[v] || SKINS[1]);
export const resolveHair = (v) => (typeof v === 'string' ? v : HAIRS[v] || HAIRS[0]);
