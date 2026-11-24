/** Seeded vault generator. Same seed, same vault, on any machine. */

import {
  bareDistance,
  compile,
  type Dir,
  DOOR,
  type Guard,
  H,
  judge,
  N,
  solve,
  stepCell,
  type Vault,
  W,
} from './engine.ts'

export type Tier = 0 | 1 | 2 | 3

export type Made = {
  vault: Vault
  par: number
  ghost: string
  /** How many moves the guards add over an empty room. */
  detour: number
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TIERS = [
  {guards: [1, 2], detour: [2, 4], walls: [5, 8]},
  {guards: [2, 3], detour: [4, 7], walls: [6, 10]},
  {guards: [3, 3], detour: [6, 10], walls: [7, 11]},
  {guards: [3, 4], detour: [8, 14], walls: [7, 12]},
] as const

export function generate(seed: number, tier: Tier): Made {
  const r = rng(seed)
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
  const cfg = TIERS[tier]
  const mid = (cfg.detour[0] + cfg.detour[1]) / 2
  let best: Made | undefined
  let bestScore = -Infinity
  let found = 0
  for (let attempt = 0; attempt < 900 && found < 30; attempt++) {
    const v = candidate(int, r, int(cfg.guards[0], cfg.guards[1]), int(cfg.walls[0], cfg.walls[1]))
    if (!v) continue
    const j = judge(v)
    if (j.problem !== 'ok' || j.par > 36) continue
    const detour = j.par - bareDistance(v)
    if (detour < 1) continue
    found++
    const plain = solve(compile(v), false)
    const bellMatters = !plain || plain.par !== j.par
    const waits = [...j.ghost].filter(ch => ch === 'W').length
    let score = -Math.abs(detour - mid) * 2
    if (detour >= cfg.detour[0] && detour <= cfg.detour[1]) score += 4
    if (bellMatters) score += 3
    score -= Math.max(0, waits - 2) * 1.5
    if (score > bestScore) {
      bestScore = score
      best = {vault: v, par: j.par, ghost: j.ghost, detour}
    }
  }
  if (best) return best
  // Vanishingly unlikely, but a vault must always exist: an empty room.
  const walls = new Array<boolean>(N).fill(false)
  const v: Vault = {walls, loot: 3, guards: [{path: [8, 9, 10, 11, 12], dir: 1}]}
  const j = judge(v)
  return {vault: v, par: j.par, ghost: j.ghost, detour: j.par - 12}
}

function candidate(
  int: (lo: number, hi: number) => number,
  r: () => number,
  guardCount: number,
  wallCount: number,
): Vault | undefined {
  const walls = new Array<boolean>(N).fill(false)
  const keep = new Set([DOOR, DOOR - W])
  let placed = 0
  for (let tries = 0; tries < 40 && placed < wallCount; tries++) {
    let c = int(0, N - 1)
    const d = int(0, 3)
    const len = int(1, 3)
    for (let i = 0; i < len && placed < wallCount; i++) {
      if (c === -1 || keep.has(c) || walls[c]) break
      walls[c] = true
      placed++
      c = stepCell(c, d)
    }
  }
  const dist = flood(walls)
  for (let c = 0; c < N; c++) if (!walls[c] && dist[c] === -1) return undefined
  const far: number[] = []
  for (let c = 0; c < N; c++) if (!walls[c] && dist[c]! >= 5) far.push(c)
  if (!far.length) return undefined
  const loot = far[int(0, far.length - 1)]!
  const taken = new Set<number>([DOOR, DOOR - W, loot])
  const guards: Guard[] = []
  for (let g = 0; g < guardCount; g++) {
    let made: Guard | undefined
    for (let tries = 0; tries < 30 && !made; tries++) {
      const kind = r()
      const free = (c: number): boolean => c !== -1 && !walls[c] && !taken.has(c)
      if (kind < 0.5) {
        const d = int(0, 3)
        const want = int(3, 5)
        let c = int(0, N - 1)
        const path: number[] = []
        while (path.length < want && free(c)) {
          path.push(c)
          c = stepCell(c, d)
        }
        if (path.length >= 3) made = {path, dir: d as Dir}
      } else if (kind < 0.9) {
        const w = int(2, 3)
        const h = int(2, 3)
        const x0 = int(0, W - w)
        const y0 = int(0, H - h)
        const ring: number[] = []
        for (let x = 0; x < w; x++) ring.push(x0 + x + y0 * W)
        for (let y = 1; y < h; y++) ring.push(x0 + w - 1 + (y0 + y) * W)
        for (let x = w - 2; x >= 0; x--) ring.push(x0 + x + (y0 + h - 1) * W)
        for (let y = h - 2; y >= 1; y--) ring.push(x0 + (y0 + y) * W)
        if (!ring.every(free)) continue
        const start = int(0, ring.length - 1)
        let path = [...ring.slice(start), ...ring.slice(0, start)]
        if (r() < 0.5) path = [path[0]!, ...path.slice(1).reverse()]
        made = {path, dir: 0}
      } else {
        const c = int(0, N - 1)
        const d = int(0, 3)
        const a = stepCell(c, d)
        if (free(c) && a !== -1 && !walls[a] && stepCell(a, d) !== -1)
          made = {path: [c], dir: d as Dir}
      }
    }
    if (!made) return undefined
    for (const c of made.path) taken.add(c)
    guards.push(made)
  }
  return {walls, loot, guards}
}

function flood(walls: boolean[]): Int16Array {
  const dist = new Int16Array(N).fill(-1)
  dist[DOOR] = 0
  const q = [DOOR]
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!
    for (let d = 0; d < 4; d++) {
      const b = stepCell(a, d)
      if (b === -1 || walls[b] || dist[b] !== -1) continue
      dist[b] = dist[a]! + 1
      q.push(b)
    }
  }
  return dist
}

