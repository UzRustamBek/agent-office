# Claude Code integration

Agent Office observes Claude Code through [hooks](https://docs.claude.com/en/docs/claude-code/hooks). Claude Code runs a command on lifecycle events and passes a JSON payload on stdin; our script forwards a slimmed copy to the local server.

## Install

```bash
agent-office start                                       # keep running

agent-office hooks status                                # where is it installed?
agent-office hooks install --scope user                  # dry run: shows the target file and the effect
agent-office hooks install --scope user --write          # apply (creates a timestamped backup)
agent-office hooks uninstall --scope user --write        # remove only Agent Office entries
agent-office hooks print                                 # just print the JSON
```

| Scope | File | Use when |
|---|---|---|
| `user` | `~/.claude/settings.json` | you want every project visible |
| `project` | `.claude/settings.json` | the team shares the setup (commit it) |
| `local` | `.claude/settings.local.json` | only this checkout, not committed |

Add `--all` to also register `SubagentStart`, `PostToolUseFailure` and `PermissionRequest` (newer Claude Code versions). Restart running sessions, or open `/hooks` inside Claude Code, so they pick up the change.

If you prefer to edit by hand, `agent-office hooks print` produces ready-to-paste JSON. Your own hooks are never touched: ours are recognised by the script name `agent-office-hook.js`.

## What each event does

| Hook event | Result in the office |
|---|---|
| `SessionStart` | agent idle, "Session started" |
| `UserPromptSubmit` | thinking ("Received a task"; the text only with `--share-prompts`) |
| `PreToolUse` | `Read` `Glob` `Grep` → reading · `Edit` `Write` → typing · `Bash` → running · `WebSearch` `WebFetch` → searching · `Task` → delegating (+ envelope to the subagent) · MCP tools → running |
| `PostToolUse` | thinking |
| `PostToolUseFailure` | error |
| `PermissionRequest` | needs approval (pink "!" bubble) |
| `Notification` | needs approval if the message mentions permission, otherwise waiting for you ("?") |
| `Stop` | finished (green check, sparkles) |
| `SubagentStart` / `SubagentStop` | the subagent starts / finishes; the lead goes back to thinking |
| `SessionEnd` | idle |

## Which agent is it?

1. **`AGENT_OFFICE_AGENT=<id>`** pins everything from that terminal to one roster agent. Put it in the hook command (`hooks install --agent backend`) or in the shell that starts Claude: `AGENT_OFFICE_AGENT=backend claude`.
2. **`agent_type`** in the payload (subagent runs) is matched against roster ids, case-insensitively and slugified.
3. Otherwise the roster's **`mainAgent`**.

A name that is not in the roster still shows up: it is added to a **Guests** department.

So a typical setup is: your main Claude Code session = `director`; its subagents (`.claude/agents/*.md`) = the rest of the team. Run `agent-office import` first so the roster matches your subagent files.

## Privacy

The hook keeps only: event name, session id, `agent_type`, tool name, `message`, and from `tool_input` just `file_path`, `path`, `pattern`, `command`, `description`, `query`, `url`, `subagent_type` (each cut to 300 characters). **Tool results, file contents and transcript paths are dropped before anything is sent.** The server then shows only a file *basename* and a short description, never a full path.

The hook prints nothing (stdout would be injected into Claude's context on some events), exits `0` always, waits at most about 1.5 s and does nothing when no server is running.

## Manual events

Any tool can report state:

```bash
agent-office emit --agent researcher --status searching --activity "Comparing three vendors"
agent-office emit --agent researcher --status done
agent-office emit --delegate director:researcher --task "Vendor comparison"
```

With curl (the token is in `~/.agent-office/servers/<port>.json`):

```bash
curl -s -X POST http://127.0.0.1:4317/api/events \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"agent":"researcher","status":"typing","activity":"Writing the report"}'
```

PowerShell:

```powershell
$e = Get-Content "$HOME\.agent-office\servers\4317.json" | ConvertFrom-Json
Invoke-RestMethod -Method Post -Uri "$($e.url)/api/events" `
  -Headers @{ Authorization = "Bearer $($e.token)" } -ContentType 'application/json' `
  -Body '{"agent":"researcher","status":"typing","activity":"Writing the report"}'
```

## Troubleshooting

Run `agent-office doctor` first. Then:

* **Nothing moves.** Is the server running (`doctor` lists it)? Were Claude sessions restarted after `hooks install`? Does the `command` in the settings file point at the right `agent-office-hook.js`?
* **Everything is the `mainAgent`.** Your Claude Code version may not send `agent_type`; pin agents with `AGENT_OFFICE_AGENT` or use one terminal per agent.
* **Port busy.** The server tries the next 20 ports; the hook finds the right one through `~/.agent-office/servers/`.
* **Several servers.** The hook delivers to every live server, so a demo and a real one can run side by side.
* **Windows.** Claude Code runs hook commands in a shell that accepts forward slashes; the installer writes the script path that way.
* **Debug the hook alone:**
  `echo {"hook_event_name":"Stop"} | node hook/agent-office-hook.js` (no output is expected; check the office or `curl /api/state`).
