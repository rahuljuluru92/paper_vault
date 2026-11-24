/**
 * Everything persistent lives in Redis. Key map:
 *
 *   v:{vid}        hash   a vault: code, par, ghost, label, author, counters
 *   vaults         zset   listed house + player vaults, scored by time made
 *   by:{uid}       zset   vaults a player made
 *   codes          hash   vault code -> vault id, to refuse duplicates
 *   r:{vid}        hash   uid -> "name|moves", first job per player (expires)
 *   rz:{vid}       zset   uid scored by move count, for replays (expires)
 *   h:{vid}        hash   moves over the ghost line -> crews
 *   rep:{vid}      zset   uids who reported the vault
 *   u:{uid}        hash   name, streak, last daily, warm-up flag, sound-off flag (expires)
 *   u:{uid}:ran    zset   vault ids the player has a job on (expires)
 *   users          zset   uid scored by last seen, for the deleted-account sweep
 *   cutters        zset   uid scored by designer marks
 *   post:{t3}      hash   day, pinned comment id
 *   day:{n}        string post id for that day's vault
 *   cmt:{t1}       string "uid|vid" for a result comment (expires)
 */

import {redis} from '@devvit/web/server'
import {
  type Cutter,
  HIST_BUCKETS,
  LEVELS,
  type Me,
  type Replay,
  type Result,
  type Seal,
  type VaultCard,
} from '../shared/api.ts'
import {encodeVault} from '../shared/engine.ts'
import {dailyVault, generate, type Label, labelForSeed, type Made, type Tier} from '../shared/gen.ts'

const DAY_S = 86_400
const RUN_TTL = 120 * DAY_S
const USER_TTL = 180 * DAY_S
export const SEAL_MIN_RUNS = 3
export const REPORTS_TO_HIDE = 3
export const MAX_LIVE_VAULTS = 12
export const MAX_PUBLISH_PER_DAY = 3

export type Stored = {
  id: string
  code: string
  par: number
  ghost: string
  label: Label
  day: number
  author: string
  authorName: string
  detour: number
  runs: number
  ghosts: number
  hidden: boolean
  ts: number
}

function parseVault(id: string, h: Record<string, string>): Stored | undefined {
  if (!h.code) return undefined
  return {
    id,
    code: h.code,
    par: Number(h.par),
    ghost: h.ghost ?? '',
    label: {a: Number(h.a), b: Number(h.b), e: Number(h.e)},
    day: Number(h.day ?? 0),
    author: h.author ?? '',
    authorName: h.authorName ?? '',
    detour: Number(h.detour ?? 0),
    runs: Number(h.runs ?? 0),
    ghosts: Number(h.ghosts ?? 0),
    hidden: h.hidden === '1',
    ts: Number(h.ts ?? 0),
  }
}

export async function getVault(id: string): Promise<Stored | undefined> {
  if (!/^[dhc][0-9a-z]{1,10}$/.test(id)) return undefined
  const h = await redis.hGetAll(`v:${id}`)
  const v = parseVault(id, h)
  if (v) return v
  if (id[0] === 'd') {
    const day = Number(id.slice(1))
    if (Number.isInteger(day) && day >= 1 && day < 100_000) return makeDaily(day)
  }
  return undefined
}

/** Dailies come from the date, and are pinned in Redis the first time they are asked for. */
export async function makeDaily(day: number): Promise<Stored> {
  const id = `d${day}`
  const m = dailyVault(day)
  const label = labelForSeed(day * 7919)
  const fields = {
    code: encodeVault(m.vault),
    par: `${m.par}`,
    ghost: m.ghost,
    a: `${label.a}`,
    b: `${label.b}`,
    e: `${label.e}`,
    day: `${day}`,
    detour: `${m.detour}`,
    ts: `${Date.now()}`,
  }
  await redis.hSet(`v:${id}`, fields)
  return parseVault(id, fields)!
}

