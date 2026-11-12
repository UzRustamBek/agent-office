// Repository sanity checks that run without any dependencies:
//  1. every JavaScript file parses (node --check)
//  2. every relative import in the browser code resolves to a real file
//  3. the web page respects its Content-Security-Policy (no inline code, no external resources)
//  4. the example roster is valid
//  5. relative links in the Markdown docs point at existing files
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const all = walk(root);

// 1. syntax --------------------------------------------------------------------
const js = all.filter((f) => /\.(m?js)$/.test(f));
for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntax error in ${rel(f)}\n${r.stderr.trim()}`);
}

// 2. imports -------------------------------------------------------------------
const importRe = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of js) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(importRe)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) fail(`${rel(f)} imports "${spec}" which does not exist`);
  }
}

// 3. CSP hygiene of the web page ----------------------------------------------
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) fail('web/index.html has an inline <script>');
if (/<style[\s>]/i.test(html)) fail('web/index.html has an inline <style>');
if (/\sstyle\s*=/i.test(html)) fail('web/index.html has an inline style="" attribute');
if (/\son[a-z]+\s*=/i.test(html)) fail('web/index.html has an inline event handler');
if (/(?:src|href)\s*=\s*["']https?:/i.test(html)) fail('web/index.html loads an external resource');
for (const f of all.filter((x) => rel(x).startsWith('web/') && /\.(css|js)$/.test(x))) {
  const t = fs.readFileSync(f, 'utf8');
  if (/url\(\s*['"]?https?:/i.test(t) || /@import\s+url\(\s*['"]?https?:/i.test(t)) fail(`${rel(f)} references an external URL`);
  if (/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(t)) fail(`${rel(f)} writes HTML strings (use textContent / element builders)`);
}

// 4. example rosters -----------------------------------------------------------
const { normalizeRoster } = await import(pathToFileURL(path.join(root, 'web/js/core/roster.js')).href);
const rosters = ['agents.example.json', ...fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.json')).map((f) => `examples/${f}`)];
for (const file of rosters) {
  try {
    normalizeRoster(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
  } catch (err) {
    fail(`${file} is invalid: ${err.message}`);
  }
}

// 5. markdown links ------------------------------------------------------------
for (const f of all.filter((x) => x.endsWith('.md') && !rel(x).startsWith('node_modules'))) {
  const text = fs.readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
    const target = path.resolve(path.dirname(f), decodeURIComponent(m[1].split('#')[0]));
    if (!fs.existsSync(target)) fail(`${rel(f)} links to "${m[1]}" which does not exist`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n - ${problems.join('\n - ')}\n`);
  process.exit(1);
}
console.log(`ok: ${js.length} JS files, imports, CSP rules, roster and docs links all check out`);
