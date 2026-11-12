# Architecture

Agent Office is three small layers around one pure model.

```text
                ┌──────────────────────────── web/js/core  (pure, no DOM, no Node APIs) ──┐
 hook script ─▶ │  model.js     statuses, event protocol, reducer, timers                  │
 emit / HTTP ─▶ │  roster.js    roster validation, default looks                           │ ◀── tests
 simulator   ─▶ │  layout.js    departments -> zones, desks, lounge (tile grid)            │
                │  pathfinding.js, rng.js                                                  │
                └────────────▲───────────────────────────────▲─────────────────────────────┘
                             │                               │
                   server/ (Node, http only)           web/js (browser)
                   events.js  hook payload -> events   office/  world, renderer, art
                   server.js  static + SSE + POST      ui/      roster, drawer, log, i18n
                   importer.js, hooks.js, cli.js       sim/     demo simulator
```

Because `core/` has no environment dependencies, **the server, the browser and the tests run the exact same state logic**.

## Event protocol

Everything that changes the office is one of three event types. All fields are validated and clipped by `normalizeEvent` before they touch the state, whether they come from HTTP, a hook or the simulator.

```jsonc
// An agent changes what it is doing.
{ "type": "status", "agent": "backend", "status": "typing",
  "activity": "Editing server.js", "tool": "Edit", "ts": 1760000000000 }

// An agent hands work to another one (an envelope flies between the desks).
{ "type": "delegate", "from": "director", "to": "backend", "task": "Build the API" }

// A note for the activity log.
{ "type": "message", "agent": "backend", "text": "Waiting for the staging key" }
```

| Field | Rules |
|---|---|
| `agent`, `from`, `to` | 1 to 64 characters: letters, digits, `. _ : @ -`. Unknown ids are added to a **Guests** department so events are never lost. |
| `status` | `idle` `thinking` `typing` `reading` `running` `searching` `delegating` `waiting` `permission` `done` `error` `sleeping` |
| `activity` | Free text, control characters removed, 140 characters max. |
| `tool` | Optional tool name, 48 characters max. |
| `ts` | Milliseconds since the epoch; defaults to now. |

**Status groups.** *Active* = thinking, typing, reading, running, searching, delegating. *Blocked* (needs a human) = waiting, permission. `done` fades to `idle` after 4 s, `error` after 8 s, and an active agent with no event for 120 s is considered idle again (`tick` in `model.js`). Blocked states never time out.

### HTTP API

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /` | none | the app |
| `GET /api/health` | none | `{ ok, version, agents, clients, demo, uptimeSec }` |
| `GET /api/state` | none | roster + agent states + recent log |
| `GET /api/roster` | none | the normalized roster |
| `GET /api/stream` | none | Server-Sent Events: `snapshot`, `evt` |
| `POST /api/events` | Bearer | one event, or `{ "events": [...] }` (up to 100) |
| `POST /api/hook` | Bearer | `{ "payload": <Claude hook JSON>, "agent": "<id>?" }` |

The token is random per server start and is stored, with the port, in `~/.agent-office/servers/<port>.json` (mode 0600). `POST` bodies are limited to 128 KB and must be `application/json`.

SSE messages: `snapshot` (full state; sent on connect and whenever the roster changes) and `evt` (one normalized event).

## Mapping Claude Code hooks

`server/events.js` translates raw hook payloads. See [HOOKS.md](HOOKS.md) for the table. Identity is resolved in this order: the pinned agent (`AGENT_OFFICE_AGENT`), then `agent_type` in the payload, then the roster's `mainAgent`.

## Layout generator

`core/layout.js` turns a roster into a tile grid (1 tile = 16 logical pixels):

1. `core/roster.js` first derives the **org chart**: every agent gets `reportsTo`, `level`, `tier` and `team` (explicit `reportsTo`, otherwise inferred from the main agent and department heads).
2. Each department becomes a **zone**. Its agents are grouped by level and every level is a row of 3 x 3 tile desk cells (up to 6 per row, rows centered), so a zone reads top-down: heads first, doers last.
3. The zone holding the top-level agents (the main agent) is placed **alone at the top**; a 2-tile corridor separates it from the other departments, which share one row while they fit in 68 tiles and are otherwise packed so the office aspect ratio is closest to 1.9.
4. `layout.orgLines` lists the reporting lines in tile coordinates: a trunk and bus in the corridor down to every first-row department, and an elbow from each manager's desk to every direct report one row below. They are painted into the static layer, under the characters.
5. A bottom band holds the **lounge** (sofas, TV, bookshelf), **pantry** (coffee, vending, cooler) and **meeting room** (whiteboard and table). Components are added in that priority order while they fit.
6. Every furniture footprint is blocked on the grid; desks block their chair tile, which is only enterable as a goal. Desk furniture carries the agent's `tier`, so chiefs and managers get a darker desk and a nameplate.

Invariants verified by `test/core.test.js`: one desk per agent, no overlapping furniture, everything inside the walls, every seat reachable from the lounge, deterministic output.

## World and rendering

* **`office/world.js`** owns one `Character` per agent. A small state machine (`seated`, `walking`, `spot`) moves characters with `findPath` (Dijkstra with a turn penalty). Idle agents may take a coffee or sofa break, controlled by the **Breaks** setting (`breaks=off|rare|normal`): *rare* (default) waits 100 to 260 s between breaks and lets at most 10 % of the office be away at once, *normal* is the lively original, *off* keeps everyone at their desks. Any new work sends a strolling agent back at once.
* **`office/character.js`** draws a 16 x 26 character from rectangles: every direction, walk cycle and arm pose is generated, so looks are plain data.
* **`office/draw.js`** draws the static floor and walls once into an offscreen canvas and the furniture every frame as depth-sorted layers (z = foot y). Monitors render live content for the owner's status.
* **`office/renderer.js`** handles the camera (wheel, drag, pinch, follow), draws everything at integer-friendly scale with smoothing off, and draws text and bubbles afterwards in screen space so they stay sharp.

## UI

`ui/ui.js` builds DOM with a tiny `h()` helper and always uses `textContent`. There is no `innerHTML` anywhere in the code base (`npm run check` enforces it together with the Content-Security-Policy rules). Preferences live in `localStorage` behind try/catch, so the app works when storage is blocked.

## Tests

| File | Covers |
|---|---|
| `test/core.test.js` | model, roster, path finding, layout invariants |
| `test/events.test.js` | hook mapping, hook installer, simulator |
| `test/importer.test.js` | front matter parser, importer, CLI arguments |
| `test/server.test.js` | HTTP, auth, limits, traversal, SSE, the real hook script end to end |

```bash
npm test
npm run check
```