// --- The calendar ----------------------------------------------------------

/** Vault No. 1 opened on this UTC day. */
export const EPOCH_MS = Date.UTC(2026, 10, 13)

export function dayNumber(nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - EPOCH_MS) / 86_400_000) + 1)
}

/** Monday is gentle, the weekend bites. */
export function tierForDay(day: number): Tier {
  const weekday = new Date(EPOCH_MS + (day - 1) * 86_400_000).getUTCDay()
  return ([3, 0, 1, 1, 2, 2, 3] as const)[weekday]!
}

export function dailyVault(day: number): Made {
  return generate(0x9e3779b1 ^ Math.imul(day, 2654435761), tierForDay(day))
}

// --- Names -----------------------------------------------------------------
// Player vaults are labelled from these lists only. No free text anywhere.

export const NAME_A = [
  'Velvet', 'Crooked', 'Quiet', 'Gilded', 'Midnight', 'Paper', 'Hollow',
  'Lucky', 'Patient', 'Borrowed', 'Seventh', 'Sleeping', 'Brass', 'Folded',
  'Honest', 'Last', 'Little', 'Painted', 'Restless', 'Salted', 'Tin',
  'Unlikely', 'Wandering', 'Double',
] as const

export const NAME_B = [
  'Ledger', 'Lantern', 'Magpie', 'Parlour', 'Clockwork', 'Mezzanine',
  'Pantry', 'Teacup', 'Staircase', 'Counting House', 'Keyhole', 'Attic',
  'Envelope', 'Gallery', 'Cellar', 'Corridor', 'Birdcage', 'Archive',
  'Cabinet', 'Chandelier', 'Bookshelf', 'Deposit', 'Mousetrap', 'Skylight',
] as const

export const EMBLEMS = ['gem', 'crown', 'vase', 'key', 'pearl', 'coin', 'egg', 'bell'] as const

export type Label = {a: number; b: number; e: number}

export function labelText(l: Label): string {
  return `The ${NAME_A[l.a % NAME_A.length]} ${NAME_B[l.b % NAME_B.length]}`
}

export function labelForSeed(seed: number): Label {
  const r = rng(seed ^ 0x51f15e)
  return {
    a: Math.floor(r() * NAME_A.length),
    b: Math.floor(r() * NAME_B.length),
    e: Math.floor(r() * EMBLEMS.length),
  }
}

export function validLabel(l: unknown): l is Label {
  if (typeof l !== 'object' || l === null) return false
  const {a, b, e} = l as Record<string, unknown>
  const ok = (n: unknown, max: number): boolean =>
    Number.isInteger(n) && (n as number) >= 0 && (n as number) < max
  return ok(a, NAME_A.length) && ok(b, NAME_B.length) && ok(e, EMBLEMS.length)
}

/** The three teaching vaults: no guard, one guard to wait for, one bell to dodge. */
export const LESSON_CODES = ['AAISkIAAA.0o', 'AAAAwdAAA.0h.0nLL', 'AEBAgIAAA.0h.0or'] as const
