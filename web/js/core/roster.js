// Roster: the list of your personal agents, grouped into departments.
// `normalizeRoster` accepts friendly input (see docs/AGENTS-FORMAT.md),
// fills in defaults and returns a strict structure used everywhere else.

import { hash32 } from './rng.js';

export const SKIN_COUNT = 6;
export const HAIR_STYLES = ['short', 'long', 'bun', 'spiky', 'curly', 'cap', 'bald', 'bob'];
export const HAIR_COLOR_COUNT = 8;
export const ACCESSORIES = ['none', 'glasses', 'headset', 'beard', 'tie', 'earrings'];

export const MAX_AGENTS = 120;
export const MAX_DEPARTMENTS = 24;

export const DEPARTMENT_COLORS = [
  '#6c8cff', // blue
  '#f0883e', // orange
  '#3fb68b', // green
  '#c07cf0', // violet
  '#e8c547', // yellow
  '#ef6f8f', // pink
  '#3cc4d6', // cyan
  '#9aa7c4', // slate
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAMED_COLORS = {
  blue: '#6c8cff',
  orange: '#f0883e',
  green: '#3fb68b',
  purple: '#c07cf0',
  violet: '#c07cf0',
  yellow: '#e8c547',
  pink: '#ef6f8f',
  red: '#e5534b',
  cyan: '#3cc4d6',
  teal: '#3cc4d6',
  gray: '#9aa7c4',
  grey: '#9aa7c4',
};

export class RosterError extends Error {
  constructor(issues) {
    super(`Invalid roster:\n - ${issues.join('\n - ')}`);
    this.name = 'RosterError';
    this.issues = issues;
  }
}

/** URL/ID friendly slug. Keeps letters and digits of every script (Latin, Cyrillic, CJK, Arabic, ...). */
export function slug(input) {
  const s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[ʻʼ'’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'agent';
}

export function resolveColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (HEX_RE.test(v)) return v;
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  return fallback;
}

const ACRONYMS = new Set(['ai', 'api', 'b2b', 'b2c', 'ceo', 'cfo', 'cto', 'crm', 'erp', 'hr', 'it', 'qa', 'seo', 'smm', 'ui', 'ux']);

/** Title-case a folder or id: "marketing-sotuv" -> "Marketing Sotuv", "it" -> "IT". */
export function prettify(text) {
  return String(text ?? '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amount)));
  const r = f(n >> 16);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const PANTS = ['#2f3650', '#3b3f4f', '#4a3b32', '#2c4a4f', '#51415f', '#3f4a3a'];

/** Deterministic look generated from an agent id and its department color. */
export function defaultLook(id, deptColor = '#6c8cff') {
  const h = hash32(id);
  return {
    skin: h % SKIN_COUNT,
    hair: HAIR_STYLES[(h >>> 3) % HAIR_STYLES.length],
    hairColor: (h >>> 7) % HAIR_COLOR_COUNT,
    shirt: shade(deptColor, ((h >>> 11) % 5) * 12 - 24),
    pants: PANTS[(h >>> 14) % PANTS.length],
    accessory: ACCESSORIES[(h >>> 17) % ACCESSORIES.length],
  };
}

function normalizeLook(input, id, deptColor, issues) {
  const base = defaultLook(id, deptColor);
  if (!input || typeof input !== 'object') return base;
  const look = { ...base };
  if (Number.isInteger(input.skin) && input.skin >= 0 && input.skin < SKIN_COUNT) look.skin = input.skin;
  else if (typeof input.skin === 'string' && HEX_RE.test(input.skin)) look.skin = input.skin.toLowerCase();
  else if (input.skin !== undefined) issues.push(`agent "${id}": look.skin must be 0-${SKIN_COUNT - 1} or #rrggbb`);

  if (HAIR_STYLES.includes(input.hair)) look.hair = input.hair;
  else if (input.hair !== undefined) issues.push(`agent "${id}": look.hair must be one of ${HAIR_STYLES.join(', ')}`);

  if (Number.isInteger(input.hairColor) && input.hairColor >= 0 && input.hairColor < HAIR_COLOR_COUNT) {
    look.hairColor = input.hairColor;
  } else if (typeof input.hairColor === 'string' && HEX_RE.test(input.hairColor)) {
    look.hairColor = input.hairColor.toLowerCase();
  } else if (input.hairColor !== undefined) {
    issues.push(`agent "${id}": look.hairColor must be 0-${HAIR_COLOR_COUNT - 1} or #rrggbb`);
  }

  if (typeof input.shirt === 'string') look.shirt = resolveColor(input.shirt, look.shirt);
  if (typeof input.pants === 'string') look.pants = resolveColor(input.pants, look.pants);

  if (ACCESSORIES.includes(input.accessory)) look.accessory = input.accessory;
  else if (input.accessory !== undefined) {
    issues.push(`agent "${id}": look.accessory must be one of ${ACCESSORIES.join(', ')}`);
  }
  return look;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 24, itemMax = 48) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, itemMax)).slice(0, max) : [];

// ---------------------------------------------------------------------------
// Hierarchy: who reports to whom
// ---------------------------------------------------------------------------


// Titles that make someone the head of a department, strongest first. "Lead"
// counts only as "team/tech lead", so "Lead generation" is not a manager, and
// assistants and deputies never lead.
const STRONG_TITLE = /(^|[^a-z])(head|chief|director|cto|cfo|coo|cmo|ceo)([^a-z]|$)|direktor|boshliq|rahbar|timlid|руководител|директор|начальник/i;
const WEAK_TITLE = /(^|[^a-z])((team|tech|group)\s+lead|lead|manager)([^a-z]|$)|menejer|менеджер/i;
const NOT_HEAD = /assistant|deputy|intern|yordamchi|o.rinbosar|помощник|ассистент|заместител|lead\s+gen/i;
function titleScore(text) {
  if (!text || NOT_HEAD.test(text)) return 0;
  return STRONG_TITLE.test(text) ? 2 : WEAK_TITLE.test(text) ? 1 : 0;
}
const NO_MANAGER = new Set(['', 'none', 'null', 'top', 'nobody', 'root']);

/**
 * Fills `reportsTo`, `level`, `tier` and `team` on every agent.
 *
 *  - An explicit `reportsTo` (an agent id or name) always wins; `null` makes the
 *    agent a top-level agent.
 *  - Otherwise the main agent is the root, each department's head (flagged
 *    `lead: true`, or recognised by a title such as "Head", "Lead", "Director",
 *    "Boshliq", "Rahbar") reports to the main agent, and everyone else
 *    reports to their department head (or straight to the main agent).
 *
 * tier: chief = top of the tree, manager = has people reporting to them, doer = the rest.
 */
function resolveHierarchy(agents, hints, mainId, warnings) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const byName = new Map(agents.map((a) => [slug(a.name), a]));
  const main = byId.get(mainId);

  // department heads (used for agents without an explicit manager)
  const headOf = new Map();
  const deptIds = [...new Set(agents.map((a) => a.department))];
  for (const dept of deptIds) {
    const members = agents.filter((a) => a.department === dept);
    if (main && main.department === dept) {
      headOf.set(dept, main.id);
      continue;
    }
    const flagged = members.find((a) => hints.get(a.id)?.lead);
    let best = null;
    let bestScore = 0;
    for (const a of members) {
      const score = Math.max(titleScore(a.role), titleScore(a.name));
      if (score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
    const named = flagged || best;
    if (named) headOf.set(dept, named.id);
  }

  const inferred = (a) => {
    if (a.id === mainId) return null;
    const head = headOf.get(a.department);
    if (head && head !== a.id) return head;
    return mainId && mainId !== a.id ? mainId : null;
  };
  for (const a of agents) {
    const hint = hints.get(a.id);
    let parent = inferred(a);
    if (hint?.explicit) {
      const v = hint.reportsTo;
      if (v === null || v === undefined || NO_MANAGER.has(String(v).trim().toLowerCase())) {
        parent = null;
      } else {
        const target = byId.get(slug(v)) || byName.get(slug(v));
        if (!target) warnings.push(`agent "${a.id}": reportsTo "${v}" is not an agent in this roster (placed automatically)`);
        else if (target.id === a.id) warnings.push(`agent "${a.id}": cannot report to itself (placed automatically)`);
        else parent = target.id;
      }
    }
    a.reportsTo = parent;
  }

  // cycles: the agent where a loop is found becomes a top-level agent
  for (const a of agents) {
    const seen = new Set([a.id]);
    for (let cur = byId.get(a.reportsTo); cur; cur = byId.get(cur.reportsTo)) {
      if (seen.has(cur.id)) {
        warnings.push(`reporting cycle through "${a.id}": it is shown at the top instead`);
        a.reportsTo = null;
        break;
      }
      seen.add(cur.id);
    }
  }

  const team = new Map(agents.map((a) => [a.id, []]));
  for (const a of agents) if (a.reportsTo) team.get(a.reportsTo).push(a.id);
  const depth = (a) => (a.reportsTo ? 1 + depth(byId.get(a.reportsTo)) : 0);
  for (const a of agents) {
    a.level = depth(a);
    a.team = team.get(a.id);
    a.tier = a.level === 0 ? 'chief' : a.team.length ? 'manager' : 'doer';
  }
}

/**
 * Normalize user input into the canonical roster. Throws RosterError with all
 * problems listed, never silently drops an agent.
 */
export function normalizeRoster(input) {
  const issues = [];
  if (Array.isArray(input)) input = { agents: input };
  if (!input || typeof input !== 'object') throw new RosterError(['roster must be an object or an array of agents']);

  const rawAgents = Array.isArray(input.agents) ? input.agents : null;
  if (!rawAgents) throw new RosterError(['"agents" must be an array']);
  if (rawAgents.length > MAX_AGENTS) issues.push(`too many agents (${rawAgents.length}); the limit is ${MAX_AGENTS}`);

  // Departments -----------------------------------------------------------
  const departments = [];
  const deptIndex = new Map();
  const addDepartment = (id, name, color) => {
    if (deptIndex.has(id)) return deptIndex.get(id);
    if (departments.length >= MAX_DEPARTMENTS) {
      const msg = `too many departments; the limit is ${MAX_DEPARTMENTS}`;
      if (!issues.includes(msg)) issues.push(msg);
      return deptIndex.get('general') || departments[0];
    }
    const dept = {
      id,
      name: name || prettify(id),
      color: resolveColor(color, DEPARTMENT_COLORS[departments.length % DEPARTMENT_COLORS.length]),
    };
    departments.push(dept);
    deptIndex.set(id, dept);
    return dept;
  };
  for (const d of Array.isArray(input.departments) ? input.departments : []) {
    if (!d || typeof d !== 'object') continue;
    const id = slug(d.id || d.name);
    addDepartment(id, str(d.name, 40), d.color);
  }

  // Agents ----------------------------------------------------------------
  const seen = new Set();
  const agents = [];
  const hints = new Map(); // agent id -> { reportsTo, explicit, lead }
  rawAgents.slice(0, MAX_AGENTS).forEach((a, i) => {
    if (!a || typeof a !== 'object') {
      issues.push(`agents[${i}] must be an object`);
      return;
    }
    const name = str(a.name, 60) || str(a.id, 60);
    if (!name) {
      issues.push(`agents[${i}] needs a "name" or "id"`);
      return;
    }
    const id = str(a.id, 64) ? slug(a.id) : slug(name);
    if (seen.has(id)) {
      issues.push(`duplicate agent id "${id}" (agents[${i}])`);
      return;
    }
    seen.add(id);
    const deptKey = slug(a.department || 'general');
    const dept = deptIndex.get(deptKey) || addDepartment(deptKey, str(a.department, 40) || undefined, undefined);
    const key = 'reportsTo' in a ? 'reportsTo' : 'reports_to' in a ? 'reports_to' : null;
    hints.set(id, { explicit: key !== null, reportsTo: key ? a[key] : undefined, lead: a.lead === true, index: i });
    agents.push({
      id,
      name,
      role: str(a.role, 80),
      department: dept.id,
      description: str(a.description, 600),
      model: str(a.model, 40),
      tools: strList(a.tools),
      skills: strList(a.skills),
      look: normalizeLook(a.look, id, dept.color, issues),
    });
  });

  const office = input.office && typeof input.office === 'object' ? input.office : {};
  const wantedMain = slug(office.mainAgent || '');
  const mainAgent = agents.some((a) => a.id === wantedMain) ? wantedMain : agents[0]?.id || '';
  const warnings = [];
  resolveHierarchy(agents, hints, mainAgent, warnings);

  if (issues.length) throw new RosterError(issues);

  return {
    office: {
      title: str(office.title, 60) || 'Agent Office',
      subtitle: str(office.subtitle, 120),
      mainAgent,
    },
    // problems that do not stop the office (for example a reportsTo typo): the
    // agent is placed as if the field were missing and the reason is listed here
    warnings,
    departments: departments.filter((d) => agents.some((a) => a.department === d.id)),
    agents,
  };
}
