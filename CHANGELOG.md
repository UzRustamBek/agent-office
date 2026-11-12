# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.1.0]

### Added
- **Hierarchy.** Agents can declare `reportsTo` (and `lead`); the office is laid out as an org chart: the chief on top, departments below, and one row of desks per reporting level, with reporting lines painted on the floor. Gold and steel nameplates, a star or diamond on name tags, and an indented roster panel show who is a chief, manager or doer. The details drawer shows who an agent reports to and their team.
- Structure is inferred when `reportsTo` is missing (main agent on top, department heads recognised by `lead: true` or a title). The importer reads `reports_to` and `lead` from agent front matter.
- The demo simulation now delegates down the reporting lines: chief to managers, managers to their teams.
- **Breaks** setting (`breaks=off|rare|normal`).

### Changed
- Agents now stay at their desks by default: breaks are rare and at most 10 % of the office is away at once. The previous behavior is the *Often* option.

## [1.0.0]

First release.

### Added
- Pixel-art office generated from a roster: department zones, one desk per agent, lounge, pantry and meeting room.
- Procedurally drawn characters (6 skin tones, 8 hairstyles, accessories, team colors) with walk cycles and a pose for every status.
- Live monitors, speech bubbles, delegation envelopes, day/night lighting.
- Roster panel with search and filters, details drawer, activity log.
- Demo simulator, runnable in the browser (static hosting) or on the server.
- Node server with Server-Sent Events, token-protected event API and hot-reloaded roster.
- Claude Code integration: hook script, safe `hooks install/uninstall`, subagent delegation, per-terminal agent pinning.
- `import` command for `.claude/agents` folders; `emit` command for any other tool; `doctor`.
- English, Uzbek (Latin) and Russian UI; dark and light themes; reduced motion; mobile support.
- Test suite and repository checks with zero dependencies.
