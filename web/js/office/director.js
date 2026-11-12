// Director's cut: an automatic camera that follows the story.
//
// It films the kick-off meeting when there is one, otherwise whoever is busy
// right now (rotating between busy agents so nobody is ignored), and pulls
// back to show the whole office when everyone is idle. `pickShot` is a pure
// function (no DOM, no clock) so the choices are unit-tested; `Director` only
// eases the camera towards the chosen shot.

import { ACTIVE, BLOCKED } from '../core/model.js';
import { TILE } from '../core/layout.js';

export const DWELL_MS = 6500; // how long one agent stays on screen while others wait
export const MIN_BUSY_MS = 1200; // ignore flickers: an agent must be busy this long to get the camera

const isBusy = (st) => ACTIVE.has(st) || BLOCKED.has(st);

/**
 * @param {{ agents: {id:string,status:string,since:number,x:number,y:number}[],
 *           meeting: ({room:{x:number,y:number,w:number,h:number}}|null),
 *           prev: ({kind:string,id?:string,at:number}|null),
 *           shown: Record<string,number>, now: number }} input
 * @returns {{ kind:'meeting'|'agent'|'overview', id?:string, x?:number, y?:number, at:number }}
 */
export function pickShot({ agents, meeting, prev, shown = {}, now }) {
  if (meeting?.room) {
    const r = meeting.room;
    return { kind: 'meeting', x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE, w: r.w * TILE, h: r.h * TILE, at: prev?.kind === 'meeting' ? prev.at : now };
  }
  const busy = agents.filter((a) => isBusy(a.status) && now - a.since >= MIN_BUSY_MS);
  const asShot = (a, at) => ({ kind: 'agent', id: a.id, x: a.x, y: a.y, at });
  if (!busy.length) return { kind: 'overview', at: prev?.kind === 'overview' ? prev.at : now };

  // stay on the current agent while it is still busy and the dwell time is not used up (or nobody else is waiting)
  const current = prev?.kind === 'agent' ? busy.find((a) => a.id === prev.id) : null;
  if (current && (busy.length === 1 || now - prev.at < DWELL_MS)) return asShot(current, prev.at);

  // otherwise the busy agent that has been off screen the longest; ties go to the most recent activity
  const next = [...busy].sort((a, b) => (shown[a.id] || 0) - (shown[b.id] || 0) || b.since - a.since)[0];
  return asShot(next, now);
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Director {
  /** @param {import('./renderer.js').OfficeRenderer} renderer */
  constructor(renderer, { statusOf, sinceOf } = {}) {
    this.r = renderer;
    this.statusOf = statusOf;
    this.sinceOf = sinceOf;
    this.shot = null;
    this.shown = Object.create(null);
    this.on = false;
  }

  start() {
    this.on = true;
    this.shot = null;
    this.r.followId = null;
  }

  stop() {
    this.on = false;
    this.shot = null;
  }

  /** Move the camera one step towards the current shot. dt in seconds. */
  step(now, dt) {
    const r = this.r;
    if (!this.on || !r.world || !r.layout) return;
    const agents = [];
    for (const a of r.roster.agents) {
      const ch = r.world.get(a.id);
      if (!ch) continue;
      agents.push({ id: a.id, status: this.statusOf(a.id), since: this.sinceOf(a.id), x: ch.x, y: ch.y });
    }
    const meeting = r.hooks.getMeeting?.() && r.layout.meeting ? r.layout.meeting : null;
    const next = pickShot({ agents, meeting, prev: this.shot, shown: this.shown, now });
    const changed = !this.shot || this.shot.kind !== next.kind || this.shot.id !== next.id;
    if (next.kind === 'agent' && changed) this.shown[next.id] = now;
    this.shot = next;
    if (changed) r.hooks.onShot?.(next);

    const fit = r.fitZoom();
    let tx;
    let ty;
    let tz;
    if (next.kind === 'overview') {
      tx = r.layout.pxW / 2;
      ty = r.layout.pxH / 2 + r.reserveBottom / 2 / fit;
      tz = fit;
    } else if (next.kind === 'meeting') {
      tx = next.x;
      ty = next.y;
      tz = Math.min((r.cssW - 80) / next.w, (r.cssH - r.reserveBottom - 80) / next.h);
    } else {
      const ch = r.world.get(next.id);
      tx = ch ? ch.x : next.x;
      ty = (ch ? ch.y : next.y) - 6;
      tz = Math.max(fit * 2.4, 3);
    }
    tz = clamp(tz, r.minZoom, r.maxZoom);
    // ease in log-space for zoom so zooming in and out feel equally fast
    const k = 1 - Math.exp(-dt * 2.6);
    r.zoom = Math.exp(lerp(Math.log(r.zoom), Math.log(tz), k));
    r.cx = lerp(r.cx, tx, k);
    r.cy = lerp(r.cy, ty, k);
  }
}