/** The ladder: twelve house vaults, three per tier, climbed in order. */
const HOUSE: {seed: number; tier: Tier}[] = [
  {seed: 101, tier: 0}, {seed: 202, tier: 0}, {seed: 1313, tier: 0},
  {seed: 303, tier: 1}, {seed: 404, tier: 1}, {seed: 505, tier: 1},
  {seed: 606, tier: 2}, {seed: 707, tier: 2}, {seed: 808, tier: 2},
  {seed: 909, tier: 3}, {seed: 1010, tier: 3}, {seed: 1414, tier: 3},
]

/** Every rung is harder than the last: by tier, then guard count, then how far the guards push you off the straight line. */
export function ladder(): {seed: number; made: Made}[] {
  return HOUSE.map(h => ({...h, made: generate(h.seed, h.tier)}))
    .sort(
      (x, y) =>
        x.tier - y.tier ||
        x.made.vault.guards.length - y.made.vault.guards.length ||
        x.made.detour - y.made.detour ||
        x.made.par - y.made.par,
    )
}

export const levelOf = (id: string): number => (id[0] === 'h' ? Number(id.slice(1)) : 0)

/** Seeds the ladder so the shelf is never bare. Safe to call again. */
export async function seedHouse(): Promise<void> {
  const now = Date.now()
  if (await redis.hGet(`v:h${LEVELS}`, 'code')) return
  const rungs = ladder()
  for (let i = 0; i < rungs.length; i++) {
    const id = `h${i + 1}`
    if (await redis.hGet(`v:${id}`, 'code')) continue
    const m = rungs[i]!.made
    const label = labelForSeed(rungs[i]!.seed)
    const code = encodeVault(m.vault)
    await redis.hSet(`v:${id}`, {
      code,
      par: `${m.par}`,
      ghost: m.ghost,
      a: `${label.a}`,
      b: `${label.b}`,
      e: `${label.e}`,
      detour: `${m.detour}`,
      ts: `${now - i * 1000}`,
    })
    await redis.hSet('codes', {[code]: id})
    await redis.zAdd('vaults', {member: id, score: now - i * 1000})
  }
}

export function sealFor(v: Stored): Seal {
  if (v.runs < SEAL_MIN_RUNS) return 'new'
  const r = v.ghosts / v.runs
  if (r > 0.8) return 'soft'
  if (r < 0.1) return 'fiend'
  if (r >= 0.25 && r <= 0.6) return 'well'
  return 'fair'
}

/** 1 in the sweet spot, sliding to 0 when everyone or no one finds the ghost line. */
export function quality(runs: number, ghosts: number): number {
  if (runs < SEAL_MIN_RUNS) return 0
  const r = ghosts / runs
  if (r < 0.25) return r / 0.25
  if (r > 0.6) return (1 - r) / 0.4
  return 1
}

export function toCard(
  v: Stored,
  uid: string | undefined,
  myMoves: number | undefined,
): VaultCard {
  return {
    id: v.id,
    code: v.code,
    label: v.label,
    day: v.day,
    level: levelOf(v.id),
    by: v.authorName,
    mine: !!uid && v.author === uid,
    runs: v.runs,
    seal: sealFor(v),
    est: v.detour <= 3 ? 0 : v.detour <= 7 ? 1 : 2,
    my: myMoves === undefined ? undefined : {moves: myMoves, par: v.par},
  }
}

// --- Players ---------------------------------------------------------------

export async function touchUser(uid: string, name: string): Promise<void> {
  await redis.hSet(`u:${uid}`, {name})
  await redis.expire(`u:${uid}`, USER_TTL)
  await redis.zAdd('users', {member: uid, score: Date.now()})
}

export async function getMe(uid: string | undefined, name: string | undefined): Promise<Me> {
  if (!uid) return {name: '', signedIn: false, warmedUp: false, quiet: false, streak: 0, marks: 0}
  const [h, marks] = await Promise.all([redis.hGetAll(`u:${uid}`), redis.zScore('cutters', uid)])
  return {
    name: name ?? h.name ?? '',
    signedIn: true,
    warmedUp: h.warm === '1',
    quiet: h.quiet === '1',
    streak: Number(h.streak ?? 0),
    marks: Math.round(marks ?? 0),
  }
}

