#!/usr/bin/env node
// Claude Code hook -> Agent Office.
//
// Reads the hook JSON from stdin and forwards it to every running Agent Office
// server on this machine. It is deliberately tiny, dependency-free and silent:
// it never prints, never blocks Claude Code for more than ~1.5 s and always
// exits with code 0, even when no server is running.
//
// Optional environment variables:
//   AGENT_OFFICE_AGENT  pin this terminal/session to one agent of your roster
//   AGENT_OFFICE_URL    explicit server URL (needs AGENT_OFFICE_TOKEN)
//   AGENT_OFFICE_TOKEN  bearer token printed by `agent-office start`
//   AGENT_OFFICE_HOME   registry folder (default ~/.agent-office)

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 1500;

function targets() {
  if (process.env.AGENT_OFFICE_URL && process.env.AGENT_OFFICE_TOKEN) {
    return [{ url: process.env.AGENT_OFFICE_URL, token: process.env.AGENT_OFFICE_TOKEN }];
  }
  const dir = path.join(process.env.AGENT_OFFICE_HOME || path.join(os.homedir(), '.agent-office'), 'servers');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      process.kill(e.pid, 0); // throws when the server is gone
      if (typeof e.url === 'string' && typeof e.token === 'string') out.push(e);
    } catch (err) {
      if (err && err.code === 'EPERM') {
        /* process exists but belongs to another user: still try it */
      }
    }
  }
  return out;
}

function post(target, body) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL('/api/hook', target.url);
    } catch {
      return resolve();
    }
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        agent: false,
        timeout: TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${target.token}`,
        },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
        res.on('error', resolve);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve());
    req.end(body);
  });
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const timer = setTimeout(() => resolve(data), 1000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) {
        clearTimeout(timer);
        resolve('');
      }
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
  });
}

// Only forward the few small fields the server needs. File contents, tool
// responses and transcript paths never leave Claude Code.
const KEEP_TOP = ['hook_event_name', 'session_id', 'agent_type', 'agent_id', 'tool_name', 'message'];
const KEEP_INPUT = ['file_path', 'notebook_path', 'path', 'pattern', 'command', 'description', 'query', 'url', 'subagent_type'];

function slim(payload) {
  const out = {};
  for (const k of KEEP_TOP) if (typeof payload[k] === 'string') out[k] = payload[k].slice(0, 300);
  if (typeof payload.prompt === 'string') out.prompt = payload.prompt.slice(0, 400);
  const input = payload.tool_input;
  if (input && typeof input === 'object') {
    out.tool_input = {};
    for (const k of KEEP_INPUT) if (typeof input[k] === 'string') out.tool_input[k] = input[k].slice(0, 300);
  }
  return out;
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  const list = targets();
  if (!list.length) return;
  const body = JSON.stringify({ source: 'claude', agent: process.env.AGENT_OFFICE_AGENT || undefined, payload: slim(payload) });
  await Promise.all(list.map((t) => post(t, body)));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
