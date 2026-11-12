# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

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