export async function setWarmedUp(uid: string): Promise<void> {
  await redis.hSet(`u:${uid}`, {warm: '1'})
  await redis.expire(`u:${uid}`, USER_TTL)
}

export async function setQuiet(uid: string, quiet: boolean): Promise<void> {
  await redis.hSet(`u:${uid}`, {quiet: quiet ? '1' : '0'})
  await redis.expire(`u:${uid}`, USER_TTL)
}

export async function myMovesOn(uid: string | undefined, vid: string): Promise<string | undefined> {
  if (!uid) return undefined
  const raw = await redis.hGet(`r:${vid}`, uid)
  return raw ? raw.slice(raw.indexOf('|') + 1) : undefined
}

// --- Jobs ------------------------------------------------------------------

/**
 * Records a player's first job on a vault. Returns false if they already had
 * one. Also pays the designer and keeps the daily streak.
 */
export async function recordRun(
  v: Stored,
  uid: string,
  name: string,
  moves: string,
  today: number,
): Promise<boolean> {
  const fresh = await redis.hSetNX(`r:${v.id}`, uid, `${name}|${moves}`)
  if (!fresh) return false
  const n = moves.length
  const over = Math.min(HIST_BUCKETS - 1, n - v.par)
  const ghost = n <= v.par
  const now = Date.now()
  await Promise.all([
    redis.zAdd(`rz:${v.id}`, {member: uid, score: n + (now % 1e9) / 1e10}),
    redis.hIncrBy(`h:${v.id}`, `${over}`, 1),
    redis.hIncrBy(`v:${v.id}`, 'runs', 1),
    ghost ? redis.hIncrBy(`v:${v.id}`, 'ghosts', 1) : Promise.resolve(0),
    redis.zAdd(`u:${uid}:ran`, {member: v.id, score: now}),
  ])
  await Promise.all([
    redis.expire(`r:${v.id}`, RUN_TTL),
    redis.expire(`rz:${v.id}`, RUN_TTL),
    redis.expire(`u:${uid}:ran`, USER_TTL),
  ])
  if (v.day && v.day === today) {
    const h = await redis.hGetAll(`u:${uid}`)
    const last = Number(h.last ?? 0)
    const streak = last === today - 1 ? Number(h.streak ?? 0) + 1 : last === today ? Number(h.streak ?? 1) : 1
    await redis.hSet(`u:${uid}`, {last: `${today}`, streak: `${streak}`})
  }
  if (v.author && v.author !== uid) {
    const runs = v.runs + 1
    const ghosts = v.ghosts + (ghost ? 1 : 0)
    const pay = 1 + Math.round(4 * quality(runs, ghosts))
    await redis.zIncrBy('cutters', v.author, pay)
  }
  return true
}

export async function buildResult(
  v: Stored,
  uid: string | undefined,
  recorded: string,
  first: boolean,
  saved: boolean,
): Promise<Result> {
  const [histRaw, top, user] = await Promise.all([
    redis.hGetAll(`h:${v.id}`),
    redis.zRange(`rz:${v.id}`, 0, 5, {by: 'rank'}),
    uid ? redis.hGetAll(`u:${uid}`) : Promise.resolve({} as Record<string, string>),
  ])
  const hist = new Array<number>(HIST_BUCKETS).fill(0)
  let runs = 0
  for (const [k, n] of Object.entries(histRaw)) {
    const i = Number(k)
    if (i >= 0 && i < HIST_BUCKETS) {
      hist[i] = Number(n)
      runs += Number(n)
    }
  }
  const others = top.map(t => t.member).filter(m => m !== uid).slice(0, 4)
  const replays: Replay[] = []
  if (others.length) {
    const raws = await redis.hMGet(`r:${v.id}`, others)
    for (const raw of raws) {
      if (!raw) continue
      const cut = raw.indexOf('|')
      replays.push({name: raw.slice(0, cut), moves: raw.slice(cut + 1)})
    }
  }
  return {
    vaultId: v.id,
    moves: recorded,
    par: v.par,
    ghost: v.ghost,
    first,
    saved,
    hist,
    runs,
    streak: Number(user.streak ?? 0),
    replays,
    shared: !!(uid && user[`s:${v.id}`]),
  }
}

