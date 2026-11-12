// Demo simulator. Produces the same events a live Claude Code session would
// (status / delegate), driven by a seeded RNG so scenarios are reproducible.
// Runs in the browser (GitHub Pages demo) and in Node (`agent-office start --demo`).

import { STATUS } from '../core/model.js';
import { mulberry32, pick, range, shuffle } from '../core/rng.js';

const FILES = [
  'README.md',
  'src/index.js',
  'src/api/routes.js',
  'docs/plan.md',
  'config/settings.json',
  'tests/app.test.js',
  'notes/meeting.md',
  'data/report.csv',
  'src/ui/panel.css',
  'scripts/deploy.sh',
];
const QUERIES = ['best practice caching', 'competitor pricing page', 'release notes', 'API rate limits', 'style guide examples'];
const COMMANDS = ['npm test', 'git status', 'python build.py', 'node scripts/check.mjs', 'docker compose up -d'];
const TASKS = [
  'Prepare the weekly report',
  'Audit the landing page',
  'Review the pull request',
  'Plan the next release',
  'Research three competitors',
  'Draft the launch announcement',
  'Fix the failing build',
  'Summarize the customer feedback',
];

const WORK = [
  { status: STATUS.READING, tool: 'Read', text: (r) => `Reading ${pick(r, FILES)}`, ms: [1800, 3600] },
  { status: STATUS.SEARCHING, tool: 'WebSearch', text: (r) => `Searching "${pick(r, QUERIES)}"`, ms: [2000, 4200] },
  { status: STATUS.TYPING, tool: 'Edit', text: (r) => `Editing ${pick(r, FILES)}`, ms: [2600, 5200] },
  { status: STATUS.RUNNING, tool: 'Bash', text: (r) => `Running ${pick(r, COMMANDS)}`, ms: [1800, 3800] },
];

/**
 * @param {{ getRoster: () => any, emit: (e: object) => void, seed?: number,
 *           speed?: number, maxScenarios?: number, spawnEveryMs?: [number, number] }} opts
 */
