import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AUTOSTART_MARKER, autostartStatus, buildAutostart, installAutostart, removeAutostart, startArgs } from '../server/autostart.js';

const base = { node: '/opt/node', cli: '/opt/ao/bin/agent-office.js', cwd: '/work' };

test('start args always carry --once and optional port/agents', () => {
  assert.deepEqual(startArgs(), ['start', '--once']);
  assert.deepEqual(startArgs({ port: 4317, agents: 'a.json' }), ['start', '--once', '--port', '4317', '--agents', 'a.json']);
});

test('windows: hidden VBS in the Startup folder, paths with spaces are quoted', () => {
  const r = buildAutostart({ ...base, platform: 'win32', home: 'C:\\Users\\u', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'D:\\Claude PRO MAX\\ao\\bin\\agent-office.js', cwd: 'D:\\Claude PRO MAX\\ao' });
  assert.match(r.file.replaceAll('\\', '/'), /Start Menu\/Programs\/Startup\/Agent Office\.vbs$/);
  assert.ok(r.content.includes(AUTOSTART_MARKER));
  assert.ok(r.content.includes('"C:\\Program Files\\nodejs\\node.exe"'), 'node path quoted');
  assert.ok(r.content.includes('"D:\\Claude PRO MAX\\ao\\bin\\agent-office.js"'), 'cli path quoted');
  assert.match(r.content, /, 0, False\r\n/, 'hidden window, no waiting');
});

test('macOS: launch agent plist escapes XML', () => {
  const r = buildAutostart({ ...base, platform: 'darwin', home: '/Users/u', cwd: '/Users/u/a&b' });
  assert.equal(r.file.replaceAll('\\', '/'), '/Users/u/Library/LaunchAgents/app.agent-office.plist');
  assert.ok(r.content.includes('<string>--once</string>'));
  assert.ok(r.content.includes('/Users/u/a&amp;b'));
});

test('linux: autostart desktop entry', () => {
  const r = buildAutostart({ ...base, platform: 'linux', home: '/home/u', env: {} });
  assert.equal(r.file.replaceAll('\\', '/'), '/home/u/.config/autostart/agent-office.desktop');
  assert.match(r.content, /^Exec="\/opt\/node" "\/opt\/ao\/bin\/agent-office\.js" "start" "--once"/m);
});

test('install / status / uninstall touch only their own file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-auto-'));
  try {
    const opts = { ...base, platform: 'linux', home, env: {} };
    assert.equal(autostartStatus(opts).installed, false);
    const file = installAutostart(opts);
    assert.equal(autostartStatus(opts).installed, true);
    assert.equal(removeAutostart(opts), true);
    assert.equal(fs.existsSync(file), false);
    assert.equal(removeAutostart(opts), false, 'nothing left to remove');

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[Desktop Entry]\nName=Mine\n');
    assert.throws(() => installAutostart(opts), /not created by Agent Office/);
    assert.throws(() => removeAutostart(opts), /not created by Agent Office/);
    assert.ok(fs.readFileSync(file, 'utf8').includes('Mine'), 'foreign file left alone');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
