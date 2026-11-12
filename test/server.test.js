import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createOfficeServer, loadRosterFile } from '../server/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const TOKEN = 'test-token';
let office;
let base;
let home;

function request(method, route, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(route, base);
    const data = body === undefined ? undefined : raw ?? JSON.stringify(body);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...(data ? { 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: out, json: () => JSON.parse(out) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}
const authed = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-home-'));
  process.env.AGENT_OFFICE_HOME = home;
  office = createOfficeServer({
    roster: loadRosterFile(path.join(root, 'agents.example.json')),
    port: 0,
    token: TOKEN,
    quiet: true,
  });
  const info = await office.start();
  base = info.url;
});

after(async () => {
  await office.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

test('serves the UI with security headers', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('health, state and roster endpoints', async () => {
  const health = (await request('GET', '/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.agents, 22);
  const state = (await request('GET', '/api/state')).json();
  assert.equal(Object.keys(state.agents).length, 22);
  assert.equal((await request('GET', '/api/roster')).json().office.mainAgent, 'director');
});

test('blocks path traversal and unknown routes', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/%2e%2e/%2e%2e/server/server.js']) {
    const res = await request('GET', p);
    assert.ok([403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.ok(!res.text.includes('"name": "agent-office"'), `${p} leaked a file`);
  }
  assert.equal((await request('GET', '/api/nope')).status, 404);
  assert.equal((await request('DELETE', '/api/state')).status, 405);
});

test('rejects foreign Host headers (DNS rebinding protection)', async () => {
  const res = await request('GET', '/api/health', { headers: { host: 'evil.example.com' } });
  assert.equal(res.status, 403);
});

test('events require the token and JSON content type', async () => {
  const evt = { agent: 'backend', status: 'typing', activity: 'Editing app.js' };
  assert.equal((await request('POST', '/api/events', { body: evt, headers: { 'content-type': 'application/json' } })).status, 401);
  assert.equal((await request('POST', '/api/events', { body: evt, headers: { authorization: 'Bearer nope', 'content-type': 'application/json' } })).status, 401);
  assert.equal((await request('POST', '/api/events', { body: evt, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' } })).status, 415);
  const ok = await request('POST', '/api/events', { body: evt, headers: authed });
  assert.equal(ok.status, 202);
  assert.equal(ok.json().accepted, 1);
  assert.equal(office.state.agents.backend.status, 'typing');
});

test('rejects bad JSON, oversized bodies and invalid events', async () => {
  assert.equal((await request('POST', '/api/events', { body: 1, raw: '{nope', headers: authed })).status, 400);
  const big = JSON.stringify({ agent: 'backend', status: 'idle', activity: 'x'.repeat(200_000) });
  assert.equal((await request('POST', '/api/events', { body: 1, raw: big, headers: authed })).status, 413);
  const res = await request('POST', '/api/events', { body: { events: [{ agent: 'x y', status: 'idle' }, { agent: 'qa', status: 'bogus' }] }, headers: authed });
  assert.equal(res.json().accepted, 0);
});

test('hook payloads are translated into events', async () => {
  const res = await request('POST', '/api/hook', {
    headers: authed,
    body: { source: 'claude', payload: { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\secret\\notes.md' } } },
  });
  assert.equal(res.status, 202);
  const main = office.state.agents[office.state.roster.office.mainAgent];
  assert.equal(main.status, 'reading');
  assert.equal(main.activity, 'Reading notes.md');
  assert.ok(!main.activity.includes('secret'), 'directories never leak into the activity label');
});

test('pinned agent and subagent delegation', async () => {
  await request('POST', '/api/hook', {
    headers: authed,
    body: { agent: 'writer', payload: { hook_event_name: 'UserPromptSubmit', prompt: 'private text' } },
  });
  assert.equal(office.state.agents.writer.status, 'thinking');
  assert.equal(office.state.agents.writer.activity, 'Received a task', 'prompt text is hidden by default');

  await request('POST', '/api/hook', {
    headers: authed,
    body: { payload: { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'qa', description: 'x' } } },
  });
  assert.equal(office.state.agents.director.status, 'delegating');
  assert.equal(office.state.agents.director.counters.delegated >= 1, true);
  assert.equal(office.state.agents.qa.counters.received >= 1, true);
});

test('unknown agents are added as guests and announced with a new snapshot', async () => {
  const res = await request('POST', '/api/events', { body: { agent: 'newcomer', status: 'searching', activity: 'Searching' }, headers: authed });
  assert.equal(res.status, 202);
  assert.ok(office.state.agents.newcomer);
  assert.equal((await request('GET', '/api/roster')).json().agents.some((a) => a.id === 'newcomer'), true);
});

test('SSE stream: snapshot first, then live events', async () => {
  const messages = [];
  await new Promise((resolve, reject) => {
    const u = new URL('/api/stream', base);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.+)$/m);
          const data = block.match(/^data: (.+)$/m);
          if (ev && data) messages.push({ event: ev[1], data: JSON.parse(data[1]) });
          if (messages.length === 1) {
            request('POST', '/api/events', { body: { agent: 'qa', status: 'running', activity: 'Running npm test' }, headers: authed });
          }
          if (messages.length >= 2) {
            req.destroy();
            resolve();
          }
        }
      });
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' ? resolve() : reject(err)));
    setTimeout(() => reject(new Error('timeout waiting for SSE')), 4000);
  });
  assert.equal(messages[0].event, 'snapshot');
  assert.ok(messages[0].data.roster.agents.length >= 22);
  assert.equal(messages[1].event, 'evt');
  assert.equal(messages[1].data.agent, 'qa');
});

test('hook script: forwards a slimmed payload and always exits 0', async () => {
  fs.mkdirSync(path.join(home, 'servers'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'servers', `${office.port}.json`),
    JSON.stringify({ pid: process.pid, host: '127.0.0.1', port: office.port, token: TOKEN, url: base }),
  );
  const run = (input, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(root, 'hook', 'agent-office-hook.js')], {
        env: { ...process.env, AGENT_OFFICE_HOME: home, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(input);
    });

  const payload = {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Run tests', content: 'x'.repeat(50_000) },
    tool_response: { huge: 'y'.repeat(50_000) },
    transcript_path: 'C:\\Users\\me\\.claude\\projects\\x.jsonl',
  };
  const res = await run(JSON.stringify(payload), { AGENT_OFFICE_AGENT: 'devops' });
  assert.equal(res.code, 0);
  assert.equal(res.out, '', 'the hook must print nothing: stdout would reach Claude');
  assert.equal(office.state.agents.devops.status, 'running');
  assert.equal(office.state.agents.devops.activity, 'Running: Run tests');

  assert.equal((await run('not json')).code, 0);
  assert.equal((await run('')).code, 0);
  const none = await run(JSON.stringify(payload), { AGENT_OFFICE_HOME: path.join(home, 'missing') });
  assert.equal(none.code, 0);
});
