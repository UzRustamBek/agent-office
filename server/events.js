// Maps raw Claude Code hook payloads onto Agent Office events.
// The hook script forwards payloads untouched; all interpretation lives here
// so it is unit-tested and can evolve without reinstalling hooks.

import path from 'node:path';

import { STATUS, isValidAgentId } from '../web/js/core/model.js';
import { slug } from '../web/js/core/roster.js';

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const RUN_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'PowerShell']);
const SEARCH_TOOLS = new Set(['WebSearch', 'WebFetch']);
const DELEGATE_TOOLS = new Set(['Task', 'Agent']);

const base = (p) => (typeof p === 'string' && p ? path.basename(p.replace(/\\/g, '/')) : '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Short human label for a tool call. Never includes file contents or full paths. */
export function describeTool(tool, input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  if (READ_TOOLS.has(tool)) {
    const f = base(i.file_path || i.notebook_path || i.path);
    if (tool === 'Grep') return `Searching code${i.pattern ? `: ${clip(String(i.pattern), 40)}` : ''}`;
    if (tool === 'Glob') return `Finding files${i.pattern ? `: ${clip(String(i.pattern), 40)}` : ''}`;
    return f ? `Reading ${f}` : 'Reading files';
  }
  if (WRITE_TOOLS.has(tool)) {
    const f = base(i.file_path || i.notebook_path);
    return f ? `${tool === 'Write' ? 'Writing' : 'Editing'} ${f}` : 'Editing files';
  }
  if (RUN_TOOLS.has(tool)) {
    const d = typeof i.description === 'string' && i.description.trim();
    if (d) return `Running: ${clip(d.trim(), 70)}`;
    const cmd = typeof i.command === 'string' ? i.command.trim().split(/\s+/)[0] : '';
    return cmd ? `Running ${clip(base(cmd) || cmd, 30)}` : 'Running a command';
  }
  if (tool === 'WebSearch') return `Searching the web${i.query ? `: ${clip(String(i.query), 50)}` : ''}`;
  if (tool === 'WebFetch') return 'Fetching a web page';
  if (DELEGATE_TOOLS.has(tool)) return `Delegating to ${i.subagent_type || 'a subagent'}`;
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__');
    return `Using ${parts[1] || 'MCP'}: ${parts.slice(2).join(' ') || 'tool'}`.slice(0, 80);
  }
  return `Using ${tool}`;
}

export function statusForTool(tool) {
  if (READ_TOOLS.has(tool)) return STATUS.READING;
  if (WRITE_TOOLS.has(tool)) return STATUS.TYPING;
  if (RUN_TOOLS.has(tool)) return STATUS.RUNNING;
  if (SEARCH_TOOLS.has(tool)) return STATUS.SEARCHING;
  if (DELEGATE_TOOLS.has(tool)) return STATUS.DELEGATING;
  return STATUS.RUNNING;
}

/**
 * Resolve which roster agent a hook payload belongs to.
 *  1. the explicit pin (AGENT_OFFICE_AGENT in the hook command)
 *  2. payload.agent_type (subagent runs and `claude --agent <name>`)
 *  3. the main agent
 */
export function resolveAgent(payload, ctx) {
  const lookup = (raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const direct = ctx.has(raw) ? raw : null;
    if (direct) return direct;
    const s = slug(raw);
    return ctx.has(s) ? s : null;
  };
  const pinned = lookup(ctx.pinned);
  if (pinned) return pinned;
  const typed = lookup(payload.agent_type);
  if (typed) return typed;
  if (ctx.pinned && isValidAgentId(slug(ctx.pinned))) return slug(ctx.pinned); // unknown pin becomes a guest
  if (typeof payload.agent_type === 'string' && isValidAgentId(slug(payload.agent_type))) return slug(payload.agent_type);
  return ctx.main;
}

/**
 * @param {object} payload raw Claude Code hook JSON
 * @param {{ has:(id:string)=>boolean, main:string, pinned?:string, sharePrompts?:boolean }} ctx
 * @returns {object[]} Agent Office events (possibly empty)
 */
