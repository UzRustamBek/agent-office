// Command line interface for Agent Office.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { STATUS_LIST } from '../web/js/core/model.js';
import { defaultAgentDirs, importAgents } from './importer.js';
import {
  buildHookConfig,
  hookScriptPath,
  mergeHooks,
  readSettings,
  removeHooks,
  settingsPath,
  writeSettings,
} from './hooks.js';
import { liveServers } from './registry.js';
import { VERSION, createOfficeServer, loadRosterFile, resolveRosterFile } from './server.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const c = { bold: paint('1'), dim: paint('2'), green: paint('32'), red: paint('31'), yellow: paint('33'), cyan: paint('36') };

const HELP = `
${c.bold('Agent Office')} ${VERSION}  your personal AI agents, alive in a tiny pixel office

${c.bold('Usage')}
  agent-office <command> [options]

${c.bold('Commands')}
  start                 Serve the office and the live event stream
  import [dir...]       Build a roster from Claude Code agent files (.claude/agents)
  hooks <action>        print | install | uninstall | status  (Claude Code hooks)
  emit                  Send one event to a running server (any tool can use this)
  doctor                Check roster, server and hooks
  help | --version

${c.bold('start')}
  --agents <file>       Roster JSON (default: agents.local.json, agents.json, bundled example)
  --port <n>            Port (default 4317; the next free port is used if busy)
  --host <addr>         Bind address (default 127.0.0.1; only change this on a trusted network)
  --demo                Simulate agents working so you can see the office alive
  --demo-speed <n>      Demo speed multiplier (default 1)
  --share-prompts       Show task text from prompts in the activity label (off by default)
  --open                Open the browser

${c.bold('import')}
  [dir...]              Folders to scan (default: ~/.claude/agents and ./.claude/agents)
  --out <file>          Output file (default: agents.local.json)
  --main <name>         The orchestrator agent (default: director/orchestrator/lead if found)
  --title <text>        Office title
  --dry-run             Print the roster instead of writing it

${c.bold('hooks')}
  print   [--all] [--agent <id>]
  install [--scope user|project|local] [--all] [--agent <id>] [--write]
  uninstall [--scope ...] [--write]        (install/uninstall only change files with --write)
  status

${c.bold('emit')}
  --agent <id> --status <${STATUS_LIST.join('|')}> [--activity <text>] [--tool <name>]
  --delegate <from>:<to> [--task <text>]
`;

/** Tiny argv parser: --key value, --flag, positional list. */
export function parseArgs(argv, booleans = []) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
      if (eq !== -1) flags[key] = a.slice(eq + 1);
      else if (booleans.includes(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[key] = true;
      else flags[key] = argv[++i];
    } else positional.push(a);
  }
  return { flags, positional };
}

function fail(msg) {
  console.error(`${c.red('error')} ${msg}`);
  process.exitCode = 1;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* opening the browser is a convenience only */
  }
}

