# Roster format

A roster is a JSON object describing your office. `agents.example.json` in the repository root is a complete, working example.

```jsonc
{
  "office": {
    "title": "My Studio",          // shown in the header (max 60 chars)
    "subtitle": "Five specialists", // optional (max 120)
    "mainAgent": "director"        // the agent that Claude Code sessions are attributed to
  },
  "departments": [
    { "id": "build", "name": "Build", "color": "#3fb68b" }
  ],
  "agents": [ /* see below */ ]
}
```

A bare array of agents is accepted too: `[{ "name": "Alpha" }, { "name": "Beta" }]`.

## Departments

| Field | Notes |
|---|---|
| `id` | slug used by agents (`"department": "build"`); derived from `name` when missing |
| `name` | display name; defaults to the prettified id (`it` becomes `IT`) |
| `color` | `#rrggbb` or one of `blue orange green purple yellow pink red cyan teal gray`. Colors the carpet, the zone sign and the default shirts. Cycles through a built-in palette when omitted |

Departments you do not declare are created automatically from the agents that reference them. Empty departments are dropped. Up to 24 departments.

## Agents

| Field | Required | Notes |
|---|---|---|
| `name` | yes (or `id`) | display name, max 60 chars |
| `id` | no | slug; derived from `name`. Must be unique. This is what events refer to |
| `role` | no | one line under the name, max 80 |
| `department` | no | defaults to `general` |
| `description` | no | shown in the details drawer, max 600 |
| `model` | no | free text badge (`opus`, `sonnet`, ...) |
| `tools` | no | list of strings, shown as tags |
| `skills` | no | list of strings, shown as soft tags |
| `reportsTo` | no | id (or name) of this agent's manager; `null` = top of the organization. See [Hierarchy](#hierarchy) |
| `lead` | no | `true` marks the head of its department (used only when `reportsTo` is not given) |
| `look` | no | appearance; generated from the id when omitted (stable between runs) |

Up to 120 agents. Problems are reported all at once (duplicate ids, unknown look values, missing names) instead of failing on the first one.

### Look

```jsonc
"look": {
  "skin": 2,                 // 0-5, or "#rrggbb"
  "hair": "bob",             // short long bun spiky curly cap bald bob
  "hairColor": 3,            // 0-7, or "#rrggbb"
  "shirt": "#6c8cff",        // #rrggbb or a color name; default: team color
  "pants": "#2f3650",
  "accessory": "glasses"     // none glasses headset beard tie earrings
}
```

Every key is optional; missing ones are generated deterministically from the agent id, so the same id always looks the same. `hairColor` presets: `0` black-brown, `1` brown, `2` chestnut, `3` dark blond, `4` blond, `5` ginger, `6` gray, `7` blue.

## Hierarchy

The office is drawn like an org chart: the top of the organization sits alone above everyone else, the departments hang below it, and inside a department every reporting level gets its own row of desks. Faint lines on the floor connect a manager's desk to the people who report to them, and delegations fly along those lines.

```jsonc
{ "id": "director", "name": "Director", "reportsTo": null },                    // top of the organization
{ "id": "architect", "name": "Architect", "department": "engineering", "reportsTo": "director" },
{ "id": "backend",   "name": "Backend",   "department": "engineering", "reportsTo": "architect" }
```

* `reportsTo` takes an agent `id` or `name`. `null` (or `"none"`) makes the agent a top-level agent; several are allowed and they share the top row.
* Without `reportsTo` the structure is inferred: the main agent is the root, each department's head reports to it, and everyone else reports to their department's head (or straight to the main agent). A head is the agent marked `lead: true`, otherwise the first one whose role or name contains a title such as *head, lead, chief, director, manager, CTO, CFO, CEO* or *direktor, boshliq, rahbar, timlid*.
* Every agent gets a **tier**: `chief` (top of the tree, gold desk plate and a star), `manager` (has people reporting to them, steel plate and a diamond) and `doer` (everyone else). Tiers and levels are computed, never written by hand.
* Unknown ids, an agent reporting to itself and reporting cycles are reported with the other roster problems.
* In `agent-office import`, add `reports_to: <name>` and/or `lead: true` to the front matter of an agent file.

## Importing from Claude Code agent files

`agent-office import` reads Markdown files with front matter:

```markdown
---
name: backend
description: Builds APIs and databases. Use for server code.
model: sonnet
tools: Read, Edit, Bash
color: green
---
(system prompt, never imported)
```

| Source | Becomes |
|---|---|
| `name` | `id` (slug) and display name (prettified, e.g. `qa-lead` → `QA Lead`) |
| first sentence of `description` | `role`; the whole text becomes `description` |
| `model`, `tools` (comma list or YAML list), `skills` | same fields |
| `color` | the character's shirt color |
| `reports_to`, `lead` | org chart hints, see [Hierarchy](#hierarchy) |
| parent folder (`it/backend.md`) | department `it` → **IT**; files at the top level go to `agents` |
| main agent | `--main <name>`, else the first of `director`, `direktor`, `orchestrator`, `lead`, `main`, `ceo`, `boss`, `manager` |

Folders are merged in order, so a project agent overrides a user-level agent with the same name. Symbolic links are never followed; files over 256 KB and folders deeper than 4 levels are skipped and reported.

## Where the server looks

`--agents file`, then `./agents.local.json`, then `./agents.json`, then the bundled example. Files other than the bundled example are watched and reloaded when they change. A roster that fails validation is not applied; the previous office stays on screen and the reason is printed.
