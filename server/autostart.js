// Start Agent Office by itself when you log in, so the office is always there
// when a Claude Code hook fires. One small file per platform, no services, no
// admin rights, and `autostart uninstall` removes exactly that file.
//
//   Windows  Startup folder        Agent Office.vbs  (runs node hidden)
//   macOS    ~/Library/LaunchAgents  app.agent-office.plist
//   Linux    ~/.config/autostart     agent-office.desktop
//
// Like `hooks`, nothing is written unless the CLI passes write = true.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTOSTART_MARKER = 'agent-office autostart';
const LABEL = 'app.agent-office';

export function cliPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agent-office.js');
}

/** Arguments after `agent-office` for the background server. `--once` = do nothing when one is already running. */
export function startArgs({ port, agents } = {}) {
  const args = ['start', '--once'];
  if (port !== undefined) args.push('--port', String(port));
  if (agents) args.push('--agents', agents);
  return args;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const vbs = (s) => `"${String(s).replace(/"/g, '""')}"`;
const desktop = (s) => `"${String(s).replace(/(["\\`$])/g, '\\$1')}"`;

/**
 * File that starts the server at login.
 * @returns {{ file: string, content: string }}
 */
export function buildAutostart({ platform = process.platform, home = os.homedir(), env = process.env, node = process.execPath, cli = cliPath(), cwd = process.cwd(), port, agents } = {}) {
  const args = startArgs({ port, agents });
  if (platform === 'win32') {
    const dir = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    // WScript.Shell.Run(cmd, 0) = hidden window; False = do not wait.
    const cmd = [node, cli, ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
    const content = [
      `' ${AUTOSTART_MARKER}: starts the office at login (remove with "agent-office autostart uninstall")`,
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = ${vbs(cwd)}`,
      `sh.Run ${vbs(cmd)}, 0, False`,
      '',
    ].join('\r\n');
    return { file: path.join(dir, 'Agent Office.vbs'), content };
  }
  if (platform === 'darwin') {
    const items = [node, cli, ...args].map((a) => `    <string>${xml(a)}</string>`).join('\n');
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${AUTOSTART_MARKER}: remove with "agent-office autostart uninstall" -->
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
`;
    return { file: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`), content };
  }
  const exec = [node, cli, ...args].map(desktop).join(' ');
  const content = `[Desktop Entry]
# ${AUTOSTART_MARKER}: remove with "agent-office autostart uninstall"
Type=Application
Name=Agent Office
Exec=${exec}
Path=${cwd}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  return { file: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart', 'agent-office.desktop'), content };
}

/** Is the autostart file there, and was it written by us? */
export function autostartStatus(opts = {}) {
  const { file } = buildAutostart(opts);
  if (!fs.existsSync(file)) return { file, installed: false };
  let ours = false;
  try {
    ours = fs.readFileSync(file, 'utf8').includes(AUTOSTART_MARKER);
  } catch {
    /* unreadable counts as not ours */
  }
  return { file, installed: ours, foreign: !ours };
}

export function installAutostart(opts = {}) {
  const { file, content } = buildAutostart(opts);
  const state = autostartStatus(opts);
  if (state.foreign) throw new Error(`${file} exists and was not created by Agent Office; not touching it`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export function removeAutostart(opts = {}) {
  const state = autostartStatus(opts);
  if (state.foreign) throw new Error(`${state.file} was not created by Agent Office; not removing it`);
  if (!state.installed) return false;
  fs.unlinkSync(state.file);
  return true;
}
