// The living part of the office: every agent is a character that walks to its
// desk when it has work and takes breaks in the lounge while idle.

import { TILE } from '../core/layout.js';
import { STATUS } from '../core/model.js';
import { findPath } from '../core/pathfinding.js';
import { hash32, mulberry32 } from '../core/rng.js';
import { defaultLook } from '../core/roster.js';

const SPEED = 46; // px per second
const DESK_SINK = 7;
const HURRY = 1.7; // agents called to a meeting walk faster

const SPOT_WEIGHT = { sofa: 4, armchair: 3, coffee: 3, vending: 1, cooler: 2, stool: 3, chair: 2, board: 1 };

export class Character {
  constructor(agent, deskSeat, now, rng, color) {
    this.id = agent.id;
    this.look = agent.look || defaultLook(agent.id, color);
    this.name = agent.name;
    this.seat = deskSeat;
    this.tx = deskSeat.x;
    this.ty = deskSeat.y;
    this.x = deskSeat.x * TILE + 8;
    this.y = (deskSeat.y + 1) * TILE;
    this.dir = 'down';
    this.path = [];
    this.mode = 'seated'; // 'seated' | 'walking' | 'spot'
    this.target = 'desk'; // where the current walk ends
    this.spot = null;
    this.phase = rng();
    this.t = rng() * 10;
    this.breakAt = now; // set by the world (depends on the "breaks" setting)
    this.stayUntil = 0;
    this.blinkAt = now + 2000 + rng() * 3000;
    this.shakeUntil = 0;
    this.appear = 0; // 0..1 spawn animation
  }
}

// How often idle agents leave their desk. "rare" keeps the office calm: most
// agents stay seated and only one or two stroll to the lounge at a time.
const BREAKS = {
  off: null,
  rare: { first: [50000, 130000], gap: [100000, 260000], stay: [6000, 11000], maxAway: 0.1 },
  normal: { first: [8000, 38000], gap: [20000, 65000], stay: [7000, 21000], maxAway: 0.35 },
};

export class World {
  constructor(roster, layout, { seed = 11, now = Date.now(), reduceMotion = false, breaks = 'rare' } = {}) {
    this.reduceMotion = reduceMotion;
    this.breaks = breaks in BREAKS ? breaks : 'rare';
    this.rng = mulberry32(seed);
    this.chars = new Map();
    this.effects = [];
    this.occupied = new Map(); // spot id -> character id
    this.meetingKey = '';
    this.seating = new Map(); // character id -> meeting spot
    this.setLayout(roster, layout, now);
  }

  /**
   * Install a (new) roster and layout. Characters that already exist keep their
   * look and do not fade in again; when their desk did not move they also keep
   * walking or sitting where they were, otherwise they sit down at the new desk.
   */
  setLayout(roster, layout, now = Date.now()) {
    const sameFloor = this.layout && this.layout.w === layout.w && this.layout.h === layout.h;
    this.layout = layout;
    this.roster = roster;
    const previous = this.chars;
    this.chars = new Map();
    this.occupied.clear();
    this.effects = [];
    this.meetingKey = '';
    this.seating = new Map();
    for (const agent of roster.agents) {
      const desk = layout.desks[agent.id];
      if (!desk) continue;
      const old = previous.get(agent.id);
      const color = roster.departments.find((d) => d.id === agent.department)?.color;
      const ch = new Character(agent, desk.seat, now, this.rng, color);
      ch.appear = old ? 1 : 0;
      ch.breakAt = this._nextBreak(now, true);
      if (old && sameFloor && old.seat.x === desk.seat.x && old.seat.y === desk.seat.y && old.mode === 'walking' && old.target === 'desk') {
        for (const k of ['x', 'y', 'tx', 'ty', 'dir', 'path', 'mode', 'target', 'phase', 't']) ch[k] = old[k];
      }
      this.chars.set(agent.id, ch);
    }
  }

  setBreaks(mode) {
    this.breaks = mode in BREAKS ? mode : 'rare';
    const now = Date.now();
    for (const ch of this.chars.values()) ch.breakAt = this._nextBreak(now, true);
  }

  /** Time of the next coffee/sofa break, or Infinity when breaks are switched off. */
  _nextBreak(now, first = false) {
    const cfg = BREAKS[this.breaks];
    if (!cfg) return Infinity;
    const [lo, hi] = first ? cfg.first : cfg.gap;
    return now + lo + this.rng() * (hi - lo);
  }

