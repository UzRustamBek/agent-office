# Security policy

## Model

Agent Office is a **local tool**. By default the server listens on `127.0.0.1` only and sends nothing to the internet.

* Read endpoints (`GET`) expose agent names, roles and live status to whoever can reach the port. Keep the default bind address unless you are on a network you trust.
* Write endpoints (`POST /api/events`, `/api/hook`) require a random bearer token, `Content-Type: application/json` and a 128 KB body limit, and are never CORS-enabled. When bound to loopback, requests whose `Host` header is not a loopback name are refused (DNS-rebinding protection).
* The page is served with a strict Content-Security-Policy (`default-src 'self'`, no inline script or style) and builds its DOM with `textContent` only.
* The hook script forwards a minimal subset of Claude Code's payload and drops file contents, tool results and transcript paths.
* `hooks install` changes your Claude Code settings only with `--write`, creates a timestamped backup first, and `uninstall` removes only entries it created.
* The importer reads agent metadata only, never follows symbolic links and ignores files over 256 KB.

## Reporting a vulnerability

Please open a **private security advisory** on GitHub (Security tab, "Report a vulnerability") instead of a public issue. Include the version, a description and steps to reproduce. A fix is prepared before details are published.

## Out of scope

* Anything that requires an attacker who already controls your user account or the folder where you run the server.
* Exposing the server with `--host 0.0.0.0` on an untrusted network: this is an explicit opt-in, and the CLI warns about it.
