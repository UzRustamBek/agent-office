// Running servers advertise themselves in ~/.agent-office/servers/<port>.json
// so the hook script can find them (and the token) without any configuration.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function homeDir() {
  return process.env.AGENT_OFFICE_HOME || path.join(os.homedir(), '.agent-office');
}

export function serversDir() {
  return path.join(homeDir(), 'servers');
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Advertise a running server. Returns a function that removes the entry. */
export function register({ port, host, token }) {
  const dir = serversDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${port}.json`);
  const entry = { pid: process.pid, host, port, token, url: `http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}`, startedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(entry), { mode: 0o600 });
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (current.pid === process.pid) fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  };
}

/** All live server entries (stale files of dead processes are skipped). */
export function liveServers() {
  const dir = serversDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (entry && typeof entry.url === 'string' && typeof entry.token === 'string' && isAlive(entry.pid)) out.push(entry);
    } catch {
      /* ignore broken entry */
    }
  }
  return out;
}