  /**
   * Seat everyone of a new meeting: the host at the whiteboard, the others on
   * the chairs closest to it. Agents on a break there are sent back to work.
   */
  _planMeeting(meeting, now) {
    this.seating = new Map();
    const plan = this.layout.meeting;
    if (!meeting || !plan) return;
    const hostCh = this.chars.get(meeting.host);
    // fill the table from the middle outwards, so a small meeting looks gathered
    const cx = plan.host ? plan.host.x + 0.5 : plan.seats.reduce((n, s) => n + s.x, 0) / Math.max(1, plan.seats.length);
    const seats = [...plan.seats].sort((a, b) => a.y - b.y || Math.abs(a.x - cx) - Math.abs(b.x - cx));
    if (hostCh) this.seating.set(hostCh.id, plan.host || seats.shift());
    for (const id of meeting.agents) {
      if (!this.chars.has(id) || !seats.length) continue;
      this.seating.set(id, seats.shift());
    }
    const taken = new Set([...this.seating.values()].filter(Boolean).map((s) => s.id));
    for (const ch of this.chars.values()) {
      if (this.seating.has(ch.id)) continue;
      if (ch.spot && taken.has(ch.spot.id)) {
        this._sendToDesk(ch);
        ch.breakAt = this._nextBreak(now);
      }
    }
    for (const id of taken) this.occupied.delete(id);
    if (!this.reduceMotion) this.effects.push({ kind: 'gather', at: now, life: 1600 });
  }

  /** Spot this character should be in for the running meeting, or null. */
  meetingSpotOf(id) {
    return this.seating.get(id) || null;
  }

  _awayCount() {
    let n = 0;
    for (const c of this.chars.values()) if (c.mode !== 'seated') n++;
    return n;
  }

  get(id) {
    return this.chars.get(id);
  }

  /** Event hook: spawn visual effects. */
  onEvent(evt, now) {
    if (this.reduceMotion) return;
    if (evt.type === 'status') {
      const ch = this.chars.get(evt.agent);
      if (!ch) return;
      if (evt.status === STATUS.DONE) {
        this.effects.push({ kind: 'sparkle', at: now, x: ch.x, y: ch.y - 30, color: '#7ff0b4', life: 900 });
        if (!this.reduceMotion) this.effects.push({ kind: 'confetti', at: now, x: ch.x, y: ch.y - 26, life: 1500 });
      }
      if (evt.status === STATUS.ERROR) ch.shakeUntil = now + 700;
    } else if (evt.type === 'delegate') {
      const a = this.chars.get(evt.from);
      const b = this.chars.get(evt.to);
      if (a && b) this.effects.push({ kind: 'packet', at: now, from: a.id, to: b.id, life: 1100 });
    }
  }

  _freeSpots() {
    return this.layout.spots.filter((s) => !this.occupied.has(s.id));
  }

  _pickSpot() {
    const free = this._freeSpots();
    if (!free.length) return null;
    const total = free.reduce((n, s) => n + (SPOT_WEIGHT[s.kind] || 1), 0);
    let r = this.rng() * total;
    for (const s of free) {
      r -= SPOT_WEIGHT[s.kind] || 1;
      if (r <= 0) return s;
    }
    return free[free.length - 1];
  }

  _release(ch) {
    if (ch.spot && this.occupied.get(ch.spot.id) === ch.id) this.occupied.delete(ch.spot.id);
    ch.spot = null;
  }

  _goMeet(ch, seat) {
    this._release(ch);
    ch.meeting = true;
    ch.spot = seat;
    this.occupied.set(seat.id, ch.id);
    if (ch.tx === seat.x && ch.ty === seat.y) {
      this._settleAtSpot(ch, 0);
      return;
    }
    if (!this._walkTo(ch, seat, 'spot')) {
      // no path (should not happen): appear there
      ch.tx = seat.x;
      ch.ty = seat.y;
      this._settleAtSpot(ch, 0);
    }
  }

  _walkTo(ch, goal, target) {
    const path = findPath(this.layout.grid, { x: ch.tx, y: ch.ty }, goal);
    if (!path) return false;
    ch.path = path;
    ch.target = target;
    ch.mode = path.length ? 'walking' : ch.mode;
    return true;
  }

  _sendToDesk(ch) {
    this._release(ch);
    if (ch.tx === ch.seat.x && ch.ty === ch.seat.y) {
      this._settleAtDesk(ch);
      return;
    }
    if (!this._walkTo(ch, ch.seat, 'desk')) this._teleportToDesk(ch);
  }

  _teleportToDesk(ch) {
    this._release(ch);
    ch.tx = ch.seat.x;
    ch.ty = ch.seat.y;
    ch.x = ch.tx * TILE + 8;
    ch.y = (ch.ty + 1) * TILE;
    ch.path = [];
    this._settleAtDesk(ch);
  }

