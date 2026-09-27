/** Bounded, cached locomotion over the existing read-only collision port.
 * Combat sight and aim remain independent. A floor is relative to current feet,
 * so an upstairs slab cannot close a ground-floor doorway. */
import type { Vec3, WorldQuery } from './events';

export const BOT_BODY_HALF_WIDTH = .3;
export const BOT_BODY_HEIGHT = 1.78;
export const BOT_WALK_STEP = .38;
export const BOT_PATH_NODE_LIMIT = 768;
export const BOT_PATH_RETRY_SECONDS = 1;
const GRID = .5;
const SAMPLE = .15;
const MAX_MOVE_SAMPLES = 32;
type Solids = NonNullable<WorldQuery['solids']>;
interface Node extends Vec3 { ix: number; iz: number; cost: number; rank: number; parent: Node | null }
interface Route { world: WorldQuery; life: number; gx: number; gz: number; points: Vec3[]; cursor: number; retry: number }
const routes = new WeakMap<object, Route>();
const metrics = { plans: 0, expanded: 0, maxExpanded: 0, routeSteps: 0, occupancyTests: 0 };
/** Observation only: does not plan, reset caches or move any actor. */
export function botNavigationStats(): Readonly<typeof metrics> { return { ...metrics }; }

function ground(solids: Solids, x: number, z: number, feet: number): number {
  let top = 0;
  for (const c of solids) {
    if (x + BOT_BODY_HALF_WIDTH <= c.min.x || x - BOT_BODY_HALF_WIDTH >= c.max.x
      || z + BOT_BODY_HALF_WIDTH <= c.min.z || z - BOT_BODY_HALF_WIDTH >= c.max.z) continue;
    if (c.max.y <= feet + BOT_WALK_STEP + .001 && c.max.y > top) top = c.max.y;
  }
  return top;
}
function clear(solids: Solids, p: Vec3): boolean {
  metrics.occupancyTests++;
  for (const c of solids) {
    if (p.x + BOT_BODY_HALF_WIDTH <= c.min.x || p.x - BOT_BODY_HALF_WIDTH >= c.max.x
      || p.z + BOT_BODY_HALF_WIDTH <= c.min.z || p.z - BOT_BODY_HALF_WIDTH >= c.max.z) continue;
    if (p.y + BOT_BODY_HEIGHT > c.min.y && p.y + .02 < c.max.y) return false;
  }
  return true;
}
function sweptClear(solids: Solids, from: Vec3, to: Vec3): boolean {
  // Step up first, like Player.moveAxis. Sweep the full horizontal footprint;
  // endpoint tests alone miss short diagonal grazes around a thin corner.
  const y = Math.max(from.y, to.y), dx = to.x - from.x, dz = to.z - from.z;
  for (const c of solids) {
    if (y + BOT_BODY_HEIGHT <= c.min.y || y + .02 >= c.max.y) continue;
    let near = 0, far = 1;
    for (const axis of ['x', 'z'] as const) {
      const origin = from[axis], delta = axis === 'x' ? dx : dz;
      const lo = c.min[axis] - BOT_BODY_HALF_WIDTH + 1e-9;
      const hi = c.max[axis] + BOT_BODY_HALF_WIDTH - 1e-9;
      if (delta === 0) { if (origin < lo || origin > hi) { near = 2; break; } continue; }
      let a = (lo - origin) / delta, b = (hi - origin) / delta;
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) break;
    }
    if (near <= far) return false;
  }
  return true;
}
/** Short substeps resolve relative floor changes. Each also sweeps the complete
 * body footprint, then checks destination headroom and bounds. */
export function botWalkSegment(world: WorldQuery, from: Vec3, x: number, z: number): Vec3 | null {
  const solids = world.solids;
  if (!solids) return null;
  const distance = Math.hypot(x - from.x, z - from.z);
  const count = Math.max(1, Math.ceil(distance / SAMPLE));
  if (!Number.isFinite(distance) || count > MAX_MOVE_SAMPLES) return null;
  let p: Vec3 = from;
  for (let i = 1; i <= count; i++) {
    const nx = from.x + (x - from.x) * i / count, nz = from.z + (z - from.z) * i / count;
    if (!world.inBounds(nx - BOT_BODY_HALF_WIDTH, nz - BOT_BODY_HALF_WIDTH)
      || !world.inBounds(nx + BOT_BODY_HALF_WIDTH, nz + BOT_BODY_HALF_WIDTH)) return null;
    const ny = ground(solids, nx, nz, p.y);
    const next = { x: nx, y: ny, z: nz };
    if (ny - p.y > BOT_WALK_STEP + .001 || !clear(solids, next) || !sweptClear(solids, p, next)) return null;
    p = next;
  }
  return p;
}

