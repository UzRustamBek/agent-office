// Persisted UI preferences. Storage can be unavailable (private mode, blocked
// cookies), so every access is guarded and the app works without it.

import { detectLang } from './i18n.js';

const KEY = 'agent-office.settings.v1';
const ROSTER_KEY = 'agent-office.roster.v1';

export function defaultSettings() {
  return {
    lang: detectLang(),
    theme: 'auto', // auto | dark | light
    names: 'always', // always | hover | off
    lighting: 'auto', // auto | day | night
    reduceMotion: false,
    bubbles: true,
    sound: false,
    speed: 1,
    logOpen: true,
    legendOpen: false,
  };
}

export function loadSettings() {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch {
    /* use defaults */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !localStorage?.getItem?.(KEY)) {
    base.reduceMotion = true;
  }
  return base;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadStoredRoster() {
  try {
    const raw = localStorage.getItem(ROSTER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeRoster(json) {
  try {
    const raw = JSON.stringify(json);
    if (raw.length > 400_000) return false;
    localStorage.setItem(ROSTER_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredRoster() {
  try {
    localStorage.removeItem(ROSTER_KEY);
  } catch {
    /* ignore */
  }
}