export function fromClaudeHook(payload, ctx) {
  if (!payload || typeof payload !== 'object') return [];
  const name = payload.hook_event_name;
  if (typeof name !== 'string') return [];
  const ts = Date.now();
  const agent = resolveAgent(payload, ctx);
  if (!agent) return [];
  // Every event of a Claude Code session belongs to that session's current task
  // (one task per prompt). The server keeps the session -> task map (`ctx.taskFor`).
  const sid = typeof payload.session_id === 'string' ? payload.session_id : '';
  let task = null;
  const join = (mode) => {
    task = sid && typeof ctx.taskFor === 'function' ? ctx.taskFor(sid, mode) : null;
    return task;
  };
  const taskId = () => (task ? task.key : undefined);
  const status = (st, activity = '', tool = null, who = agent) => ({ type: 'status', agent: who, status: st, activity, tool, taskId: taskId(), ts });
  const startEvent = (title = '') => ({ type: 'task', action: 'start', id: task.key, agent: ctx.main || agent, title, ts });
  const endEvent = (outcome) => {
    const e = { type: 'task', action: 'end', id: task.key, outcome, ts };
    ctx.endTask?.(sid);
    return e;
  };
  /** Work events can be the first thing we see of a session (server started late): open its task then. */
  const withStart = (events) => (task?.created ? [startEvent(), ...events] : events);

  switch (name) {
    case 'SessionStart':
      return [status(STATUS.IDLE, 'Session started')];
    case 'SessionEnd': {
      const out = [status(STATUS.IDLE, '')];
      if (join('peek')) out.push(endEvent('abandoned'));
      return out;
    }
    case 'UserPromptSubmit': {
      join('start');
      const prompt = ctx.sharePrompts && typeof payload.prompt === 'string' ? clip(payload.prompt.replace(/\s+/g, ' ').trim(), 90) : '';
      const out = [];
      if (task?.previous) out.push({ type: 'task', action: 'end', id: task.previous, outcome: 'abandoned', ts });
      if (task) out.push(startEvent(prompt));
      out.push(status(STATUS.THINKING, prompt ? `Task: ${prompt}` : 'Received a task'));
      // A new task opens with a short kick-off meeting: the agent that got it
      // gathers its direct reports at the meeting table to split the work.
      const team = typeof ctx.team === 'function' ? ctx.team(agent).slice(0, 8) : [];
      const ms = Number.isFinite(ctx.meetingMs) ? ctx.meetingMs : 20000;
      if (team.length && ms > 0) out.push({ type: 'meeting', host: agent, agents: team, topic: prompt, taskId: taskId(), durationMs: ms, ts });
      return out;
    }
    case 'PreToolUse': {
      join('work');
      const tool = typeof payload.tool_name === 'string' ? payload.tool_name : 'tool';
      const input = payload.tool_input;
      const out = [status(statusForTool(tool), describeTool(tool, input), tool)];
      if (DELEGATE_TOOLS.has(tool) && input && typeof input.subagent_type === 'string') {
        const target = slug(input.subagent_type);
        if (isValidAgentId(target) && target !== agent) {
          out.push({
            type: 'delegate',
            from: agent,
            to: target,
            task: ctx.sharePrompts && typeof input.description === 'string' ? clip(input.description, 100) : '',
            taskId: taskId(),
            ts,
          });
        }
      }
      return withStart(out);
    }
    case 'PostToolUse':
      join('work');
      return withStart([status(STATUS.THINKING, 'Thinking')]);
    case 'PostToolUseFailure':
      join('work');
      return withStart([status(STATUS.ERROR, `${payload.tool_name || 'Tool'} failed`, typeof payload.tool_name === 'string' ? payload.tool_name : null)]);
    case 'PermissionRequest':
      join('work');
      return withStart([status(STATUS.PERMISSION, `Needs approval: ${payload.tool_name || 'a tool'}`, typeof payload.tool_name === 'string' ? payload.tool_name : null)]);
    case 'Notification': {
      join('peek');
      const msg = typeof payload.message === 'string' ? payload.message : '';
      if (/permission|approve|allow/i.test(msg)) return [status(STATUS.PERMISSION, 'Needs your approval')];
      return [status(STATUS.WAITING, 'Waiting for your input')];
    }
    case 'Stop': {
      join('peek');
      const out = [status(STATUS.DONE, 'Finished')];
      if (task) out.push(endEvent('done'));
      return out;
    }
    case 'SubagentStart': {
      join('peek');
      const who = typeof payload.agent_type === 'string' ? slug(payload.agent_type) : null;
      if (!who || !isValidAgentId(who)) return [];
      return [status(STATUS.THINKING, 'Started a task', null, who)];
    }
    case 'SubagentStop': {
      join('peek');
      const who = typeof payload.agent_type === 'string' ? slug(payload.agent_type) : null;
      if (!who || !isValidAgentId(who)) return [status(STATUS.THINKING, 'Reviewing the result')];
      return [status(STATUS.DONE, 'Finished', null, who), status(STATUS.THINKING, 'Reviewing the result', null, agent === who ? ctx.main : agent)];
    }
    default:
      return [];
  }
}
