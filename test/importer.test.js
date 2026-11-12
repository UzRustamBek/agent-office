import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseFrontmatter } from '../server/frontmatter.js';
import { importAgents } from '../server/importer.js';
import { parseArgs } from '../server/cli.js';

test('frontmatter: scalars, quotes, lists, block scalars', () => {
  const { data, body, hasFrontmatter } = parseFrontmatter(
    [
      '---',
      'name: code-reviewer',
      'description: "Reviews code: finds bugs. Use proactively."',
      "model: 'sonnet'",
      'tools: Read, Grep, Glob',
      'skills: [one, "two, three"]',
      'color: blue',
      'long: >',
      '  folded text',
      '  continues here',
      'items:',
      '  - first',
      '  - second',
      'flag: true',
      '---',
      '# Body',
    ].join('\r\n'),
  );
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'code-reviewer');
  assert.equal(data.description, 'Reviews code: finds bugs. Use proactively.');
  assert.equal(data.model, 'sonnet');
  assert.equal(data.tools, 'Read, Grep, Glob');
  assert.deepEqual(data.skills, ['one', 'two, three']);
  assert.equal(data.long, 'folded text continues here');
  assert.deepEqual(data.items, ['first', 'second']);
  assert.equal(data.flag, true);
  assert.equal(body.trim(), '# Body');
});

test('frontmatter: files without frontmatter are reported, not crashed on', () => {
  assert.equal(parseFrontmatter('# Just markdown').hasFrontmatter, false);
  assert.equal(parseFrontmatter('---\nname: x\n').hasFrontmatter, false);
  assert.equal(parseFrontmatter('').hasFrontmatter, false);
});

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-agents-'));
  const write = (rel, text) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('rahbariyat/direktor.md', '---\nname: direktor\ndescription: Asosiy agent. Vazifani bo\'limlarga taqsimlaydi.\nmodel: opus\ncolor: purple\n---\nSECRET SYSTEM PROMPT');
  write('it/backend.md', '---\nname: backend\ndescription: API va bazalar bilan ishlaydi. Kod yozadi.\ntools: Read, Edit, Bash\n---\nbody');
  write('it/frontend.md', '---\nname: frontend\ndescription: Interfeys\n---\nbody');
  write('top-level.md', '---\nname: solo\ndescription: Alone.\n---\n');
  write('notes.md', '# not an agent');
  write('broken.md', '---\ndescription: no name\n---\n');
  return dir;
}

test('importer: folders become departments, metadata only', () => {
  const dir = makeTree();
  const { roster, files, skipped } = importAgents([dir], { defaultDepartment: 'general' });
  assert.equal(roster.agents.length, 4);
  assert.deepEqual(roster.departments.map((d) => d.id).sort(), ['general', 'it', 'rahbariyat']);
  assert.equal(roster.office.mainAgent, 'direktor');
  const be = roster.agents.find((a) => a.id === 'backend');
  assert.equal(be.department, 'it');
  assert.deepEqual(be.tools, ['Read', 'Edit', 'Bash']);
  assert.equal(be.role, 'API va bazalar bilan ishlaydi');
  assert.equal(files.length, 4);
  assert.equal(skipped.length, 2);
  assert.ok(!JSON.stringify(roster).includes('SECRET SYSTEM PROMPT'), 'prompt bodies are never imported');
  assert.equal(roster.agents.find((a) => a.id === 'direktor').look.shirt, '#c07cf0', 'frontmatter color becomes the shirt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('importer: later folders override earlier ones; missing folders are ignored', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-b-'));
  fs.writeFileSync(path.join(a, 'x.md'), '---\nname: helper\ndescription: User level.\n---\n');
  fs.writeFileSync(path.join(b, 'x.md'), '---\nname: helper\ndescription: Project level.\n---\n');
  const { roster, scanned } = importAgents([a, path.join(a, 'missing'), b]);
  assert.equal(scanned.length, 2);
  assert.equal(roster.agents.length, 1);
  assert.equal(roster.agents[0].description, 'Project level.');
  fs.rmSync(a, { recursive: true, force: true });
  fs.rmSync(b, { recursive: true, force: true });
});

test('importer: symlinks are never followed', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-s-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-o-'));
  fs.writeFileSync(path.join(outside, 'x.md'), '---\nname: leaked\ndescription: x\n---\n');
  fs.symlinkSync(outside, path.join(dir, 'link'));
  fs.writeFileSync(path.join(dir, 'ok.md'), '---\nname: ok\ndescription: ok\n---\n');
  const { roster } = importAgents([dir]);
  assert.deepEqual(roster.agents.map((a) => a.id), ['ok']);
});

test('cli: parseArgs handles flags, values, booleans and positionals', () => {
  const { flags, positional } = parseArgs(['dir1', '--out', 'a.json', '--dry-run', '--port=99', 'dir2'], ['dry-run']);
  assert.deepEqual(positional, ['dir1', 'dir2']);
  assert.equal(flags.out, 'a.json');
  assert.equal(flags['dry-run'], true);
  assert.equal(flags.port, '99');
  assert.equal(parseArgs(['--demo']).flags.demo, true);
});