  _settleAtDesk(ch) {
    ch.mode = 'seated';
    ch.dir = 'down';
    ch.x = ch.seat.x * TILE + 8;
    ch.y = (ch.seat.y + 1) * TILE;
    ch.tx = ch.seat.x;
    ch.ty = ch.seat.y;
    ch.path = [];
    ch.target = 'desk';
  }

  _settleAtSpot(ch, now) {
    const s = ch.spot;
    ch.mode = 'spot';
    ch.dir = s.face;
    ch.tx = s.x;
    ch.ty = s.y;
    ch.x = s.x * TILE + 8;
    ch.y = s.standing ? (s.y + 1) * TILE - 2 : (s.y + 1) * TILE;
    ch.path = [];
    const [lo, hi] = (BREAKS[this.breaks] || BREAKS.normal).stay;
    ch.stayUntil = now + lo + this.rng() * (hi - lo);
  }

  /** Advance every character. `statusOf(id)` returns the agent's current status. */
  update(dt, now, statusOf, meeting = null) {
    this.effects = this.effects.filter((e) => now - e.at < e.life);
    const live = meeting && now < meeting.endsAt ? meeting : null;
    const key = live ? `${live.host}@${live.startedAt}` : '';
    if (key !== this.meetingKey) {
      const wasHost = this.meetingKey ? this.meetingKey.split('@')[0] : null;
      const attendees = [...this.seating.keys()];
      this.meetingKey = key;
      if (live) this._planMeeting(live, now);
      else {
        this.seating = new Map();
        // the meeting is over: hand out the tasks and go back to work
        const host = wasHost && this.chars.get(wasHost);
        if (host && !this.reduceMotion) for (const id of attendees) if (id !== wasHost) this.effects.push({ kind: 'packet', at: now, from: host.id, to: id, life: 1100 });
      }
    }

    for (const ch of this.chars.values()) {
      ch.t += dt;
      if (ch.appear < 1) ch.appear = Math.min(1, ch.appear + dt * 2.5);
      const st = statusOf(ch.id);
      const wantsDesk = st !== STATUS.IDLE;
      const seat = this.seating.get(ch.id) || null;

      if (seat) {
        // in a meeting: go to (or stay at) the assigned place, whatever the status
        if (ch.mode === 'walking') {
          if (ch.spot?.id !== seat.id) this._goMeet(ch, seat);
          else this._step(ch, dt, now);
        } else if (ch.mode !== 'spot' || ch.spot?.id !== seat.id) this._goMeet(ch, seat);
        continue;
      }
      if (ch.meeting) {
        // left over from a finished meeting
        ch.meeting = false;
        this._sendToDesk(ch);
        ch.breakAt = this._nextBreak(now);
        if (ch.mode === 'walking') this._step(ch, dt, now);
        continue;
      }

      if (ch.mode === 'seated') {
        if (!wantsDesk && now >= ch.breakAt) {
          const cfg = BREAKS[this.breaks];
          const cap = cfg ? Math.max(1, Math.round(this.chars.size * cfg.maxAway)) : 0;
          const spot = cfg && this._awayCount() < cap ? this._pickSpot() : null;
          if (spot) {
            this.occupied.set(spot.id, ch.id);
            ch.spot = spot;
            if (!this._walkTo(ch, spot, 'spot')) {
              this._release(ch);
              ch.breakAt = now + 15000;
            }
          } else ch.breakAt = cfg ? now + 12000 + this.rng() * 12000 : Infinity;
        }
      } else if (ch.mode === 'spot') {
        if (wantsDesk || now >= ch.stayUntil || !BREAKS[this.breaks]) {
          this._sendToDesk(ch);
          ch.breakAt = this._nextBreak(now);
        }
      } else if (ch.mode === 'walking') {
        if (wantsDesk && ch.target === 'spot') {
          // work arrived while walking to the lounge: turn around
          this._release(ch);
          this._walkTo(ch, ch.seat, 'desk') || this._teleportToDesk(ch);
        } else {
          this._step(ch, dt, now);
        }
      }
    }
  }