export function createSimulator({ getRoster, emit, seed = 7, speed = 1, maxScenarios = 3, spawnEveryMs = [3500, 8000], meetings = true }) {
  const rng = mulberry32(seed);
  let queue = []; // { at, fn } sorted by `at`
  let scenarios = 0;
  let nextSpawn = 0;
  let busy = new Set();
  let stopped = false;
  let meetingUntil = 0; // one meeting room: no new meeting before the current one ends

  const sc = (ms) => Math.max(40, ms / speed);
  const schedule = (at, fn) => {
    queue.push({ at, fn });
    queue.sort((a, b) => a.at - b.at);
  };

  // every scenario is one task; its events carry the task id so the dashboard can follow it
  const taskOf = new Map(); // agent id -> task id
  let taskCount = 0;
  const status = (agent, st, activity = '', tool = null, ts) => emit({ type: 'status', agent, status: st, activity, tool, taskId: taskOf.get(agent), ts });
  const beginTask = (agentId, title, now) => {
    const id = `demo-${++taskCount}`;
    taskOf.set(agentId, id);
    emit({ type: 'task', action: 'start', id, agent: agentId, title, ts: now });
    return id;
  };
  const endTask = (id, at) => schedule(at, () => emit({ type: 'task', action: 'end', id, outcome: 'done', ts: Date.now() }));

  /** Build the timeline for one worker and return the time it finishes. */
  function planWorker(agent, startAt) {
    let t = startAt;
    const id = agent.id;
    busy.add(id);
    schedule(t, () => status(id, STATUS.THINKING, 'Understanding the task', null, Date.now()));
    t += sc(range(rng, 1200, 2400));
    const steps = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < steps; i++) {
      const w = pick(rng, WORK);
      const text = w.text(rng);
      const at = t;
      schedule(at, () => status(id, w.status, text, w.tool, Date.now()));
      t += sc(range(rng, w.ms[0], w.ms[1]));
      const roll = rng();
      if (roll < 0.14) {
        schedule(t, () => status(id, STATUS.PERMISSION, `Needs approval: ${w.tool}`, w.tool, Date.now()));
        t += sc(range(rng, 3000, 5500));
      } else if (roll < 0.2) {
        schedule(t, () => status(id, STATUS.WAITING, 'Has a question for you', null, Date.now()));
        t += sc(range(rng, 3500, 6500));
      } else if (roll < 0.25) {
        schedule(t, () => status(id, STATUS.ERROR, `${w.tool} failed, retrying`, w.tool, Date.now()));
        t += sc(range(rng, 1800, 3000));
      } else {
        schedule(t, () => status(id, STATUS.THINKING, 'Thinking', null, Date.now()));
        t += sc(range(rng, 700, 1500));
      }
    }
    schedule(t, () => {
      status(id, STATUS.DONE, 'Finished', null, Date.now());
      busy.delete(id);
      taskOf.delete(id);
    });
    return t;
  }

  /**
   * A manager breaks the task down: it thinks, briefs some of its direct reports
   * (who may pass parts on to their own team), reviews the results and writes the
   * summary. Anyone without free reports just does the work. Returns the finish time.
   */
  function planTree(agent, startAt, task, depth = 0) {
    const roster = getRoster();
    const byId = new Map(roster.agents.map((a) => [a.id, a]));
    const free = (agent.team || []).map((id) => byId.get(id)).filter((a) => a && !busy.has(a.id));
    const delegates = free.length > 0 && depth < 3 && (depth === 0 || rng() < 0.7);
    if (!delegates) return planWorker(agent, startAt);

    const crew = shuffle(rng, free).slice(0, 1 + Math.floor(rng() * Math.min(depth === 0 ? 3 : 2, free.length)));
    busy.add(agent.id);
    for (const m of crew) {
      busy.add(m.id); // reserved for this task from the start
      taskOf.set(m.id, taskOf.get(agent.id));
    }
    let t = startAt;
    schedule(t, () => status(agent.id, STATUS.THINKING, `Planning: ${task}`, null, Date.now()));
    t += sc(range(rng, 1400, 2400));
    if (depth === 0 && meetings && t >= meetingUntil) {
      // kick-off meeting: everybody walks to the meeting table first. Walking
      // speed does not follow the demo speed, so the meeting has a real-time floor.
      const durationMs = Math.max(20000, sc(26000));
      schedule(t, () => {
        emit({ type: 'meeting', host: agent.id, agents: crew.map((m) => m.id), topic: task, taskId: taskOf.get(agent.id), durationMs, ts: Date.now() });
        status(agent.id, STATUS.DELEGATING, `Kick-off meeting: ${task}`, null, Date.now());
      });
      t += durationMs;
      meetingUntil = t + 1000;
    }
    schedule(t, () => status(agent.id, STATUS.DELEGATING, `Briefing ${crew.length} agent${crew.length > 1 ? 's' : ''}`, 'Task', Date.now()));
    let latest = t;
    crew.forEach((member, i) => {
      const at = t + sc(300 + i * 700);
      schedule(at, () => emit({ type: 'delegate', from: agent.id, to: member.id, task, taskId: taskOf.get(agent.id), ts: Date.now() }));
      latest = Math.max(latest, planTree(member, at + sc(500), task, depth + 1));
    });
    t = latest + sc(400);
    schedule(t, () => status(agent.id, STATUS.READING, 'Reviewing the results', 'Read', Date.now()));
    t += sc(range(rng, 1500, 2600));
    schedule(t, () => status(agent.id, STATUS.TYPING, 'Writing the summary', 'Write', Date.now()));
    t += sc(range(rng, 1800, 3200));
    schedule(t, () => {
      status(agent.id, STATUS.DONE, depth === 0 ? 'Task complete' : 'Finished', null, Date.now());
      busy.delete(agent.id);
      taskOf.delete(agent.id);
    });
    return t;
  }

  function planScenario(now) {
    const roster = getRoster();
    const free = roster.agents.filter((a) => !busy.has(a.id));
    if (free.length < 1) return false;
    const main = free.find((a) => a.id === roster.office.mainAgent);
    const managers = free.filter((a) => (a.team || []).length > 0);
    const task = pick(rng, TASKS);

    // Most work starts at the top and flows down the reporting lines; some is a
    // department running its own task, and some is a single agent working alone.
    const roll = rng();
    let lead;
    if (main && roll < 0.55) lead = main;
    else if (managers.length && roll < 0.85) lead = pick(rng, managers);
    else lead = pick(rng, free);
    scenarios += 1;
    const taskId = beginTask(lead.id, task, now);
    const end = planTree(lead, now, task, 0);
    endTask(taskId, end + 60);
    schedule(end + 100, () => (scenarios -= 1));
    return true;
  }

  return {
    /** Advance the simulation; call this regularly with a monotonic clock. */
    tick(now) {
      if (stopped) return;
      while (queue.length && queue[0].at <= now) queue.shift().fn();
      if (scenarios < maxScenarios && now >= nextSpawn) {
        if (planScenario(now)) nextSpawn = now + sc(range(rng, spawnEveryMs[0], spawnEveryMs[1]));
        else nextSpawn = now + 1000;
      }
    },
    /** Give one agent a task right now (used by the "Give a task" button). */
    assign(agentId, now) {
      const agent = getRoster().agents.find((a) => a.id === agentId);
      if (!agent || busy.has(agentId)) return false;
      scenarios += 1;
      const taskId = beginTask(agent.id, pick(rng, TASKS), now);
      const end = planWorker(agent, now);
      endTask(taskId, end + 60);
      schedule(end + 100, () => (scenarios -= 1));
      return true;
    },
    setSpeed(v) {
      speed = Math.max(0.25, Math.min(8, v));
    },
    stop() {
      stopped = true;
      queue = [];
    },
    get pending() {
      return queue.length;
    },
  };
}