// --- start -------------------------------------------------------------------
async function cmdStart(argv) {
  const { flags } = parseArgs(argv, ['demo', 'open', 'share-prompts']);
  const port = flags.port === undefined ? 4317 : Number(flags.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fail('--port must be a number between 0 and 65535');
  const host = typeof flags.host === 'string' ? flags.host : '127.0.0.1';
  let picked;
  try {
    picked = resolveRosterFile(typeof flags.agents === 'string' ? flags.agents : undefined);
  } catch (err) {
    return fail(err.message);
  }
  let roster;
  try {
    roster = loadRosterFile(picked.file);
  } catch (err) {
    return fail(err.message);
  }

  const office = createOfficeServer({
    roster,
    rosterFile: picked.source === 'example' ? undefined : picked.file,
    host,
    port,
    demo: Boolean(flags.demo),
    demoSpeed: flags['demo-speed'] ? Number(flags['demo-speed']) || 1 : 1,
    sharePrompts: Boolean(flags['share-prompts']),
  });
  let info;
  try {
    info = await office.start();
  } catch (err) {
    return fail(err.code === 'EADDRINUSE' ? `port ${port} is busy; try --port 0 for any free port` : err.message);
  }

  console.log('');
  console.log(`  ${c.bold('Agent Office')} ${c.dim(VERSION)}`);
  console.log(`  ${c.green('●')} ${c.bold(info.url)}`);
  console.log(`  ${c.dim('roster')}   ${picked.source === 'example' ? 'bundled example (run `agent-office import` to use your own)' : path.relative(process.cwd(), picked.file) || picked.file}  ${c.dim(`(${roster.agents.length} agents, ${roster.departments.length} departments)`)}`);
  console.log(`  ${c.dim('mode')}     ${flags.demo ? 'demo simulation' : 'live: waiting for hook events'}`);
  if (!flags.demo) console.log(`  ${c.dim('connect')}  agent-office hooks install --scope user --write`);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    console.log(`  ${c.yellow('!')} bound to ${host}: anyone on this network can watch the office. Writes still need the token.`);
  }
  console.log(`  ${c.dim('Ctrl+C to stop')}\n`);
  if (flags.open) openBrowser(info.url);

  const shutdown = async () => {
    await office.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// --- import ------------------------------------------------------------------
function cmdImport(argv) {
  const { flags, positional } = parseArgs(argv, ['dry-run']);
  const dirs = positional.length ? positional : defaultAgentDirs();
  let result;
  try {
    result = importAgents(dirs, {
      mainAgent: typeof flags.main === 'string' ? flags.main : undefined,
      title: typeof flags.title === 'string' ? flags.title : undefined,
    });
  } catch (err) {
    return fail(err.issues ? err.message : `import failed: ${err.message}`);
  }
  const { roster, files, skipped, scanned } = result;
  if (!scanned.length) return fail(`no agent folder found. Looked in:\n  ${dirs.map((d) => path.resolve(d)).join('\n  ')}`);
  if (!roster.agents.length) return fail('no agent files with a "name" in the frontmatter were found');

  if (flags['dry-run']) {
    console.log(JSON.stringify(roster, null, 2));
  } else {
    const out = path.resolve(typeof flags.out === 'string' ? flags.out : 'agents.local.json');
    fs.writeFileSync(out, JSON.stringify(roster, null, 2) + '\n', 'utf8');
    console.log(`${c.green('✓')} ${roster.agents.length} agents imported -> ${out}`);
  }
  const counts = roster.departments.map((d) => `${d.name} ${c.dim(roster.agents.filter((a) => a.department === d.id).length)}`);
  console.error(`  departments: ${counts.join(', ')}`);
  console.error(`  main agent : ${roster.office.mainAgent || c.dim('(none)')}`);
  console.error(`  scanned    : ${scanned.join(', ')} (${files.length} files)`);
  if (skipped.length) {
    console.error(c.yellow(`  skipped ${skipped.length} file(s):`));
    for (const s of skipped.slice(0, 8)) console.error(`    - ${path.basename(s.file)}: ${s.reason}`);
  }
  if (!flags['dry-run']) console.error(`\n  Next: ${c.bold('agent-office start')}   (agents.local.json is git-ignored, it stays on your machine)`);
}

// --- hooks -------------------------------------------------------------------
function cmdHooks(argv) {
  const { flags, positional } = parseArgs(argv, ['all', 'write']);
  const action = positional[0] || 'print';
  const scope = typeof flags.scope === 'string' ? flags.scope : 'user';
  const pinned = typeof flags.agent === 'string' ? flags.agent : undefined;
  if (pinned && !/^[\p{L}\p{N}._-]{1,64}$/u.test(pinned)) return fail('--agent may only contain letters, digits, dot, dash and underscore');
  const config = buildHookConfig({ all: Boolean(flags.all), pinnedAgent: pinned });

  try {
    if (action === 'print') {
      console.log(JSON.stringify(config, null, 2));
      console.error(`\n${c.dim('Merge this into ~/.claude/settings.json (user) or .claude/settings.json (project). Or let the CLI do it: hooks install --write')}`);
      return;
    }
    if (action === 'status') {
      for (const s of ['user', 'project', 'local']) {
        const file = settingsPath(s);
        let state = c.dim('no settings file');
        if (fs.existsSync(file)) {
          const merged = JSON.stringify(readSettings(file).hooks || {});
          state = merged.includes('agent-office-hook.js') ? c.green('installed') : c.dim('not installed');
        }
        console.log(`  ${s.padEnd(8)} ${state}  ${c.dim(file)}`);
      }
      return;
    }
    if (action === 'install' || action === 'uninstall') {
      const file = settingsPath(scope);
      const current = readSettings(file);
      const next = action === 'install' ? mergeHooks(current, config) : removeHooks(current);
      const before = Object.keys(current.hooks || {}).length;
      const after = Object.keys(next.hooks || {}).length;
      if (!flags.write) {
        console.log(`${c.yellow('dry run')} ${action} in ${file}`);
        console.log(`  hook events before: ${before}, after: ${after}`);
        console.log(`  hook script       : ${hookScriptPath()}`);
        console.log(`  Run again with ${c.bold('--write')} to apply (a timestamped backup is created).`);
        return;
      }
      const backup = writeSettings(file, next);
      console.log(`${c.green('✓')} ${action}ed in ${file}`);
      if (backup) console.log(`  backup: ${backup}`);
      if (action === 'install') console.log(`  Restart running Claude Code sessions (or open /hooks) so they pick up the change.`);
      return;
    }
    fail(`unknown hooks action "${action}". Use print, install, uninstall or status.`);
  } catch (err) {
    fail(err.message);
  }
}

// --- emit --------------------------------------------------------------------
function postJson(entry, route, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, entry.url);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        timeout: 3000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${entry.token}` },
      },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

async function cmdEmit(argv) {
  const { flags } = parseArgs(argv);
  const servers = liveServers();
  if (!servers.length) return fail('no running Agent Office server found. Start one with `agent-office start`.');
  let event;
  if (typeof flags.delegate === 'string') {
    const [from, to] = flags.delegate.split(':');
    if (!from || !to) return fail('--delegate expects <from>:<to>');
    event = { type: 'delegate', from, to, task: typeof flags.task === 'string' ? flags.task : '' };
  } else {
    if (typeof flags.agent !== 'string' || typeof flags.status !== 'string') return fail('--agent and --status are required');
    if (!STATUS_LIST.includes(flags.status)) return fail(`--status must be one of: ${STATUS_LIST.join(', ')}`);
    event = {
      type: 'status',
      agent: flags.agent,
      status: flags.status,
      activity: typeof flags.activity === 'string' ? flags.activity : '',
      tool: typeof flags.tool === 'string' ? flags.tool : null,
    };
  }
  try {
    const res = await postJson(servers[0], '/api/events', event);
    if (res.status === 202) console.log(`${c.green('✓')} sent to ${servers[0].url}`);
    else fail(`server answered ${res.status}: ${res.body}`);
  } catch (err) {
    fail(err.message);
  }
}

// --- doctor ------------------------------------------------------------------
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function cmdDoctor() {
  let bad = 0;
  const ok = (m) => console.log(`  ${c.green('✓')} ${m}`);
  const warn = (m) => console.log(`  ${c.yellow('!')} ${m}`);
  const no = (m) => {
    bad += 1;
    console.log(`  ${c.red('✗')} ${m}`);
  };

  console.log(c.bold('Agent Office doctor'));
  const major = Number(process.versions.node.split('.')[0]);
  major >= 20 ? ok(`Node.js ${process.versions.node}`) : no(`Node.js ${process.versions.node}: version 20 or newer is required`);

  try {
    const picked = resolveRosterFile();
    const roster = loadRosterFile(picked.file);
    ok(`roster: ${picked.source === 'example' ? 'bundled example' : picked.file} (${roster.agents.length} agents, ${roster.departments.length} departments)`);
    if (!roster.office.mainAgent) warn('no main agent set; delegation from hooks falls back to the first agent');
  } catch (err) {
    no(`roster: ${err.message.split('\n')[0]}`);
  }

  const servers = liveServers();
  if (servers.length) {
    for (const s of servers) ok(`server running at ${s.url} (pid ${s.pid})`);
  } else if (await portFree(4317)) warn('no server running (port 4317 is free). Start: agent-office start');
  else warn('no Agent Office server registered, but port 4317 is in use by something else');

  ok(`hook script: ${hookScriptPath()}`);
  for (const s of ['user', 'project', 'local']) {
    try {
      const file = settingsPath(s);
      if (!fs.existsSync(file)) continue;
      const installed = JSON.stringify(readSettings(file).hooks || {}).includes('agent-office-hook.js');
      (installed ? ok : warn)(`hooks ${installed ? 'installed' : 'not installed'} in ${s} settings`);
    } catch (err) {
      no(err.message);
    }
  }
  console.log(bad ? c.red(`\n${bad} problem(s) found`) : c.green('\nall good'));
  if (bad) process.exitCode = 1;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'start':
      return cmdStart(rest);
    case 'import':
      return cmdImport(rest);
    case 'hooks':
      return cmdHooks(rest);
    case 'emit':
      return cmdEmit(rest);
    case 'doctor':
      return cmdDoctor();
    case '--version':
    case '-v':
    case 'version':
      console.log(VERSION);
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;
    default:
      fail(`unknown command "${cmd}". Run "agent-office help".`);
  }
}