  _step(ch, dt, now) {
    let budget = SPEED * dt * (ch.meeting ? HURRY : 1);
    while (budget > 0 && ch.path.length) {
      const next = ch.path[0];
      const isLast = ch.path.length === 1;
      const tx = next.x * TILE + 8;
      const onSeat = isLast && ch.target === 'desk';
      const ty = onSeat || (isLast && ch.spot && !ch.spot.standing && ch.target === 'spot') ? (next.y + 1) * TILE : (next.y + 1) * TILE - 2;
      const dx = tx - ch.x;
      const dy = ty - ch.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        ch.x = tx;
        ch.y = ty;
        ch.tx = next.x;
        ch.ty = next.y;
        ch.path.shift();
        budget -= dist;
        if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) ch.dir = dx > 0 ? 'right' : 'left';
        else if (dy !== 0) ch.dir = dy > 0 ? 'down' : 'up';
      } else {
        ch.x += (dx / dist) * budget;
        ch.y += (dy / dist) * budget;
        if (Math.abs(dx) >= Math.abs(dy)) ch.dir = dx > 0 ? 'right' : 'left';
        else ch.dir = dy > 0 ? 'down' : 'up';
        ch.phase += (budget / SPEED) * 2.2;
        budget = 0;
      }
    }
    if (!ch.path.length) {
      if (ch.target === 'desk') this._settleAtDesk(ch);
      else if (ch.spot) this._settleAtSpot(ch, now);
      else this._teleportToDesk(ch);
    }
  }

  /** Rendering pose for a character given its agent status. */
  pose(ch, status, now, since) {
    const t = ch.t;
    const blink = now > ch.blinkAt && now < ch.blinkAt + 130;
    if (now > ch.blinkAt + 130) ch.blinkAt = now + 2500 + this.rng() * 3500;
    const shake = now < ch.shakeUntil ? (Math.floor(now / 60) % 2 ? 1 : -1) : 0;
    const base = { x: ch.x + shake, y: ch.y, dir: ch.dir, t, blink, alpha: ch.appear, moving: false, sink: 0, arms: 'rest', phase: ch.phase };

    if (ch.mode === 'walking') {
      base.moving = true;
      return base;
    }
    if (ch.mode === 'spot' && ch.meeting) {
      const s = ch.spot;
      base.sink = s?.sink || 0;
      const speaking = this.speakerAt(now) === ch.id;
      if (s?.kind === 'board') base.arms = speaking || Math.floor(t * 1.5) % 3 ? 'ask' : 'raise';
      else base.arms = speaking ? (Math.floor(t * 3) % 2 ? 'raise' : 'chin') : Math.floor(t / 5 + (hash32(ch.id) % 5)) % 4 === 0 ? 'cup' : 'rest';
      return base;
    }
    if (ch.mode === 'spot') {
      const s = ch.spot;
      base.sink = s?.sink || 0;
      if (s?.kind === 'board') base.arms = 'ask';
      else if (s?.kind === 'sofa' || s?.kind === 'armchair') base.arms = Math.floor(t / 6 + hash32(ch.id) % 7) % 3 === 0 ? 'cup' : 'rest';
      else if (s?.kind === 'stool') base.arms = 'cup';
      return base;
    }
    base.sink = DESK_SINK;
    switch (status) {
      case STATUS.TYPING:
        base.arms = 'type';
        break;
      case STATUS.RUNNING:
        base.arms = 'fast';
        break;
      case STATUS.READING:
        base.arms = 'read';
        break;
      case STATUS.SEARCHING:
        base.arms = 'search';
        break;
      case STATUS.THINKING:
        base.arms = 'chin';
        break;
      case STATUS.DELEGATING:
        base.arms = 'raise';
        break;
      case STATUS.WAITING:
        base.arms = 'ask';
        break;
      case STATUS.PERMISSION:
        base.arms = 'cross';
        break;
      case STATUS.DONE:
        base.arms = now - since < 1600 ? 'raise' : 'rest';
        break;
      case STATUS.ERROR:
        base.arms = 'chin';
        break;
      case STATUS.SLEEPING:
        base.arms = 'sleep';
        break;
      default:
        base.arms = 'rest';
    }
    return base;
  }

  /** Who is talking in the meeting right now: the host half of the time, then each seated attendee in turn. */
  speakerAt(now) {
    if (!this.meetingKey) return null;
    const present = [...this.seating.keys()].filter((id) => {
      const c = this.chars.get(id);
      return c && c.mode === 'spot' && c.meeting;
    });
    if (!present.length) return null;
    const host = this.meetingKey.split('@')[0];
    const slot = Math.floor(now / 2200);
    if (slot % 2 === 0 && present.includes(host)) return host;
    const others = present.filter((id) => id !== host);
    if (!others.length) return present[0];
    return others[Math.floor(slot / 2) % others.length];
  }

  /** True while somebody is still walking to the meeting. */
  gathering() {
    for (const id of this.seating.keys()) if (this.chars.get(id)?.mode === 'walking') return true;
    return false;
  }

}
