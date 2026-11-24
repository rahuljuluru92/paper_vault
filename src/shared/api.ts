import {compile, simulate} from './engine.ts'
import {decodeVault} from './engine.ts'
import {type Label, labelText} from './gen.ts'

export type ErrorRsp = {error: string; status: number}

export type Seal = 'new' | 'soft' | 'well' | 'fiend' | 'fair'

/** A vault as shown in lists and on the board. The ghost line stays server-side until you finish. */
export type VaultCard = {
  id: string
  code: string
  label: Label
  /** Daily number, or 0 for house and player vaults. */
  day: number
  /** Place on the ladder of house vaults, 1 is the easiest; 0 for everything else. */
  level: number
  /** Designer's username; empty for house and daily vaults. */
  by: string
  mine: boolean
  runs: number
  seal: Seal
  /** Rough difficulty from the solver, 0 gentle to 2 knotty. Shown until crews have weighed in. */
  est: 0 | 1 | 2
  /** Your recorded result, if you have one. */
  my: {moves: number; par: number} | undefined
}

export type Replay = {name: string; moves: string}

export type Result = {
  vaultId: string
  /** Your recorded job on this vault. */
  moves: string
  par: number
  /** The shortest route. Empty for signed-out players, as are `replays`. */
  ghost: string
  /** False when this was a re-run and the recorded job is an earlier one. */
  first: boolean
  /** Whether the job was saved (signed-in players only). */
  saved: boolean
  /** Count of crews by moves over the ghost line; last bucket is "8 or more". */
  hist: number[]
  runs: number
  streak: number
  replays: Replay[]
  /** Marks the designer has earned from this vault's crews, for player vaults. */
  shared: boolean
}

export type Me = {
  name: string
  signedIn: boolean
  /** True once the warm-up vault has been seen. */
  warmedUp: boolean
  /** True if the player switched sound off. */
  quiet: boolean
  /** True if the player chose to wear their record as subreddit flair. */
  flair: boolean
  /** True once the player joined the subreddit from the result card. */
  joined: boolean
  /** Nights in a row with a daily job; 0 once a night is missed. */
  streak: number
  marks: number
}

export type InitRsp = {
  me: Me
  today: number
  daily: VaultCard
  /** Set when this post holds an older vault and today's lives elsewhere. */
  todayUrl: string | undefined
  canPostAsUser: boolean
  /** The subreddit this post lives in, without "r/". */
  sub: string
}

/** The flair text now on the player, or empty once it is taken off. */
export type FlairRsp = {text: string}

export type Cutter = {name: string; marks: number}

export type VaultsRsp = {
  vaults: VaultCard[]
  cutters: Cutter[]
  me: Me
}

export type StartReq = {vaultId: string}
export type StartRsp = {journeyId: string}

export type RunReq = {vaultId: string; moves: string; journeyId: string}
export type ResultReq = {vaultId: string}

export type PublishReq = {code: string; label: Label}
export type PublishRsp = {card: VaultCard} | {problem: string}

export type VaultActionReq = {id: string}
export type OkRsp = {ok: true}

export type ShareReq = {vaultId: string; kind: 'copy' | 'comment'; journeyId: string}
export type ShareRsp = {ok: true; url?: string}

export const HIST_BUCKETS = 9

export function stampFor(moves: number, par: number): 'Ghost' | 'Clean' | 'Out' {
  return moves <= par ? 'Ghost' : moves - par <= 2 ? 'Clean' : 'Out'
}

/** One mark per beat: a step, a held breath, the grab. Says nothing about where. */
export function rhythm(code: string, moves: string): string {
  const v = decodeVault(code)
  const states = v ? simulate(compile(v), moves) : undefined
  let out = ''
  for (let i = 0; i < moves.length; i++) {
    const grabbed = states ? states[i + 1]!.has && !states[i]!.has : false
    out += grabbed ? '◆' : moves[i] === 'W' ? '▫' : '▪'
  }
  return out
}

export const LEVELS = 12

export function vaultTitle(card: Pick<VaultCard, 'day' | 'label'> & {level?: number}): string {
  if (card.level) return `Level ${card.level} · ${labelText(card.label)}`
  return card.day ? `No. ${card.day} · ${labelText(card.label)}` : labelText(card.label)
}

/** The text that is copied or posted. Built from the recorded job only. */
export function shareText(
  card: Pick<VaultCard, 'day' | 'label' | 'code'>,
  moves: string,
  par: number,
  streak: number,
  lineBreak = '\n',
): string {
  const n = moves.length
  const stamp = stampFor(n, par)
  const verdict =
    stamp === 'Ghost' ? 'Ghost line. Nobody saw a thing.' : `${n - par} over the ghost line.`
  const lines = [
    `Paper Vault ${vaultTitle(card)}`,
    `Out in ${n} moves. ${verdict}`,
    rhythm(card.code, moves),
  ]
  if (card.day && streak > 1) lines.push(`${streak} nights running.`)
  return lines.join(lineBreak)
}
