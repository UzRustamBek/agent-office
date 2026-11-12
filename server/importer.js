// Import your own agents from Claude Code subagent files
// (`~/.claude/agents/**/*.md` and `<project>/.claude/agents/**/*.md`).
// Only metadata (name, description, model, tools, color) is read; the system
// prompt body is never copied into the roster.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseFrontmatter } from './frontmatter.js';
import { normalizeRoster, prettify, resolveColor, slug } from '../web/js/core/roster.js';

const MAX_FILES = 500;
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 4;
const MAIN_HINTS = ['director', 'direktor', 'orchestrator', 'lead', 'main', 'ceo', 'boss', 'manager'];

/** Default folders searched when none are given. */
export function defaultAgentDirs(cwd = process.cwd()) {
  return [path.join(os.homedir(), '.claude', 'agents'), path.join(cwd, '.claude', 'agents')];
}

function walk(dir, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isSymbolicLink()) continue; // never follow links out of the folder
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
    if (out.length >= MAX_FILES) return;
  }
}

function firstSentence(text, max = 80) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.{8,}?[.!?])(\s|$)/);
  const s = (m ? m[1] : t).replace(/[.]+$/, '');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * @param {string[]} dirs folders to scan, later folders override earlier ones
 * @param {{ defaultDepartment?: string, mainAgent?: string, title?: string }} [opts]
 */
export function importAgents(dirs, opts = {}) {
  const found = new Map(); // key: slug(name) -> agent
  const files = [];
  const skipped = [];
  const scanned = [];

  for (const dir of dirs) {
    const root = path.resolve(dir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    scanned.push(root);
    const list = [];
    walk(root, 0, list);
    for (const file of list) {
      let text;
      try {
        if (fs.statSync(file).size > MAX_BYTES) {
          skipped.push({ file, reason: 'file too large' });
          continue;
        }
        text = fs.readFileSync(file, 'utf8');
      } catch (err) {
        skipped.push({ file, reason: String(err.message || err) });
        continue;
      }
      const { data, hasFrontmatter } = parseFrontmatter(text);
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!hasFrontmatter || !name) {
        skipped.push({ file, reason: 'no frontmatter with a "name"' });
        continue;
      }
      const rel = path.relative(root, file).split(path.sep);
      const department = rel.length > 1 ? rel[0] : opts.defaultDepartment || 'agents';
      const color = resolveColor(String(data.color || ''), null);
      const agent = {
        id: slug(name),
        name: prettify(name),
        role: firstSentence(data.description),
        department,
        description: String(data.description || '').replace(/\s+/g, ' ').trim(),
        model: typeof data.model === 'string' ? data.model : '',
        tools: toList(data.tools),
        skills: toList(data.skills),
      };
      if (color) agent.look = { shirt: color };
      found.set(agent.id, agent); // later folders (project) override earlier (user)
      files.push(file);
    }
  }

  const agents = [...found.values()];
  const wanted = opts.mainAgent ? slug(opts.mainAgent) : agents.map((a) => a.id).find((id) => MAIN_HINTS.includes(id));
  const roster = normalizeRoster({
    office: {
      title: opts.title || 'My Agent Office',
      subtitle: `${agents.length} agents imported`,
      mainAgent: wanted || '',
    },
    departments: [...new Set(agents.map((a) => a.department))].map((d) => ({ id: slug(d), name: prettify(d) })),
    agents,
  });
  return { roster, files, skipped, scanned };
}
