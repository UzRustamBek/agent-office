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

## Keep the office running

The office only moves while a server is running. To have it start when you log in:

```bash
agent-office autostart install --write     # dry run without --write
agent-office autostart status
agent-office autostart uninstall --write
```

It writes one small file (Windows: a hidden script in the Startup folder; macOS: a LaunchAgent; Linux: an autostart entry) that runs `agent-office start --once` in the folder you installed from, so your `agents.local.json` is found. `--once` exits quietly when an office is already running, so you never get two. `uninstall` removes only that file, and refuses to touch a file it did not create.

## Tasks

Every hook event carries the Claude Code `session_id`, so the server can tell windows apart. A **task** is one prompt of one session: `UserPromptSubmit` opens it, `Stop` finishes it, and everything in between (tool calls, subagents, permission requests, errors) is counted on that task's card. If a new prompt arrives while the old one never reported `Stop` (you pressed Esc), the old task closes as "no activity". A task with no events for 20 minutes closes the same way. If the server starts in the middle of a session, the first tool call opens a task for it.

The task text is private by default, so cards read "Task #3". To show the first words of your prompt, opt in on both sides:

```bash
agent-office hooks install --share-prompts --write    # the hook then sends the first 200 characters
agent-office start --share-prompts                    # the server then shows them
```

The text goes only to the local server (and to anyone who can open its page), so leave it off if you type secrets into prompts.

## What each event does

| Hook event | Result in the office |
|---|---|
| `SessionStart` | agent idle, "Session started" |
| `UserPromptSubmit` | thinking ("Received a task"; the text only with `--share-prompts`). If the agent has people reporting to it, a **kick-off meeting** starts: it walks to the whiteboard, its direct reports (up to 8) take seats at the meeting table, and after the meeting (20 s, `--meeting <seconds>`, `0` = off) everyone goes back to their desk |
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

The hook reduces every payload **before it leaves Claude Code** to: event name, session id, `agent_type`, `agent_id`, tool name, `message`, and from `tool_input` only

* the file *name* of `file_path` / `notebook_path` / `path` (never the folder),
* the *program* of a shell `command` (`npm`, `git`, never its arguments, which can contain secrets),
* `pattern` (60), `description` (120), `query` (80) and `subagent_type`.

Tool results, file contents, URLs, transcript paths and your prompt text are never sent. Set `AGENT_OFFICE_SHARE_PROMPTS=1` to forward the first 200 characters of each prompt; the server still shows them only when started with `--share-prompts`. Requests go to `127.0.0.1` over plain HTTP with the bearer token.

The hook prints nothing (stdout would be injected into Claude's context on some events), exits `0` always, waits at most about 2.5 s (1 s to read its input, 1.5 s per request, servers in parallel) and does nothing when no server is running.

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