// --- The shelf -------------------------------------------------------------

export async function listVaults(uid: string | undefined): Promise<VaultCard[]> {
  const recent = (await redis.zRange('vaults', 0, 47, {by: 'rank', reverse: true})).map(m => m.member)
  // The ladder is always listed, however many player vaults pile up.
  const rungs = Array.from({length: LEVELS}, (_, i) => `h${i + 1}`)
  const ids = [...recent.filter(id => id[0] !== 'h'), ...rungs]
  const [vaults, ran] = await Promise.all([
    Promise.all(ids.map(id => redis.hGetAll(`v:${id}`).then(h => parseVault(id, h)))),
    uid ? redis.zRange(`u:${uid}:ran`, 0, -1, {by: 'rank'}) : Promise.resolve([]),
  ])
  const played = new Set(ran.map(r => r.member))
  const live = vaults.filter((v): v is Stored => !!v && !v.hidden)
  const mine = await Promise.all(
    live.map(v => (played.has(v.id) ? myMovesOn(uid, v.id) : Promise.resolve(undefined))),
  )
  const cards = live.map((v, i) => toCard(v, uid, mine[i]?.length))
  // Unplayed first: the ladder in order, then player-made, newest first.
  const rank = (c: VaultCard): number => (c.my ? 2 : c.level ? 0 : 1)
  return cards
    .map((c, i) => ({c, i}))
    .sort((x, y) => rank(x.c) - rank(y.c) || x.i - y.i)
    .map(x => x.c)
}

export async function topCutters(): Promise<Cutter[]> {
  const top = await redis.zRange('cutters', 0, 4, {by: 'rank', reverse: true})
  const names = await Promise.all(top.map(t => redis.hGet(`u:${t.member}`, 'name')))
  return top
    .map((t, i) => ({name: names[i] ?? '', marks: Math.round(t.score)}))
    .filter(c => c.name && c.marks > 0)
}

export type PublishOutcome = {id: string} | {problem: 'duplicate' | 'limit' | 'full'}

export async function publishVault(
  uid: string,
  name: string,
  code: string,
  par: number,
  ghost: string,
  detour: number,
  label: Label,
  today: number,
): Promise<PublishOutcome> {
  if (await redis.hGet('codes', code)) return {problem: 'duplicate'}
  if ((await redis.zCard(`by:${uid}`)) >= MAX_LIVE_VAULTS) return {problem: 'full'}
  const quota = `pub:${uid}:${today}`
  const made = await redis.incrBy(quota, 1)
  await redis.expire(quota, 2 * DAY_S)
  if (made > MAX_PUBLISH_PER_DAY) return {problem: 'limit'}
  const id = `c${(await redis.incrBy('vault:seq', 1)).toString(36)}`
  const now = Date.now()
  await redis.hSet(`v:${id}`, {
    code,
    par: `${par}`,
    ghost,
    a: `${label.a}`,
    b: `${label.b}`,
    e: `${label.e}`,
    author: uid,
    authorName: name,
    detour: `${detour}`,
    ts: `${now}`,
  })
  await Promise.all([
    redis.hSet('codes', {[code]: id}),
    redis.zAdd('vaults', {member: id, score: now}),
    redis.zAdd(`by:${uid}`, {member: id, score: now}),
  ])
  return {id}
}

