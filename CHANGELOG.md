# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.2.0]

### Added
- **Kick-off meetings.** A task given to an agent with a team (Claude Code `UserPromptSubmit`, or the demo) starts with a meeting: the host walks to the whiteboard, the team to the meeting table, an agenda fills with sticky notes, task cards are dealt, a speaker bubble goes round, and a banner counts down. Then everyone walks back and the tasks fly out. New `meeting` event, `--meeting <seconds>` flag.
- `--allow-host` for reverse proxies; roster `warnings` (a `reportsTo` typo or a reporting loop no longer rejects the whole roster).
- Content-Security-Policy meta tag for the static demo; translated accessibility labels.

### Fixed (code audit)
- The hook now strips folders, command arguments, URLs and prompts before sending (it sent more than the docs said).
- `hooks install/uninstall` kept removing the user's own hook when it shared a matcher group with ours.
- Names in scripts other than Latin and Cyrillic collapsed into one id.
- Reports on a wrapped row had no reporting line; very deep chains made the office extremely tall; "Lead generation" or "Assistant to the Director" was taken for a department head.
- DNS-rebinding check also applies when the server is exposed with `--host`; malformed URLs return 400.
- A* path finding with reused buffers (about 10x faster on large offices).
- A roster update no longer resets every character and the activity log; ids like `Writer` match the roster's `writer`; the demo restarts cleanly after a roster reload and guests survive it.
- The static demo could keep stale modules after a deploy (every URL is now versioned); the deploy runs the checks and tests first and is never cancelled halfway.
- URL parameters are validated and no longer saved as settings; the roster panel is a real tree.

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
