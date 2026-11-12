// Canvas renderer: camera (pan/zoom/follow), depth-sorted drawing, labels and
// speech bubbles. The pixel art is drawn in logical coordinates (1 tile = 16px)
// and scaled up; text is drawn afterwards in screen space so it stays crisp.

import { ACTIVE, STATUS } from '../core/model.js';
import { TILE } from '../core/layout.js';
import { drawCharacter } from './character.js';
import { Director } from './director.js';
import { drawClock, drawConfetti, drawEnvelope, drawSparkle, drawStatic, drawZ, furnitureLayers } from './draw.js';
import { STATUS_COLOR } from './palette.js';

const FONT = '600 12px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class OfficeRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ getAgent:(id:string)=>any, onPick:(id:string|null)=>void, onHover:(id:string|null)=>void, getSettings:()=>any }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.hooks = hooks;
    this.zoom = 2;
    this.cx = 0;
    this.cy = 0;
    this.minZoom = 0.5;
    this.maxZoom = 8;
    this.selectedId = null;
    this.hoverId = null;
    this.followId = null;
    this.spotlight = null;
    this.userMoved = false;
    this.staticKey = '';
    this.staticCanvas = document.createElement('canvas');
    this.world = null;
    this.layout = null;
    this.roster = null;
    this.deptColor = new Map();
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    /** Pixels at the bottom kept free for overlay panels (activity log). */
    this.reserveBottom = 0;
    this.director = new Director(this, {
      statusOf: (id) => this.hooks.getAgent(id)?.status || STATUS.IDLE,
      sinceOf: (id) => this.hooks.getAgent(id)?.since || 0,
    });
    this._lastFrame = 0;
    this._attach();
  }

  get cinema() {
    return this.director.on;
  }

  /** Director's cut: the camera films the busiest agent, the meeting, or the whole office. */
  setCinema(on) {
    if (on === this.director.on) return;
    if (on) {
      this.director.start();
      this.userMoved = false;
    } else this.director.stop();
    this.hooks.onCinema?.(on);
  }

  setWorld(world, layout, roster, { keepView = false } = {}) {
    this.world = world;
    this.layout = layout;
    this.roster = roster;
    this.deptColor = new Map(roster.departments.map((d) => [d.id, d.color]));
    this.agentColor = new Map(roster.agents.map((a) => [a.id, this.deptColor.get(a.department) || '#6c8cff']));
    this.agentTier = new Map(roster.agents.map((a) => [a.id, a.tier || 'doer']));
    this.staticKey = '';
    this.staticCanvas.width = layout.pxW;
    this.staticCanvas.height = layout.pxH;
    if (!keepView) this.fit();
  }

  // --- camera ---------------------------------------------------------------
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = Math.max(1, Math.round(r.width));
    this.cssH = Math.max(1, Math.round(r.height));
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  fitZoom(pad = 18) {
    if (!this.layout) return 2;
    return Math.min((this.cssW - pad * 2) / this.layout.pxW, (this.cssH - pad * 2 - this.reserveBottom) / this.layout.pxH);
  }

  fit() {
    if (!this.layout) return;
    this.setCinema(false);
    this.resize();
    const z = this.fitZoom();
    this.minZoom = Math.max(0.2, z * 0.6);
    this.zoom = clamp(z, this.minZoom, this.maxZoom);
    this.cx = this.layout.pxW / 2;
    this.cy = this.layout.pxH / 2 + this.reserveBottom / 2 / this.zoom;
    // Tall phone screens: fitting the whole (wide) office would make it tiny, so
    // start closer on the first department and let the user pan or pinch.
    if (this.cssW < 700 && this.cssH > this.cssW * 1.1) {
      this.zoom = clamp(Math.max(z, 1.6), this.minZoom, this.maxZoom);
      const first = this.layout.zones[0];
      if (first) {
        this.cx = Math.max(this.cssW / 2 / this.zoom, (first.x + first.w / 2) * TILE);
        this.cy = (first.y + first.h / 2) * TILE;
      }
    }
    this.followId = null;
    this.userMoved = false;
  }

  zoomBy(factor, sx = this.cssW / 2, sy = this.cssH / 2) {
    const before = this.toLogical(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.toLogical(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.userMoved = true;
  }

  follow(id) {
    this.followId = id;
    if (id) {
      this.setCinema(false);
      const ch = this.world?.get(id);
      if (ch) {
        this.zoom = clamp(Math.max(this.zoom, this.fitZoom() * 2.2, 2.6), this.minZoom, this.maxZoom);
      }
    }
  }

  focusOn(id) {
    const ch = this.world?.get(id);
    if (!ch) return;
    this.zoom = clamp(Math.max(this.zoom, this.fitZoom() * 1.8, 2.4), this.minZoom, this.maxZoom);
    this.cx = ch.x;
    this.cy = ch.y - 10;
    this.userMoved = true;
  }

  /** Keep the office on screen: no panning far into the empty background. */
  _clampView() {
    if (!this.layout) return;
    const margin = 40 / this.zoom;
    const axis = (c, size, view, shift) => {
      const half = view / 2 / this.zoom;
      if (size <= view / this.zoom - 2 * margin) return size / 2 + shift; // it all fits: center it
      return clamp(c, half - margin, size - half + margin);
    };
    this.cx = axis(this.cx, this.layout.pxW, this.cssW, 0);
    this.cy = axis(this.cy, this.layout.pxH, this.cssH, this.reserveBottom / 2 / this.zoom);
  }

  toLogical(sx, sy) {
    return { x: (sx - this.cssW / 2) / this.zoom + this.cx, y: (sy - this.cssH / 2) / this.zoom + this.cy };
  }
  toScreen(lx, ly) {
    return { x: (lx - this.cx) * this.zoom + this.cssW / 2, y: (ly - this.cy) * this.zoom + this.cssH / 2 };
  }

  pick(sx, sy) {
    if (!this.world) return null;
    const p = this.toLogical(sx, sy);
    let best = null;
    let bestY = -Infinity;
    for (const ch of this.world.chars.values()) {
      const sink = ch.mode === 'seated' ? 7 : ch.mode === 'spot' ? ch.spot?.sink || 0 : 0;
      const top = ch.y + sink - 26;
      if (p.x >= ch.x - 8 && p.x <= ch.x + 8 && p.y >= top - 2 && p.y <= Math.min(ch.y + sink, ch.y + 2) + 1) {
        if (ch.y > bestY) {
          best = ch.id;
          bestY = ch.y;
        }
      }
    }
    return best;
  }

  _attach() {
    const c = this.canvas;
    const pointers = new Map();
    let drag = null;
    let pinch = null;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.followId = null;
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
        drag = null;
      }
    });

    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        this.followId = null;
        this.zoomBy((pinch.zoom * d) / pinch.d / this.zoom, mid.x, mid.y);
        return;
      }
      if (drag && pointers.size === 1) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          this.followId = null;
          this.cx = drag.cx - dx / this.zoom;
          this.cy = drag.cy - dy / this.zoom;
          this.userMoved = true;
          c.style.cursor = 'grabbing';
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const id = this.pick(e.clientX - r.left, e.clientY - r.top);
        if (id !== this.hoverId) {
          this.hoverId = id;
          c.style.cursor = id ? 'pointer' : 'grab';
          this.hooks.onHover?.(id, e);
        } else if (id) this.hooks.onHover?.(id, e);
      }
    });

    const end = (e) => {
      const r = c.getBoundingClientRect();
      const was = drag;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        drag = null;
        c.style.cursor = this.hoverId ? 'pointer' : 'grab';
        if (was && !was.moved && e.type === 'pointerup') this.hooks.onPick?.(this.pick(e.clientX - r.left, e.clientY - r.top), e);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (this.hoverId) {
        this.hoverId = null;
        this.hooks.onHover?.(null);
      }
    });
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const id = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (id) {
        this.hooks.onPick?.(id, e);
        this.follow(id);
      } else this.fit();
    });
    c.style.cursor = 'grab';
  }

  // --- drawing --------------------------------------------------------------
  _isNight(settings, date) {
    if (settings.lighting === 'night') return true;
    if (settings.lighting === 'day') return false;
    const h = date.getHours();
    return h >= 19 || h < 7;
  }

  render(now) {
    if (!this.world || !this.layout) return;
    this.resize();
    const { ctx, layout, world } = this;
    const settings = this.hooks.getSettings();
    const date = new Date();
    const look = settings.look || 'classic';
    const night = look === 'neon' || this._isNight(settings, date);
    const t = now / 1000;
    const dt = this._lastFrame ? Math.min(0.1, (now - this._lastFrame) / 1000) : 0.016;
    this._lastFrame = now;

    if (this.director.on) {
      if (this.userMoved) this.setCinema(false); // the user grabbed the camera
      else this.director.step(now, dt);
    }
    if (this.followId) {
      const ch = world.get(this.followId);
      if (ch) {
        this.cx += (ch.x - this.cx) * 0.12;
        this.cy += (ch.y - 8 - this.cy) * 0.12;
      }
    }
    this._clampView();

    const key = `${night}`;
    if (this.staticKey !== key) {
      const sctx = this.staticCanvas.getContext('2d');
      sctx.clearRect(0, 0, layout.pxW, layout.pxH);
      drawStatic(sctx, layout, { night });
      this.staticKey = key;
    }

    const dpr = this.dpr;
    const z = this.zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(z, 0, 0, z, this.canvas.width / 2 - this.cx * z, this.canvas.height / 2 - this.cy * z);

    // soft drop shadow, then the static layer
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(3, 5, layout.pxW, layout.pxH);
    ctx.drawImage(this.staticCanvas, 0, 0);
    const meeting = this.hooks.getMeeting?.() || null;
    if (meeting && layout.meeting) this._drawMeetingFloor(meeting, now, settings);
    drawClock(ctx, layout, date);

    let activeCount = 0;
    let delegating = 0;
    for (const a of this.roster.agents) {
      const st = this.hooks.getAgent(a.id)?.status;
      if (ACTIVE.has(st)) activeCount++;
      if (st === STATUS.DELEGATING) delegating++;
    }
    const env = {
      t,
      night,
      glows: [],
      activeCount,
      delegating,
      statusOf: (id) => this.hooks.getAgent(id)?.status || STATUS.IDLE,
      meeting: meeting ? { progress: clamp((now - meeting.startedAt) / (meeting.endsAt - meeting.startedAt), 0, 1), gathering: world.gathering() } : null,
      colorOfAgent: (id) => this.agentColor.get(id) || '#6c8cff',
    };

    const items = [];
    for (const f of layout.furniture) for (const l of furnitureLayers(f, env)) items.push(l);
    for (const ch of world.chars.values()) {
      const agent = this.hooks.getAgent(ch.id);
      const pose = world.pose(ch, agent?.status || STATUS.IDLE, now, agent?.since || 0);
      items.push({
        z: ch.y + (ch.mode === 'walking' ? 0 : 0.01),
        draw: (c) => {
          drawCharacter(c, ch.look, pose);
          if (!settings.reduceMotion && agent?.status === STATUS.SLEEPING && ch.mode === 'seated') {
            for (let i = 0; i < 3; i++) drawZ(c, ch.x + 6, ch.y - 14, t, i);
          }
        },
      });
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) it.draw(ctx);

    // effects on top
    for (const e of world.effects) {
      const age = (now - e.at) / e.life;
      if (e.kind === 'sparkle') drawSparkle(ctx, e.x, e.y, age, e.color);
      else if (e.kind === 'packet') {
        const a = world.get(e.from);
        const b = world.get(e.to);
        if (a && b) {
          const p = age < 0.5 ? 2 * age * age : 1 - 2 * (1 - age) * (1 - age);
          const x = a.x + (b.x - a.x) * p;
          const y = a.y - 20 + (b.y - a.y) * p - Math.sin(p * Math.PI) * 18;
          drawEnvelope(ctx, Math.round(x), Math.round(y));
          if (age > 0.93) drawSparkle(ctx, b.x, b.y - 22, (age - 0.93) * 10, '#ffd2a6');
        }
      }
    }

    // night: darken, then let screens glow
    if (night) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = look === 'neon' ? '#4b4aa6' : look === 'cozy' ? '#a8805f' : '#6a74b2';
      ctx.fillRect(0, 0, layout.pxW, layout.pxH);
      ctx.globalCompositeOperation = 'lighter';
      const boost = look === 'neon' ? 1.9 : 1;
      for (const g of env.glows) {
        const col = g.status === 'tv' ? '#4a63d6' : STATUS_COLOR[g.status] || '#4a5890';
        const idle = g.status === 'idle' || g.status === 'sleeping';
        ctx.globalAlpha = Math.min(0.7, (idle ? 0.1 : 0.32) * boost);
        ctx.fillStyle = col;
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.globalAlpha = Math.min(0.2, 0.07 * boost * (idle ? 1 : 1.6));
        ctx.fillRect(g.x - 6, g.y - 4, g.w + 12, g.h + 12);
        if (look === 'neon' && !idle) {
          ctx.globalAlpha = 0.1;
          ctx.fillRect(g.x - 14, g.y - 10, g.w + 28, g.h + 28);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else if (look === 'cozy') {
      // warm late-afternoon light
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ffd3a2';
      ctx.fillRect(0, 0, layout.pxW, layout.pxH);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (night && meeting && layout.meeting) {
      // the meeting room lamp stays on at night
      const r = layout.meeting.room;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffcf7a';
      ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // confetti is drawn after the night tint so it stays bright
    for (const e of world.effects) if (e.kind === 'confetti') drawConfetti(ctx, e.x, e.y, (now - e.at) / e.life, e.life / 1000);

    this._drawOverlay(now, settings);
    this._drawFilm(now, settings, look);
  }

  /** Screen-space finish: vignette for the looks and letterbox bars while the director films. */
  _drawFilm(now, settings, look) {
    const { ctx } = this;
    const dpr = this.dpr;
    const w = this.cssW;
    const h = this.cssH;
    const cine = this.director.on;
    const strength = cine ? 0.5 : look === 'neon' ? 0.42 : look === 'cozy' ? 0.3 : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (strength > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, look === 'cozy' ? `rgba(60,24,0,${strength})` : `rgba(4,4,24,${strength})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (cine) {
      const bar = Math.round(h * 0.055);
      ctx.fillStyle = 'rgba(2,3,14,0.92)';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
      const blink = settings.reduceMotion || Math.floor(now / 700) % 2 === 0;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
      if (blink) {
        ctx.fillStyle = '#ff4d6d';
        ctx.beginPath();
        ctx.arc(16, bar / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const shot = this.director.shot;
      const name = shot?.kind === 'agent' ? this.roster.agents.find((a) => a.id === shot.id)?.name : null;
      const label = shot?.kind === 'meeting' ? this.hooks.t?.('cine.meeting') : name ? name : this.hooks.t?.('cine.overview');
      ctx.fillText(`${this.hooks.t?.('cine.title') || 'DIRECTOR'} · ${String(label || '').toUpperCase()}`, 28, bar / 2 + 1);
    }
  }

  /** Warm spotlight and a moving dashed border on the meeting room floor. */
  _drawMeetingFloor(meeting, now, settings) {
    const { ctx } = this;
    const r = this.layout.meeting.room;
    const x = r.x * TILE + 2;
    const y = r.y * TILE + 2;
    const w = r.w * TILE - 4;
    const h = r.h * TILE - 4;
    const still = settings.reduceMotion;
    const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);
    ctx.fillStyle = `rgba(255, 214, 120, ${0.1 + 0.06 * pulse})`;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 160, 60, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = still ? 0 : -((now / 60) % 7);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  _drawOverlay(now, settings) {
    const { ctx, world, layout } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const u = clamp(this.zoom / 2.2, 0.8, 1.5);

    // zone names on their header bands
    if (this.zoom >= 0.7) {
      for (const zn of layout.zones) {
        const c = this.toScreen((zn.x + zn.w / 2) * TILE, zn.y * TILE + 9);
        const maxW = (zn.w * TILE - 12) * this.zoom;
        const size = clamp(this.zoom * 6.2, 8, 14);
        ctx.font = `700 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
        let label = zn.name.toUpperCase();
        while (label.length > 3 && ctx.measureText(label).width > maxW) label = label.slice(0, -2) + '…';
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(label, c.x, c.y);
      }
    }

    const meeting = this.hooks.getMeeting?.() || null;
    const speaker = meeting ? world.speakerAt(now) : null;
    if (meeting && layout.meeting && this.zoom >= 0.5) this._drawMeetingBanner(meeting, now, u);

    const sorted = [...world.chars.values()].sort((a, b) => a.y - b.y);
    for (const ch of sorted) {
      const agent = this.hooks.getAgent(ch.id);
      if (!agent) continue;
      const sink = ch.mode === 'seated' ? 7 : ch.mode === 'spot' ? ch.spot?.sink || 0 : 0;
      const head = this.toScreen(ch.x, ch.y + sink - 26);
      const feet = this.toScreen(ch.x, ch.y + sink);
      const selected = ch.id === this.selectedId;
      const hover = ch.id === this.hoverId;

      const lit = Boolean(this.spotlight?.has(ch.id)); // the crew of the task under the mouse
      if (selected || hover || lit) {
        ctx.strokeStyle = selected ? '#ffffff' : hover ? 'rgba(255,255,255,0.65)' : '#ffd166';
        ctx.lineWidth = 2 * u;
        if (sink > 0) {
          // seated: outline the visible part of the character
          const bottom = this.toScreen(ch.x, ch.y).y;
          const left = this.toScreen(ch.x - 10, 0).x;
          const right = this.toScreen(ch.x + 10, 0).x;
          roundRect(ctx, left, head.y - 2 * u, right - left, bottom - head.y + 3 * u, 6 * u);
        } else {
          ctx.beginPath();
          ctx.ellipse(feet.x, this.toScreen(ch.x, ch.y).y + 1, 11 * this.zoom, 4 * this.zoom, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
      }

      // bubble
      const bubble = ch.id === speaker && ch.meeting ? this._speechBubble(ch.id, now) : this._bubbleFor(agent, now);
      let top = head.y - 4 * u;
      if (bubble && settings.bubbles !== false) {
        this._drawBubble(bubble, head.x, top, u, now);
        top -= 26 * u;
      }

      // name tag
      // Declutter: at low zoom only busy agents get a tag; everyone does when zoomed in.
      const busy = agent.status !== STATUS.IDLE && agent.status !== STATUS.SLEEPING;
      const showName =
        settings.names === 'always'
          ? this.zoom >= 2.3 || (busy && this.zoom >= 1.1) || selected || hover
          : settings.names === 'hover'
            ? selected || hover
            : selected;
      // around the meeting table only the speaker wears a tag (the seats are too close)
      const crowded = ch.meeting && ch.mode === 'spot' && ch.id !== speaker && !selected && !hover;
      if (showName && !crowded) {
        const size = clamp(10.5 * u, 9, 14);
        ctx.font = `600 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
        const tier = this.agentTier.get(ch.id);
        const mark = tier === 'chief' ? '★ ' : tier === 'manager' ? '◆ ' : '';
        const name = mark + ch.name;
        const tw = ctx.measureText(name).width;
        const pad = 5 * u;
        const w = tw + pad * 2 + 8 * u;
        const h = size + 6 * u;
        const x = head.x - w / 2;
        const y = top - h - (bubble ? 0 : 2 * u);
        ctx.fillStyle = 'rgba(14,17,32,0.82)';
        roundRect(ctx, x, y, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = STATUS_COLOR[agent.status] || '#8b93a7';
        ctx.beginPath();
        ctx.arc(x + pad + 2 * u, y + h / 2, 2.6 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f4f6ff';
        ctx.textAlign = 'left';
        ctx.fillText(name, x + pad + 7 * u, y + h / 2 + 0.5);
        ctx.textAlign = 'center';

        if ((selected || hover) && agent.activity && agent.status !== STATUS.IDLE) {
          const a = agent.activity.length > 38 ? agent.activity.slice(0, 37) + '…' : agent.activity;
          ctx.font = `500 ${clamp(9.5 * u, 8.5, 12)}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
          const aw = ctx.measureText(a).width + 10 * u;
          ctx.fillStyle = 'rgba(14,17,32,0.7)';
          roundRect(ctx, head.x - aw / 2, y - 14 * u, aw, 12 * u, 6 * u);
          ctx.fill();
          ctx.fillStyle = '#c9d0ee';
          ctx.fillText(a, head.x, y - 8 * u + 0.5);
        }
      }
    }
  }

  _speechBubble(id, now) {
    const IDEAS = ['💡', '📌', '📊', '✍️', '👍', '🎯', '🗂️', '⏱️'];
    const slot = Math.floor(now / 2200);
    return { glyph: IDEAS[(slot + id.length) % IDEAS.length], color: '#ffffff', text: '#1d2238', outline: '#f0a03c', emoji: true };
  }

  _drawMeetingBanner(meeting, now, u) {
    const { ctx, world } = this;
    const r = this.layout.meeting.room;
    const c = this.toScreen((r.x + r.w / 2) * TILE, r.y * TILE - 4);
    const t = this.hooks.t || ((k) => k);
    const total = meeting.agents.length + 1;
    const seated = [...world.seating.keys()].filter((id) => world.get(id)?.mode === 'spot').length;
    const head = world.gathering() ? `${t('meeting.title')} · ${t('meeting.gathering')} ${seated}/${total}` : `${t('meeting.title')} · ${total} ${t('meeting.people')}`;
    const topic = meeting.topic ? (meeting.topic.length > 40 ? meeting.topic.slice(0, 39) + '…' : meeting.topic) : '';
    const size = clamp(10.5 * u, 9, 14);
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    const w1 = ctx.measureText('📋 ' + head).width;
    ctx.font = `500 ${size * 0.92}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    const w2 = topic ? ctx.measureText(topic).width : 0;
    const w = Math.max(w1, w2) + 24 * u;
    const h = (topic ? 2 : 1) * (size + 4 * u) + 12 * u;
    const x = c.x - w / 2;
    const y = c.y - h - 6 * u;
    ctx.fillStyle = 'rgba(26, 20, 10, 0.88)';
    roundRect(ctx, x, y, w, h, 9 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 160, 60, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `700 ${size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = '#ffd99a';
    ctx.fillText('📋 ' + head, c.x, y + 6 * u + size / 2 + 1);
    if (topic) {
      ctx.font = `500 ${size * 0.92}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
      ctx.fillStyle = '#f4ead8';
      ctx.fillText(topic, c.x, y + 6 * u + size * 1.5 + 5 * u);
    }
    // time left
    const p = clamp((now - meeting.startedAt) / (meeting.endsAt - meeting.startedAt), 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + 8 * u, y + h - 6 * u, w - 16 * u, 2.5 * u);
    ctx.fillStyle = '#f0a03c';
    ctx.fillRect(x + 8 * u, y + h - 6 * u, (w - 16 * u) * (1 - p), 2.5 * u);
  }

  _bubbleFor(agent, now) {
    switch (agent.status) {
      case STATUS.WAITING:
        return { glyph: '?', color: STATUS_COLOR.waiting, text: '#2a2208', bounce: true };
      case STATUS.PERMISSION:
        return { glyph: '!', color: STATUS_COLOR.permission, text: '#ffffff', bounce: true, ring: true };
      case STATUS.ERROR:
        return { glyph: '✕', color: STATUS_COLOR.error, text: '#ffffff' };
      case STATUS.DONE: {
        const age = now - agent.since;
        if (age > 3600) return null;
        return { glyph: '✓', color: STATUS_COLOR.done, text: '#06200f', fade: age > 2800 ? 1 - (age - 2800) / 800 : 1 };
      }
      case STATUS.THINKING:
        return { dots: true, color: '#ffffff', text: '#3a2d78', outline: STATUS_COLOR.thinking };
      case STATUS.DELEGATING:
        return { glyph: '➜', color: STATUS_COLOR.delegating, text: '#2a1304' };
      default:
        return null;
    }
  }

  _drawBubble(b, x, y, u, now) {
    const { ctx } = this;
    const bounce = b.bounce && !this.hooks.getSettings().reduceMotion ? Math.sin(now / 180) * 2 * u : 0;
    const w = 22 * u;
    const h = 18 * u;
    const bx = x - w / 2;
    const by = y - h - 5 * u + bounce;
    if (b.fade !== undefined) ctx.globalAlpha = Math.max(0, b.fade);
    if (b.ring && !this.hooks.getSettings().reduceMotion) {
      const p = (now / 900) % 1;
      ctx.strokeStyle = `rgba(255,93,143,${0.55 * (1 - p)})`;
      ctx.lineWidth = 2;
      roundRect(ctx, bx - p * 8 * u, by - p * 8 * u, w + p * 16 * u, h + p * 16 * u, 9 * u + p * 8 * u);
      ctx.stroke();
    }
    ctx.fillStyle = b.color;
    roundRect(ctx, bx, by, w, h, 7 * u);
    ctx.fill();
    if (b.outline) {
      ctx.strokeStyle = b.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 4 * u, by + h - 0.5);
    ctx.lineTo(x + 4 * u, by + h - 0.5);
    ctx.lineTo(x, by + h + 4.5 * u);
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.fill();
    if (b.dots) {
      const n = Math.floor(now / 260) % 3;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = b.text;
        ctx.globalAlpha = (b.fade ?? 1) * (i === n ? 1 : 0.4);
        ctx.beginPath();
        ctx.arc(x + (i - 1) * 5 * u, by + h / 2, 1.9 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = b.text;
      ctx.font = `800 ${12 * u}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
      ctx.fillText(b.glyph, x, by + h / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
