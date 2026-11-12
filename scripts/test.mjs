// Runs every test/*.test.js with Node's built-in test runner.
// Listing the files explicitly keeps this working on Node 20, 22 and newer,
// on every shell (no glob expansion needed).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join('test', f));

if (!files.length) {
  console.error('no test files found');
  process.exit(1);
}
const res = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(res.status ?? 1);
