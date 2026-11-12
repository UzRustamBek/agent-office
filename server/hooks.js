// Build, merge and remove the Claude Code hook configuration.
// Nothing here writes to disk by itself: the CLI decides (and only with --write).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOOK_MARKER = 'agent-office-hook.js';

/** Hook events installed by default; every one works on all current Claude Code versions. */
export const CORE_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
];
/** Extra events available on newer Claude Code versions (`hooks install --all`). */
export const EXTRA_EVENTS = ['SubagentStart', 'PostToolUseFailure', 'PermissionRequest'];

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);

export function hookScriptPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hook', 'agent-office-hook.js');
}

/** Quote a path for the shell Claude Code uses to run hook commands. */
function q(p) {
  return `"${p.replace(/"/g, '\\"')}"`;
}

export function hookCommand(scriptPath = hookScriptPath(), pinnedAgent) {
  const unix = scriptPath.replace(/\\/g, '/');
  const cmd = `node ${q(unix)}`;
  return pinnedAgent ? `AGENT_OFFICE_AGENT=${pinnedAgent} ${cmd}` : cmd;
}

/** The `hooks` section to merge into a Claude Code settings file. */
export function buildHookConfig({ all = false, scriptPath, pinnedAgent } = {}) {
  const events = all ? [...CORE_EVENTS, ...EXTRA_EVENTS] : CORE_EVENTS;
  const command = hookCommand(scriptPath, pinnedAgent);
  const hooks = {};
  for (const ev of events) {
    const entry = { hooks: [{ type: 'command', command, timeout: 3 }] };
    if (TOOL_EVENTS.has(ev)) entry.matcher = '*';
    hooks[ev] = [entry];
  }
  return { hooks };
}

const isOurs = (h) => typeof h?.command === 'string' && h.command.split('\\').join('/').includes(HOOK_MARKER);
const isOurEntry = (entry) => Array.isArray(entry?.hooks) && entry.hooks.some(isOurs);

/** Merge our hooks into an existing settings object, replacing older Agent Office entries. */
export function mergeHooks(settings, config) {
  const next = { ...(settings || {}) };
  const hooks = { ...(next.hooks || {}) };
  for (const [event, entries] of Object.entries(config.hooks)) {
    const existing = Array.isArray(hooks[event]) ? hooks[event].filter((e) => !isOurEntry(e)) : [];
    hooks[event] = [...existing, ...entries];
  }
  next.hooks = hooks;
  return next;
}

/** Remove every Agent Office hook, leaving the user's own hooks untouched. */
export function removeHooks(settings) {
  const next = { ...(settings || {}) };
  if (!next.hooks || typeof next.hooks !== 'object') return next;
  const hooks = {};
  for (const [event, entries] of Object.entries(next.hooks)) {
    if (!Array.isArray(entries)) {
      hooks[event] = entries;
      continue;
    }
    const kept = entries.filter((e) => !isOurEntry(e));
    if (kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

/** Settings file for a scope: user | project | local. */
export function settingsPath(scope, cwd = process.cwd()) {
  if (scope === 'user') return path.join(os.homedir(), '.claude', 'settings.json');
  if (scope === 'project') return path.join(cwd, '.claude', 'settings.json');
  if (scope === 'local') return path.join(cwd, '.claude', 'settings.local.json');
  throw new Error(`Unknown scope "${scope}". Use user, project or local.`);
}

export function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}). Fix it first; nothing was changed.`);
  }
}

/** Write settings atomically and keep a timestamped backup of the previous file. */
export function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (fs.existsSync(file)) {
    backup = `${file}.agent-office-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup);
  }
  const tmp = `${file}.agent-office-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  return backup;
}
