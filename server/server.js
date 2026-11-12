// Agent Office server: static UI + live event stream. Zero dependencies.
//
//   GET  /                 the office (web/)
//   GET  /api/health       status JSON
//   GET  /api/state        roster + agent states (snapshot)
//   GET  /api/stream       Server-Sent Events: snapshot, evt, roster
//   POST /api/events       normalized events          (Bearer token)
//   POST /api/hook         raw Claude Code hook JSON  (Bearer token)

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyEvent, createState, normalizeEvent, snapshot, tick } from '../web/js/core/model.js';
import { normalizeRoster } from '../web/js/core/roster.js';
import { createSimulator } from '../web/js/sim/demo.js';
import { fromClaudeHook } from './events.js';
import { register } from './registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MAX_BODY = 128 * 1024;
const MAX_CLIENTS = 50;
const MAX_EVENTS_PER_REQUEST = 100;

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function loadRosterFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: invalid JSON (${err.message})`);
  }
  return normalizeRoster(json);
}

/** Pick the roster file: explicit path, then agents.local.json, agents.json, the bundled example. */
export function resolveRosterFile(explicit, cwd = process.cwd()) {
  if (explicit) {
    const p = path.resolve(cwd, explicit);
    if (!fs.existsSync(p)) throw new Error(`Roster file not found: ${p}`);
    return { file: p, source: 'explicit' };
  }
  for (const name of ['agents.local.json', 'agents.json']) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return { file: p, source: name };
  }
  return { file: path.join(ROOT, 'agents.example.json'), source: 'example' };
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {{ roster?: object, rosterFile?: string, host?: string, port?: number,
 *           token?: string, demo?: boolean, demoSpeed?: number, sharePrompts?: boolean,
 *           advertise?: boolean, webRoot?: string, allowHosts?: string[], quiet?: boolean }} options
 */
export function createOfficeServer(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? crypto.randomBytes(24).toString('hex');
  const webRoot = path.resolve(options.webRoot ?? path.join(ROOT, 'web'));
  const loopbackOnly = LOOPBACK.has(host);
  const allowHosts = new Set([...LOOPBACK, ...(options.allowHosts || [])].map((h) => h.toLowerCase()));
  const log = options.quiet ? () => {} : (...a) => console.log(...a);

  let state = createState(options.roster ?? loadRosterFile(options.rosterFile));
  const clients = new Set();
  const started = Date.now();
  let server = null;
  let timers = [];
  let unregister = null;
  let watcher = null;
  let sim = null;
  let boundPort = options.port ?? 4317;

  const ctx = () => ({
    has: (id) => Boolean(state.agents[id]),
    main: state.roster.office.mainAgent,
    sharePrompts: Boolean(options.sharePrompts),
  });

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(event, data) {
    for (const res of clients) {
      try {
        send(res, event, data);
      } catch {
        clients.delete(res);
      }
    }
  }

  /** Validate, apply and broadcast events. Returns how many were accepted. */
  function ingest(list) {
    let accepted = 0;
    for (const raw of list.slice(0, MAX_EVENTS_PER_REQUEST)) {
      const evt = normalizeEvent(raw);
      if (!evt) continue;
      const result = applyEvent(state, evt, Date.now());
      accepted += 1;
      if (result.rosterChanged) broadcast('snapshot', snapshot(state));
      else broadcast('evt', evt);
    }
    return accepted;
  }

  function reloadRoster(roster) {
    const next = createState(roster);
    for (const [id, agent] of Object.entries(state.agents)) if (next.agents[id]) next.agents[id] = agent;
    next.log = state.log;
    next.seq = state.seq;
    next.startedAt = state.startedAt;
    state = next;
    broadcast('snapshot', snapshot(state));
  }

  // --- HTTP ----------------------------------------------------------------
  function hostAllowed(req) {
    if (!loopbackOnly) return true; // explicitly exposed by the user; writes still need the token
    const h = String(req.headers.host || '').toLowerCase();
    const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
    return allowHosts.has(name);
  }

  function json(res, code, body) {
    const data = JSON.stringify(body);
    res.writeHead(code, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store' });
    res.end(data);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let over = false;
      const chunks = [];
      req.on('data', (c) => {
        if (over) return; // keep draining so the 413 response can be delivered
        size += c.length;
        if (size > MAX_BODY) {
          over = true;
          chunks.length = 0;
          reject(Object.assign(new Error('payload too large'), { code: 413 }));
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function authorized(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    return Boolean(m) && safeEqual(m[1].trim(), token);
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(webRoot, '.' + path.posix.normalize('/' + rel));
    if (full !== webRoot && !full.startsWith(webRoot + path.sep)) return json(res, 403, { error: 'forbidden' });
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full).pipe(res);
    });
  }

  async function handle(req, res) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', CSP);
    res.setHeader('cross-origin-resource-policy', 'same-origin');

    if (!hostAllowed(req)) return json(res, 403, { error: 'host not allowed' });

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return json(res, 400, { error: 'bad url' });
    }
    const p = url.pathname;

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/api/health') {
        return json(res, 200, {
          ok: true,
          name: 'agent-office',
          version: VERSION,
          agents: state.roster.agents.length,
          clients: clients.size,
          demo: Boolean(sim),
          uptimeSec: Math.round((Date.now() - started) / 1000),
        });
      }
      if (p === '/api/state') return json(res, 200, snapshot(state));
      if (p === '/api/roster') return json(res, 200, state.roster);
      if (p === '/api/stream') {
        if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: 'too many clients' });
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 2000\n\n');
        send(res, 'snapshot', snapshot(state));
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      return serveStatic(req, res, p);
    }

    if (req.method === 'POST' && (p === '/api/events' || p === '/api/hook')) {
      if (!authorized(req)) return json(res, 401, { error: 'missing or wrong token' });
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
        return json(res, 415, { error: 'content-type must be application/json' });
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        if (err.code === 413) res.setHeader('connection', 'close');
        return json(res, err.code === 413 ? 413 : 400, { error: err.code === 413 ? 'payload too large' : 'invalid JSON' });
      }
      if (!body || typeof body !== 'object') return json(res, 400, { error: 'expected a JSON object' });

      if (p === '/api/events') {
        const list = Array.isArray(body.events) ? body.events : [body];
        return json(res, 202, { accepted: ingest(list) });
      }
      const events = fromClaudeHook(body.payload, { ...ctx(), pinned: typeof body.agent === 'string' ? body.agent : undefined });
      return json(res, 202, { accepted: ingest(events) });
    }

    res.setHeader('allow', 'GET, HEAD, POST');
    return json(res, 405, { error: 'method not allowed' });
  }

  // --- lifecycle -----------------------------------------------------------
  function listen(port) {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        handle(req, res).catch((err) => {
          if (!res.headersSent) json(res, 500, { error: 'internal error' });
          else res.end();
          log('request error:', err.message);
        });
      });
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.off('error', reject);
        resolve(srv);
      });
    });
  }

  async function start() {
    const wanted = options.port ?? 4317;
    let lastErr;
    for (let i = 0; i < (wanted === 0 ? 1 : 20); i++) {
      try {
        server = await listen(wanted === 0 ? 0 : wanted + i);
        break;
      } catch (err) {
        lastErr = err;
        if (err.code !== 'EADDRINUSE') throw err;
      }
    }
    if (!server) throw lastErr;
    boundPort = server.address().port;

    timers.push(setInterval(() => tick(state), 1000));
    timers.push(setInterval(() => {
      for (const res of clients) res.write(': ping\n\n');
    }, 15000));
    for (const t of timers) t.unref?.();

    if (options.demo) {
      sim = createSimulator({ getRoster: () => state.roster, emit: (e) => ingest([e]), seed: options.seed ?? 7, speed: options.demoSpeed ?? 1 });
      const t = setInterval(() => sim.tick(Date.now()), 250);
      t.unref?.();
      timers.push(t);
    }

    if (options.advertise !== false) unregister = register({ port: boundPort, host, token });

    if (options.rosterFile) {
      let debounce = null;
      try {
        watcher = fs.watch(options.rosterFile, () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            try {
              reloadRoster(loadRosterFile(options.rosterFile));
              log('roster reloaded');
            } catch (err) {
              log('roster not reloaded:', err.message);
            }
          }, 300);
        });
        watcher.unref?.();
      } catch {
        /* watching is best effort */
      }
    }

    const shownHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    return { url: `http://${shownHost}:${boundPort}`, port: boundPort, host, token };
  }

  async function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
    sim?.stop();
    watcher?.close();
    unregister?.();
    for (const res of clients) res.end();
    clients.clear();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
    server = null;
  }

  return {
    start,
    stop,
    ingest,
    reloadRoster,
    get state() {
      return state;
    },
    get port() {
      return boundPort;
    },
    token,
  };
}
