// Grid path finding with a small turn penalty so walkers prefer straight
// lines over staircase zig-zags. 4-directional, no diagonals.

const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const TURN_PENALTY = 0.35;

class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(cost, value) {
    const a = this.a;
    a.push([cost, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Find a path on a grid.
 * @param {{w:number,h:number,isWalkable:(x:number,y:number)=>boolean}} grid
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} goal  the goal tile may be non-walkable (a seat)
 * @returns {{x:number,y:number}[]|null} steps from the tile after `start` to `goal`;
 *          `[]` when already there, `null` when unreachable.
 */
export function findPath(grid, start, goal) {
  const { w, h } = grid;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  if (!inside(start.x, start.y) || !inside(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const size = w * h * 5;
  const dist = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const idx = (x, y, d) => (y * w + x) * 5 + d;

  const heap = new MinHeap();
  const s = idx(start.x, start.y, 4);
  dist[s] = 0;
  heap.push(0, s);

  let end = -1;
  while (heap.size) {
    const [cost, cur] = heap.pop();
    if (cost > dist[cur]) continue;
    const d = cur % 5;
    const cell = (cur - d) / 5;
    const x = cell % w;
    const y = (cell - x) / w;
    if (x === goal.x && y === goal.y) {
      end = cur;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      const nx = x + DIRS[nd][0];
      const ny = y + DIRS[nd][1];
      if (!inside(nx, ny)) continue;
      const isGoal = nx === goal.x && ny === goal.y;
      if (!isGoal && !grid.isWalkable(nx, ny)) continue;
      const step = 1 + (d !== 4 && d !== nd ? TURN_PENALTY : 0);
      const ni = idx(nx, ny, nd);
      const nc = cost + step;
      if (nc < dist[ni]) {
        dist[ni] = nc;
        prev[ni] = cur;
        heap.push(nc, ni);
      }
    }
  }
  if (end < 0) return null;

  const path = [];
  for (let cur = end; cur !== s && cur >= 0; cur = prev[cur]) {
    const cell = (cur - (cur % 5)) / 5;
    path.push({ x: cell % w, y: Math.floor(cell / w) });
  }
  return path.reverse();
}

/** Flood fill reachability from a tile (used by tests and layout sanity checks). */
export function reachable(grid, start) {
  const seen = new Set();
  const stack = [start];
  seen.add(start.y * grid.w + start.x);
  while (stack.length) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
      const key = ny * grid.w + nx;
      if (seen.has(key) || !grid.isWalkable(nx, ny)) continue;
      seen.add(key);
      stack.push({ x: nx, y: ny });
    }
  }
  return seen;
}
