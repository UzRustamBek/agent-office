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
export function createSimulator({ getRoster, emit, seed = 7, speed = 1, maxScenarios = 3, spawnEveryMs = [3500, 8000] }) {
  const rng = mulberry32(seed);
  let queue = []; // { at, fn } sorted by `at`
  let scenarios = 0;
  let nextSpawn = 0;
  let busy = new Set();
  let stopped = false;

  const sc = (ms) => Math.max(40, ms / speed);
  const schedule = (at, fn) => {
    queue.push({ at, fn });
    queue.sort((a, b) => a.at - b.at);
  };

  const status = (agent, st, activity = '', tool = null, ts) => emit({ type: 'status', agent, status: st, activity, tool, ts });

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
    });
    return t;
  }

  function planScenario(now) {
    const roster = getRoster();
    const agents = roster.agents.filter((a) => !busy.has(a.id));
    if (agents.length < 1) return false;
    scenarios += 1;
    const main = roster.office.mainAgent;
    const lead = agents.find((a) => a.id === main) || pick(rng, agents);
    const others = shuffle(rng, agents.filter((a) => a.id !== lead.id));
    const solo = others.length === 0 || rng() < 0.22;
    const task = pick(rng, TASKS);

    if (solo) {
      const end = planWorker(lead, now);
      schedule(end + 100, () => (scenarios -= 1));
      return true;
    }

    const crew = others.slice(0, 1 + Math.floor(rng() * Math.min(3, others.length)));
    busy.add(lead.id);
    let t = now;
    schedule(t, () => status(lead.id, STATUS.THINKING, `Planning: ${task}`, null, Date.now()));
    t += sc(range(rng, 1600, 2800));
    schedule(t, () => status(lead.id, STATUS.DELEGATING, `Briefing ${crew.length} agent${crew.length > 1 ? 's' : ''}`, 'Task', Date.now()));
    let latest = t;
    crew.forEach((agent, i) => {
      const at = t + sc(300 + i * 700);
      schedule(at, () => emit({ type: 'delegate', from: lead.id, to: agent.id, task, ts: Date.now() }));
      const end = planWorker(agent, at + sc(500));
      latest = Math.max(latest, end);
    });
    t = latest + sc(400);
    schedule(t, () => status(lead.id, STATUS.READING, 'Reviewing the results', 'Read', Date.now()));
    t += sc(range(rng, 1800, 3000));
    schedule(t, () => status(lead.id, STATUS.TYPING, 'Writing the summary', 'Write', Date.now()));
    t += sc(range(rng, 2200, 3800));
    schedule(t, () => {
      status(lead.id, STATUS.DONE, 'Task complete', null, Date.now());
      busy.delete(lead.id);
    });
    schedule(t + 100, () => (scenarios -= 1));
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
      const end = planWorker(agent, now);
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
