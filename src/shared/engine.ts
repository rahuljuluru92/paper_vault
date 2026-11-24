/**
 * Paper Vault rules, shared by client and server.
 *
 * A vault is a 7x7 grid with walls, one loot square, a fixed door, and up to
 * four guards. Time moves in beats. Each beat the thief steps or waits and
 * every guard advances one square along its route. Lifting the loot reverses
 * every guard for the rest of the job.
 */

export const W = 7
export const H = 7
export const N = W * H
export const DOOR = 3 + 6 * W
export const REACH = 3
export const MAX_GUARDS = 4
export const MAX_ROUTE = 10
export const MAX_MOVES = 72

/** 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3
export const DX = [0, 1, 0, -1] as const
export const DY = [-1, 0, 1, 0] as const
export const MOVE_CHARS = 'URDLW'
export type Move = 0 | 1 | 2 | 3 | 4

export type Guard = {
  /** Cells walked, each adjacent to the last. One cell means standing still. */
  path: number[]
  /** Facing, used only when standing still. */
  dir: Dir
}

export type Vault = {
  walls: boolean[]
  loot: number
  guards: Guard[]
}

export const cx = (c: number): number => c % W
export const cy = (c: number): number => (c / W) | 0

export function stepCell(c: number, d: number): number {
  const x = cx(c) + DX[d as Dir]
  const y = cy(c) + DY[d as Dir]
  return x < 0 || y < 0 || x >= W || y >= H ? -1 : x + y * W
}

export function dirBetween(a: number, b: number): Dir | -1 {
  for (let d = 0; d < 4; d++) if (stepCell(a, d) === b) return d as Dir
  return -1
}

export type Cycle = {cells: number[]; period: number; loop: boolean}

/** A route that ends beside its start is a loop; otherwise back-and-forth. */
export function cycleOf(g: Guard): Cycle {
  const p = g.path
  const n = p.length
  if (n <= 1) return {cells: p.slice(), period: 1, loop: false}
  if (n >= 4 && dirBetween(p[n - 1]!, p[0]!) !== -1)
    return {cells: p.slice(), period: n, loop: true}
  const cells = p.slice()
  for (let i = n - 2; i >= 1; i--) cells.push(p[i]!)
  return {cells, period: cells.length, loop: false}
}

const mod = (a: number, m: number): number => ((a % m) + m) % m

export type GuardNow = {cell: number; dir: Dir; beam: number[]}

export type Compiled = {
  vault: Vault
  cycles: Cycle[]
}

export function compile(vault: Vault): Compiled {
  return {vault, cycles: vault.guards.map(cycleOf)}
}

/** Where guard `i` stands and looks at phase `k`. */
export function guardAt(
  c: Compiled,
  i: number,
  k: number,
  reversed: boolean,
): GuardNow {
  const cyc = c.cycles[i]!
  const g = c.vault.guards[i]!
  const L = cyc.period
  const cell = cyc.cells[mod(k, L)]!
  let dir: Dir
  if (L === 1) dir = (reversed ? (g.dir + 2) % 4 : g.dir) as Dir
  else {
    const next = cyc.cells[mod(reversed ? k - 1 : k + 1, L)]!
    const d = dirBetween(cell, next)
    dir = (d === -1 ? g.dir : d) as Dir
  }
  const beam: number[] = []
  let b = cell
  for (let r = 0; r < REACH; r++) {
    b = stepCell(b, dir)
    if (b === -1 || c.vault.walls[b]) break
    beam.push(b)
  }
  return {cell, dir, beam}
}

export type State = {
  pos: number
  /** Guard phase. Counts up before the grab and down after it. */
  k: number
  has: boolean
  t: number
  done: boolean
}

export const startState = (): State => ({
  pos: DOOR,
  k: 0,
  has: false,
  t: 0,
  done: false,
})

export type StepResult =
  | {ok: true; state: State}
  | {ok: false; why: 'wall' | 'guard' | 'light' | 'done'; by: number}

function seenBy(c: Compiled, pos: number, k: number, rev: boolean): number {
  for (let i = 0; i < c.cycles.length; i++) {
    const g = guardAt(c, i, k, rev)
    if (g.beam.includes(pos)) return i
  }
  return -1
}

