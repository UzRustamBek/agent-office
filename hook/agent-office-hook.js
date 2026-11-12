#!/usr/bin/env node
// Claude Code hook -> Agent Office.
//
// Reads the hook JSON from stdin and forwards it to every running Agent Office
// server on this machine. It is deliberately tiny, dependency-free and silent:
// it never prints, never blocks Claude Code for more than ~2.5 s (1 s to read
// stdin, 1.5 s per request, servers are contacted in parallel) and always
// exits with code 0, even when no server is running.
//
// Optional environment variables:
//   AGENT_OFFICE_AGENT  pin this terminal/session to one agent of your roster
//   AGENT_OFFICE_URL    explicit server URL (needs AGENT_OFFICE_TOKEN)
//   AGENT_OFFICE_TOKEN  bearer token printed by `agent-office start`
//   AGENT_OFFICE_HOME   registry folder (default ~/.agent-office)
//   AGENT_OFFICE_SHARE_PROMPTS=1  also forward the first 200 characters of your
//                       prompts (the server shows them only with --share-prompts)

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
    let e;
    try {
      e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    if (typeof e?.url !== 'string' || typeof e?.token !== 'string') continue;
    try {
      process.kill(e.pid, 0); // throws ESRCH when the server is gone
      out.push(e);
    } catch (err) {
      if (err?.code === 'EPERM') out.push(e); // alive, but owned by another user
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

// Only forward the few small fields the server needs, already reduced to what
// it shows: a file *name* (never its folder), the program of a shell command
// (never its arguments, which can hold secrets), short descriptions and ids.
// File contents, tool responses, transcript paths and URLs never leave Claude
// Code. The prompt text is sent only when AGENT_OFFICE_SHARE_PROMPTS=1.
const KEEP_TOP = ['hook_event_name', 'session_id', 'agent_type', 'agent_id', 'tool_name', 'message'];
const SHORT_INPUT = { pattern: 60, description: 120, query: 80, subagent_type: 64 };

const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || '';

function slim(payload) {
  const out = {};
  for (const k of KEEP_TOP) if (typeof payload[k] === 'string') out[k] = payload[k].slice(0, 200);
  if (process.env.AGENT_OFFICE_SHARE_PROMPTS === '1' && typeof payload.prompt === 'string') out.prompt = payload.prompt.slice(0, 200);
  const input = payload.tool_input;
  if (input && typeof input === 'object') {
    const t = {};
    for (const k of ['file_path', 'notebook_path', 'path']) if (typeof input[k] === 'string') t[k] = baseName(input[k]).slice(0, 80);
    if (typeof input.command === 'string') t.command = baseName(input.command.trim().split(/\s+/)[0] || '').slice(0, 40);
    for (const [k, n] of Object.entries(SHORT_INPUT)) if (typeof input[k] === 'string') t[k] = input[k].slice(0, n);
    out.tool_input = t;
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
