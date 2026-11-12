// Minimal YAML-frontmatter parser for Claude Code style agent files.
// Supports the subset used in practice: `key: value`, quoted strings,
// `[a, b]` lists, `- item` lists and `>` / `|` block scalars. No dependencies.

function unquote(v) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  return s;
}

function splitFlowList(inner) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => unquote(x)).filter((x) => x !== '');
}

function scalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v.startsWith('[') && v.endsWith(']')) return splitFlowList(v.slice(1, -1));
  if (v === 'true') return true;
  if (v === 'false') return false;
  return unquote(v);
}

/**
 * @param {string} text file contents
 * @returns {{ data: Record<string, any>, body: string, hasFrontmatter: boolean }}
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!src.startsWith('---\n')) return { data: {}, body: src, hasFrontmatter: false };
  const end = src.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: src, hasFrontmatter: false };
  const head = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n/, '');

  const data = {};
  const lines = head.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // stray indentation outside a block
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2].trim();

    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-' || rest === '>+' || rest === '|+') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[++i].replace(/^\s{1,}/, ''));
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      data[key] = rest.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n');
      continue;
    }

    if (rest === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[++i].replace(/^\s*-\s+/, '')));
      }
      data[key] = items;
      continue;
    }
    data[key] = scalar(rest);
  }
  return { data, body, hasFrontmatter: true };
}
