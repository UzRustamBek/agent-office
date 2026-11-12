// Cache-busting for the static demo.
//
// Browsers keep ES modules in their HTTP cache (GitHub Pages sends
// `Cache-Control: max-age=600`) and do not always revalidate them, so a
// returning visitor could run an old mix of modules after a deploy. This script
// rewrites a copy of the site so that every local stylesheet, script and
// relative `import` carries `?v=<version>`: each deploy gets brand new URLs.
//
//   node scripts/stamp-version.mjs <site-dir> <version>
//
// It only touches the copy in <site-dir>; the sources in web/ stay clean.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORT_RE = /((?:import|export)\s[^'"]*?from\s*|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;

/** Append ?v= to every relative import specifier of a JS module. */
export function stampJs(text, version) {
  return text.replace(IMPORT_RE, (m, head, q, spec) => `${head}${q}${spec}?v=${version}${q}`);
}

/** Append ?v= to local stylesheet and module script URLs of an HTML page. */
export function stampHtml(text, version) {
  return text.replace(/(<(?:link|script)\b[^>]*?\s(?:href|src)=")(?!https?:|\/\/|data:)([^"?#]+\.(?:css|js))(")/g, (m, a, url, b) => `${a}${url}?v=${version}${b}`);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function stampSite(dir, version) {
  if (!/^[\w.-]{1,40}$/.test(version)) throw new Error(`bad version "${version}"`);
  let files = 0;
  for (const f of walk(dir)) {
    const ext = path.extname(f);
    if (ext !== '.js' && ext !== '.html') continue;
    const before = fs.readFileSync(f, 'utf8');
    const after = ext === '.js' ? stampJs(before, version) : stampHtml(before, version);
    if (after !== before) {
      fs.writeFileSync(f, after);
      files++;
    }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, version] = process.argv.slice(2);
  if (!dir || !version) {
    console.error('usage: node scripts/stamp-version.mjs <site-dir> <version>');
    process.exit(2);
  }
  const n = stampSite(path.resolve(dir), version);
  console.log(`stamped ${n} files with ?v=${version}`);
}
