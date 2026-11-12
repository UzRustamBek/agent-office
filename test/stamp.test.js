import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stampHtml, stampJs } from '../scripts/stamp-version.mjs';

test('stamp: relative imports get ?v=, packages and URLs do not', () => {
  // built from pieces so the repository import checker does not read them as real imports
  const q = "'";
  const imp = (head, spec, quote = q) => `${head}${quote}${spec}${quote};`;
  const src = [
    imp('import { a } from ', './a.js'),
    imp('export { b } from ', '../b.js', '"'),
    imp('import ', './side.js'),
    `const m = await import(${q}./lazy.js${q});`,
    imp('import fs from ', 'node:fs'),
    imp('import x from ', './already.js?v=1'),
  ].join(String.fromCharCode(10));
  const out = stampJs(src, 'abc');
  assert.match(out, /'\.\/a\.js\?v=abc'/);
  assert.match(out, /"\.\.\/b\.js\?v=abc"/);
  assert.match(out, /'\.\/side\.js\?v=abc'/);
  assert.match(out, /'\.\/lazy\.js\?v=abc'/);
  assert.match(out, /'node:fs'/);
  assert.match(out, /'\.\/already\.js\?v=1'/);
});

test('stamp: local css and module script in HTML, not external or images', () => {
  const html = '<link rel="stylesheet" href="css/styles.css" /><link rel="icon" href="favicon.svg" /><script type="module" src="js/main.js"></script><script src="https://x.org/a.js"></script>';
  const out = stampHtml(html, 'abc');
  assert.match(out, /css\/styles\.css\?v=abc/);
  assert.match(out, /js\/main\.js\?v=abc/);
  assert.match(out, /favicon\.svg"/);
  assert.match(out, /https:\/\/x\.org\/a\.js"/);
});