/** Try one move from a state. Never mutates. */
export function step(c: Compiled, s: State, m: Move): StepResult {
  if (s.done) return {ok: false, why: 'done', by: -1}
  let pos = s.pos
  if (m !== 4) {
    pos = stepCell(s.pos, m)
    if (pos === -1 || c.vault.walls[pos]) return {ok: false, why: 'wall', by: -1}
  }
  const k = s.has ? s.k - 1 : s.k + 1
  for (let i = 0; i < c.cycles.length; i++) {
    const L = c.cycles[i]!.period
    const cells = c.cycles[i]!.cells
    const was = cells[mod(s.k, L)]!
    const now = cells[mod(k, L)]!
    if (now === pos) return {ok: false, why: 'guard', by: i}
    if (pos !== s.pos && was === pos && now === s.pos)
      return {ok: false, why: 'guard', by: i}
  }
  let by = seenBy(c, pos, k, s.has)
  if (by !== -1) return {ok: false, why: 'light', by}
  let has = s.has
  if (!has && pos === c.vault.loot) {
    has = true
    by = seenBy(c, pos, k, true)
    if (by !== -1) return {ok: false, why: 'light', by}
  }
  return {
    ok: true,
    state: {pos, k, has, t: s.t + 1, done: has && pos === DOOR},
  }
}

export function parseMoves(s: string): Move[] | undefined {
  const out: Move[] = []
  for (const ch of s) {
    const i = MOVE_CHARS.indexOf(ch)
    if (i === -1) return undefined
    out.push(i as Move)
  }
  return out
}

/** Replays a move string. Returns every state visited if the job is clean. */
export function simulate(c: Compiled, moves: string): State[] | undefined {
  const ms = parseMoves(moves)
  if (!ms || ms.length > MAX_MOVES) return undefined
  const states = [startState()]
  let s = states[0]!
  for (const m of ms) {
    const r = step(c, s, m)
    if (!r.ok) return undefined
    s = r.state
    states.push(s)
  }
  return s.done ? states : undefined
}

export type Solution = {par: number; moves: string}

/**
 * Breadth-first search over (square, beat, beat of the grab). Before the grab
 * the guard phase equals the beat; after a grab at beat T it is 2T - t, so
 * those three numbers describe everything.
 */
export function solve(c: Compiled, reverse = true): Solution | undefined {
  type Node = {s: State; parent: Node | undefined; m: Move}
  const first = startState()
  if (seenBy(c, first.pos, 0, false) !== -1) return undefined
  for (let i = 0; i < c.cycles.length; i++)
    if (c.cycles[i]!.cells[0] === DOOR) return undefined
  let layer: Node[] = [{s: first, parent: undefined, m: 4}]
  const seen = new Set<number>()
  const key = (s: State, grab: number): number =>
    (s.pos * (MAX_MOVES + 2) + s.t) * (MAX_MOVES + 2) + grab + 1
  const grabOf = new Map<Node, number>()
  for (let t = 0; t < MAX_MOVES && layer.length; t++) {
    const next: Node[] = []
    for (const node of layer) {
      const grab = grabOf.get(node) ?? -1
      for (let m = 0; m < 5; m++) {
        const r = reverse
          ? step(c, node.s, m as Move)
          : stepForward(c, node.s, m as Move)
        if (!r.ok) continue
        const g = r.state.has ? (grab === -1 ? r.state.t : grab) : -1
        const child: Node = {s: r.state, parent: node, m: m as Move}
        if (r.state.done) {
          let out = ''
          for (let n: Node | undefined = child; n?.parent; n = n.parent)
            out = MOVE_CHARS[n.m] + out
          return {par: r.state.t, moves: out}
        }
        const kk = key(r.state, g)
        if (seen.has(kk)) continue
        seen.add(kk)
        grabOf.set(child, g)
        next.push(child)
      }
    }
    layer = next
  }
  return undefined
}

/** The same rules without the bell, used only to judge how much it matters. */
function stepForward(c: Compiled, s: State, m: Move): StepResult {
  const r = step(c, {...s, has: false}, m)
  if (!r.ok) return r
  const has = s.has || r.state.has
  return {
    ok: true,
    state: {...r.state, has, done: has && r.state.pos === DOOR},
  }
}

/** Steps from door to loot and back with no guards at all. */
export function bareDistance(v: Vault): number {
  const dist = new Int16Array(N).fill(-1)
  dist[DOOR] = 0
  const q = [DOOR]
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!
    for (let d = 0; d < 4; d++) {
      const b = stepCell(a, d)
      if (b === -1 || v.walls[b] || dist[b] !== -1) continue
      dist[b] = dist[a]! + 1
      q.push(b)
    }
  }
  return dist[v.loot]! < 0 ? -1 : dist[v.loot]! * 2
}

