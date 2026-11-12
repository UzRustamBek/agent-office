// Command palette (Ctrl+K / Cmd+K): jump to any agent or run a command from the keyboard.
// All text goes in through textContent; the list is rebuilt on every keystroke (a few dozen rows).

import { defaultLook } from '../core/roster.js';
import { drawAvatar, h } from './ui.js';

/** Case-insensitive "all words appear somewhere" match, best matches (earlier hits) first. */
export function rank(items, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const scored = [];
  for (const it of items) {
    const hay = it.haystack;
    let score = 0;
    let ok = true;
    for (const w of words) {
      const i = hay.indexOf(w);
      if (i === -1) {
        ok = false;
        break;
      }
      score += i === 0 ? 0 : hay[i - 1] === ' ' ? 1 : 3 + Math.min(i, 20) / 20;
    }
    if (ok) scored.push([score, it]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

export class Palette {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('palette');
    this.input = this.root.querySelector('input');
    this.list = this.root.querySelector('ul');
    this.index = 0;
    this.items = [];
    this.shown = [];
    this.input.addEventListener('input', () => this._render());
    this.input.addEventListener('keydown', (e) => this._key(e));
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.isOpen ? this.close() : this.open();
      }
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    this.items = this._items();
    this.root.hidden = false;
    this.input.value = '';
    this.input.placeholder = this.app.ui.t('palette.placeholder');
    this.root.querySelector('.palette-hint').textContent = this.app.ui.t('palette.hint');
    this.index = 0;
    this._render();
    this.input.focus();
  }

  close() {
    this.root.hidden = true;
    this.app.renderer.canvas.focus?.({ preventScroll: true });
  }

  _items() {
    const { ui, state } = this.app;
    const t = ui.t;
    const out = [];
    for (const a of state?.roster.agents || []) {
      const dept = ui.deptOf(a);
      out.push({
        kind: 'agent',
        id: a.id,
        label: a.name,
        sub: a.title || dept?.name || '',
        agent: a,
        color: dept?.color,
        haystack: `${a.name} ${a.title || ''} ${dept?.name || ''} ${a.id}`.toLowerCase(),
        run: () => this.app.actions.selectAgent(a.id, { focus: true }),
      });
    }
    const cmd = (key, icon, run) => ({ kind: 'command', label: t(`palette.${key}`), icon, haystack: `${t(`palette.${key}`)} ${key}`.toLowerCase(), run });
    out.push(
      cmd('cinema', '🎬', () => this.app.renderer.setCinema(!this.app.renderer.cinema)),
      cmd('fit', '⤢', () => this.app.renderer.fit()),
      cmd('look', '🎨', () => this.app.actions.nextLook()),
      cmd('theme', '🌗', () => document.getElementById('btn-theme').click()),
      cmd('log', '📜', () => document.getElementById('log-toggle').click()),
      cmd('lang', '🌐', () => this.app.actions.nextLang()),
      cmd('settings', '⚙', () => document.getElementById('btn-settings').click()),
    );
    return out;
  }

  _render() {
    const found = rank(this.items, this.input.value);
    this.shown = found.slice(0, 40);
    this.index = Math.min(this.index, Math.max(0, this.shown.length - 1));
    const t = this.app.ui.t;
    const kids = [];
    let lastKind = null;
    this.shown.forEach((it, i) => {
      if (it.kind !== lastKind) {
        kids.push(h('li', { class: 'palette-group', role: 'presentation', text: t(it.kind === 'agent' ? 'palette.agents' : 'palette.actions') }));
        lastKind = it.kind;
      }
      let lead;
      if (it.kind === 'agent') {
        lead = h('canvas', { class: 'avatar', 'aria-hidden': 'true' });
        drawAvatar(lead, it.agent.look || defaultLook(it.agent.id, it.color), 1.5);
      } else lead = h('span', { class: 'cmd-icon', 'aria-hidden': 'true', text: it.icon });
      const st = it.kind === 'agent' ? this.app.state.agents[it.id]?.status : null;
      kids.push(
        h(
          'li',
          { class: 'palette-item', role: 'option', 'aria-selected': String(i === this.index), dataset: { i: String(i) }, style: it.color ? { '--dept': it.color } : {} },
          lead,
          h('span', { class: 'p-main' }, h('b', { text: it.label }), it.sub ? h('small', { text: it.sub }) : null),
          st && st !== 'idle' ? h('span', { class: 'p-state', text: this.app.ui.statusLabel(st) }) : null,
        ),
      );
    });
    if (!this.shown.length) kids.push(h('li', { class: 'palette-empty', text: t('palette.empty') }));
    this.list.replaceChildren(...kids);
    this.list.onclick = (e) => {
      const li = e.target.closest('.palette-item');
      if (li) this._run(Number(li.dataset.i));
    };
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  _key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.shown.length;
      if (!n) return;
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this._render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._run(this.index);
    }
  }

  _run(i) {
    const it = this.shown[i];
    if (!it) return;
    this.close();
    it.run();
  }
}