function plan(world: WorldQuery, start: Vec3, gx: number, gz: number): Vec3[] {
  metrics.plans++;
  const open: Node[] = [];
  const seen = new Map<string, number>();
  const key = (n: Node): string => `${n.ix},${n.iz},${Math.round(n.y * 100)}`;
  const push = (n: Node): void => {
    open.push(n); let i = open.length - 1;
    while (i > 0) { const up = (i - 1) >> 1; if (open[up]!.rank <= n.rank) break; open[i] = open[up]!; i = up; }
    open[i] = n;
  };
  const pop = (): Node => {
    const best = open[0]!, last = open.pop()!;
    if (open.length) {
      let i = 0;
      while (i * 2 + 1 < open.length) {
        let child = i * 2 + 1;
        if (child + 1 < open.length && open[child + 1]!.rank < open[child]!.rank) child++;
        if (last.rank <= open[child]!.rank) break;
        open[i] = open[child]!; i = child;
      }
      open[i] = last;
    }
    return best;
  };
  const first: Node = { ...start, ix: 0, iz: 0, cost: 0, rank: Math.hypot(gx - start.x, gz - start.z), parent: null };
  seen.set(key(first), 0); push(first);
  let expanded = 0, result: Vec3[] = [];
  while (open.length && expanded < BOT_PATH_NODE_LIMIT) {
    const current = pop(), currentKey = key(current);
    if (current.cost > (seen.get(currentKey) ?? Infinity)) continue;
    expanded++;
    const remaining = Math.hypot(gx - current.x, gz - current.z);
    if (remaining <= GRID * 1.5) {
      const end = botWalkSegment(world, current, gx, gz);
      if (end) {
        result = [end]; let n: Node | null = current;
        while (n?.parent) { result.push({ x: n.x, y: n.y, z: n.z }); n = n.parent; }
        result.reverse(); break;
      }
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const ix = current.ix + dx, iz = current.iz + dz;
      const p = botWalkSegment(world, current, start.x + ix * GRID, start.z + iz * GRID);
      if (!p) continue;
      const cost = current.cost + Math.hypot(dx, dz) * GRID + Math.abs(p.y - current.y);
      const next: Node = { ...p, ix, iz, cost, rank: cost + Math.hypot(gx - p.x, gz - p.z), parent: current };
      const k = key(next);
      if (cost >= (seen.get(k) ?? Infinity)) continue;
      if (!seen.has(k) && seen.size >= BOT_PATH_NODE_LIMIT) continue;
      seen.set(k, cost); push(next);
    }
  }
  metrics.expanded += expanded; metrics.maxExpanded = Math.max(metrics.maxExpanded, expanded);
  return result;
}

/** Called only for movement aligned with its patrol/scavenge goal. An engaged
 * strafe cannot accidentally inherit a patrol route. Failure backs off for one
 * simulated second; successful routes are reused and revalidated at each step. */
export function botDetour(key: object, world: WorldQuery, from: Vec3, gx: number, gz: number,
  distance: number, dt: number, blocked: boolean, life: number): Vec3 | null {
  let route = routes.get(key);
  if (!route || route.world !== world || route.life !== life || route.gx !== gx || route.gz !== gz) {
    route = { world, life, gx, gz, points: [], cursor: 0, retry: 0 }; routes.set(key, route);
  }
  route.retry = Math.max(0, route.retry - dt);
  const follow = (): Vec3 | null => {
    while (route!.cursor < route!.points.length) {
      const p = route!.points[route!.cursor]!, d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d < .02) { route!.cursor++; continue; }
      const amount = Math.min(distance, d);
      const next = botWalkSegment(world, from, from.x + (p.x - from.x) / d * amount, from.z + (p.z - from.z) / d * amount);
      if (next) { metrics.routeSteps++; return next; }
      route!.points = []; route!.cursor = 0; return null;
    }
    return null;
  };
  const next = follow();
  if (next) return next;
  if (!blocked || route.retry > 0) return null;
  route.retry = BOT_PATH_RETRY_SECONDS;
  route.points = plan(world, from, gx, gz); route.cursor = 0;
  return follow();
}

export function clearBotDetour(key: object): void { routes.delete(key); }