export type Problem =
  | 'ok'
  | 'shape'
  | 'loot'
  | 'guards'
  | 'route'
  | 'door'
  | 'sealed'
  | 'watched'
  | 'unsolvable'
  | 'trivial'

/** Structural checks. Solvability is checked separately with `solve`. */
export function checkShape(v: Vault): Problem {
  if (!Array.isArray(v.walls) || v.walls.length !== N) return 'shape'
  if (!Number.isInteger(v.loot) || v.loot < 0 || v.loot >= N) return 'loot'
  if (v.walls[DOOR]) return 'door'
  if (v.loot === DOOR || v.walls[v.loot]) return 'loot'
  if (!Array.isArray(v.guards) || v.guards.length > MAX_GUARDS) return 'guards'
  for (const g of v.guards) {
    if (!g.path.length || g.path.length > MAX_ROUTE) return 'route'
    if (!(g.dir >= 0 && g.dir <= 3)) return 'route'
    const used = new Set<number>()
    for (let i = 0; i < g.path.length; i++) {
      const c = g.path[i]!
      if (!Number.isInteger(c) || c < 0 || c >= N) return 'route'
      if (v.walls[c] || c === DOOR || c === v.loot || used.has(c)) return 'route'
      used.add(c)
      if (i && dirBetween(g.path[i - 1]!, c) === -1) return 'route'
    }
  }
  if (bareDistance(v) < 0) return 'sealed'
  return 'ok'
}

export type Verdict = {problem: Problem; par: number; ghost: string}

export function judge(v: Vault): Verdict {
  const shape = checkShape(v)
  if (shape !== 'ok') return {problem: shape, par: 0, ghost: ''}
  const c = compile(v)
  if (seenBy(c, DOOR, 0, false) !== -1)
    return {problem: 'watched', par: 0, ghost: ''}
  const sol = solve(c)
  if (!sol) return {problem: 'unsolvable', par: 0, ghost: ''}
  return {problem: 'ok', par: sol.par, ghost: sol.moves}
}

// --- Compact text form -----------------------------------------------------
// walls: 49 bits as 9 base64url chars. loot: 2 base36 chars. Each guard:
// 2 base36 chars for the first cell, then route directions as URDL, or one
// lower-case urdl for the facing of a guard who stands still.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const c36 = (n: number): string => n.toString(36).padStart(2, '0')

export function encodeVault(v: Vault): string {
  let walls = ''
  for (let i = 0; i < 54; i += 6) {
    let n = 0
    for (let b = 0; b < 6; b++) if (v.walls[i + b]) n |= 1 << b
    walls += B64[n]
  }
  const guards = v.guards.map(g => {
    let s = c36(g.path[0]!)
    if (g.path.length === 1) return s + 'urdl'[g.dir]
    for (let i = 1; i < g.path.length; i++)
      s += 'URDL'[dirBetween(g.path[i - 1]!, g.path[i]!) as Dir]
    return s
  })
  return [walls, c36(v.loot), ...guards].join('.')
}

export function decodeVault(code: string): Vault | undefined {
  if (typeof code !== 'string' || code.length > 120) return undefined
  const parts = code.split('.')
  const wallsPart = parts[0]
  const lootPart = parts[1]
  if (!wallsPart || wallsPart.length !== 9 || !lootPart) return undefined
  const walls: boolean[] = []
  for (let i = 0; i < 9; i++) {
    const n = B64.indexOf(wallsPart[i]!)
    if (n === -1) return undefined
    for (let b = 0; b < 6; b++) if (walls.length < N) walls.push(!!(n & (1 << b)))
  }
  const loot = parseInt(lootPart, 36)
  const guards: Guard[] = []
  for (const p of parts.slice(2)) {
    if (p.length < 3) return undefined
    let cell = parseInt(p.slice(0, 2), 36)
    if (!(cell >= 0 && cell < N)) return undefined
    const path = [cell]
    let dir: Dir = 0
    const rest = p.slice(2)
    if (rest.length === 1 && 'urdl'.includes(rest)) dir = 'urdl'.indexOf(rest) as Dir
    else
      for (const ch of rest) {
        const d = 'URDL'.indexOf(ch)
        if (d === -1) return undefined
        cell = stepCell(cell, d)
        if (cell === -1) return undefined
        path.push(cell)
      }
    if (path.length > 1) dir = dirBetween(path[0]!, path[1]!) as Dir
    guards.push({path, dir})
  }
  const v: Vault = {walls, loot, guards}
  return checkShape(v) === 'ok' ? v : undefined
}