export async function deleteVault(v: Stored): Promise<void> {
  await Promise.all([
    redis.del(`v:${v.id}`, `r:${v.id}`, `rz:${v.id}`, `h:${v.id}`, `rep:${v.id}`),
    redis.zRem('vaults', [v.id]),
    redis.hDel('codes', [v.code]),
    v.author ? redis.zRem(`by:${v.author}`, [v.id]) : Promise.resolve(0),
  ])
}

/** Returns true when the report tipped the vault off the shelf. */
export async function reportVault(v: Stored, uid: string): Promise<boolean> {
  await redis.zAdd(`rep:${v.id}`, {member: uid, score: Date.now()})
  if ((await redis.zCard(`rep:${v.id}`)) < REPORTS_TO_HIDE) return false
  await redis.hSet(`v:${v.id}`, {hidden: '1'})
  await redis.zRem('vaults', [v.id])
  return true
}

// --- Posts and comments ----------------------------------------------------

export async function savePost(t3: string, day: number, sticky: string): Promise<void> {
  await redis.hSet(`post:${t3}`, {day: `${day}`, sticky})
  await redis.set(`day:${day}`, t3)
}

export const postForDay = (day: number): Promise<string | undefined> => redis.get(`day:${day}`)

export async function stickyFor(t3: string): Promise<string | undefined> {
  return (await redis.hGet(`post:${t3}`, 'sticky')) || undefined
}

export async function saveShare(uid: string, vid: string, t1: string): Promise<void> {
  await redis.hSet(`u:${uid}`, {[`s:${vid}`]: t1})
  await redis.set(`cmt:${t1}`, `${uid}|${vid}`)
  await redis.expire(`cmt:${t1}`, RUN_TTL)
}

export async function forgetPost(t3: string): Promise<void> {
  const h = await redis.hGetAll(`post:${t3}`)
  if (h.day && (await redis.get(`day:${h.day}`)) === t3) await redis.del(`day:${h.day}`)
  if (h.sticky) await redis.del(`cmt:${h.sticky}`)
  await redis.del(`post:${t3}`)
}

export async function forgetComment(t1: string, t3: string): Promise<void> {
  const owner = await redis.get(`cmt:${t1}`)
  if (owner) {
    const [uid, vid] = owner.split('|')
    if (uid && vid) await redis.hDel(`u:${uid}`, [`s:${vid}`])
    await redis.del(`cmt:${t1}`)
  }
  if (t3 && (await redis.hGet(`post:${t3}`, 'sticky')) === t1)
    await redis.hSet(`post:${t3}`, {sticky: ''})
}

/** Removes every trace of a player: jobs, replays, vaults, marks, profile. */
export async function forgetUser(uid: string): Promise<void> {
  const [ran, made, profile] = await Promise.all([
    redis.zRange(`u:${uid}:ran`, 0, -1, {by: 'rank'}),
    redis.zRange(`by:${uid}`, 0, -1, {by: 'rank'}),
    redis.hGetAll(`u:${uid}`),
  ])
  for (const {member: vid} of ran) {
    await redis.hDel(`r:${vid}`, [uid])
    await redis.zRem(`rz:${vid}`, [uid])
  }
  for (const {member: vid} of made) {
    const v = await getVault(vid)
    if (v) await deleteVault(v)
  }
  for (const [k, t1] of Object.entries(profile)) if (k.startsWith('s:')) await redis.del(`cmt:${t1}`)
  await Promise.all([
    redis.del(`u:${uid}`, `u:${uid}:ran`, `by:${uid}`),
    redis.zRem('cutters', [uid]),
    redis.zRem('users', [uid]),
  ])
}

/** The players seen longest ago, for the deleted-account sweep. */
export async function stalestUsers(count: number): Promise<string[]> {
  return (await redis.zRange('users', 0, count - 1, {by: 'rank'})).map(m => m.member)
}

export async function markChecked(uid: string): Promise<void> {
  await redis.zAdd('users', {member: uid, score: Date.now()})
}
