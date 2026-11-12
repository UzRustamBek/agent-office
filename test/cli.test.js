import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'agent-office.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, { cwd = root, env = {} } = {}) {
  const home = env.HOME || tmp('ao-home-');
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', HOME: home, USERPROFILE: home, AGENT_OFFICE_HOME: path.join(home, '.agent-office'), ...env },
  });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

test('cli: help and version', () => {
  const help = run(['help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /Usage/);
  assert.match(help.out, /hooks <action>/);
  assert.match(run(['--version']).out, /^\d+\.\d+\.\d+/);
  const bad = run(['nonsense']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown command/);
});

test('cli: import writes a roster and reports departments', () => {
  const dir = tmp('ao-cli-agents-');
  fs.mkdirSync(path.join(dir, 'ops'));
  fs.writeFileSync(path.join(dir, 'ops', 'planner.md'), '---\nname: planner\ndescription: Plans the week. Owns the calendar.\n---\nprompt');
  fs.writeFileSync(path.join(dir, 'director.md'), '---\nname: director\ndescription: Leads everyone.\n---\n');
  const out = path.join(tmp('ao-cli-out-'), 'roster.json');
  const res = run(['import', dir, '--out', out]);
  assert.equal(res.code, 0, res.err);
  const roster = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(roster.agents.length, 2);
  assert.equal(roster.office.mainAgent, 'director');
  assert.match(res.err, /departments:/);
  assert.ok(!fs.readFileSync(out, 'utf8').includes('prompt'));

  const dry = run(['import', dir, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.equal(JSON.parse(dry.out).agents.length, 2);

  const empty = run(['import', tmp('ao-cli-empty-')]);
  assert.equal(empty.code, 1);
});

test('cli: hooks install is a dry run until --write, and uninstall is clean', () => {
  const project = tmp('ao-cli-project-');
  const file = path.join(project, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
  const before = fs.readFileSync(file, 'utf8');

  const dry = run(['hooks', 'install', '--scope', 'project'], { cwd: project });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /dry run/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a dry run must not touch the file');

  const real = run(['hooks', 'install', '--scope', 'project', '--write'], { cwd: project });
  assert.equal(real.code, 0, real.err);
  const installed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(installed.theme, 'dark');
  assert.ok(installed.hooks.PreToolUse);
  assert.equal(installed.hooks.Stop.length, 2);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('agent-office-backup')), 'a backup is created');

  const status = run(['hooks', 'status'], { cwd: project });
  assert.match(status.out, /project\s+installed/);

  const removed = run(['hooks', 'uninstall', '--scope', 'project', '--write'], { cwd: project });
  assert.equal(removed.code, 0, removed.err);
  const clean = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(clean.hooks), ['Stop']);
  assert.equal(clean.hooks.Stop[0].hooks[0].command, 'echo mine');
});

test('cli: hooks refuse broken settings and unsafe agent ids', () => {
  const project = tmp('ao-cli-broken-');
  const file = path.join(project, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  const res = run(['hooks', 'install', '--scope', 'project', '--write'], { cwd: project });
  assert.equal(res.code, 1);
  assert.match(res.err, /not valid JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'nothing is changed');

  const inj = run(['hooks', 'print', '--agent', 'x; rm -rf /']);
  assert.equal(inj.code, 1);
});

test('cli: hooks print emits valid JSON with the script path', () => {
  const res = run(['hooks', 'print', '--agent', 'backend']);
  assert.equal(res.code, 0);
  const cfg = JSON.parse(res.out);
  assert.match(cfg.hooks.Stop[0].hooks[0].command, /AGENT_OFFICE_AGENT=backend node ".*agent-office-hook\.js"/);
});

test('cli: start validates its inputs', () => {
  const missing = run(['start', '--agents', path.join(tmp('ao-nope-'), 'missing.json')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /not found/);
  const port = run(['start', '--port', 'abc']);
  assert.equal(port.code, 1);
  const bad = path.join(tmp('ao-badroster-'), 'agents.json');
  fs.writeFileSync(bad, JSON.stringify({ agents: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }));
  const res = run(['start', '--agents', bad]);
  assert.equal(res.code, 1);
  assert.match(res.err, /duplicate agent id/);
});

test('cli: emit explains itself when no server is running; doctor reports', () => {
  const emit = run(['emit', '--agent', 'a', '--status', 'idle']);
  assert.equal(emit.code, 1);
  assert.match(emit.err, /no running Agent Office server/);
  const doc = run(['doctor']);
  assert.match(doc.out, /Node\.js/);
  assert.match(doc.out, /roster/);
});
