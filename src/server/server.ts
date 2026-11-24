import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {telemetry} from '@devvit/analytics/server/reddit'
import {context, reddit} from '@devvit/web/server'
import type {
  OnCommentDeleteRequest,
  OnPostDeleteRequest,
  PartialJsonValue,
  T1,
  T2,
  T3,
} from '@devvit/web/shared'
import {
  type ErrorRsp,
  type FlairRsp,
  type InitRsp,
  type OkRsp,
  type PublishRsp,
  type Result,
  type ResultReq,
  type RunReq,
  type ShareReq,
  type ShareRsp,
  type StartReq,
  type StartRsp,
  shareText,
  type VaultActionReq,
  type VaultsRsp,
} from '../shared/api.ts'
import {bareDistance, compile, decodeVault, encodeVault, judge, simulate} from '../shared/engine.ts'
import {dayNumber, labelText, validLabel} from '../shared/gen.ts'
import * as store from './store.ts'

type Json = PartialJsonValue
type Handler = (body: unknown) => Promise<Json>

class HttpError extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

const routes: {[key: string]: Handler} = {
  'GET /api/init': init,
  'GET /api/vaults': vaults,
  'POST /api/start': start,
  'POST /api/run': run,
  'POST /api/result': result,
  'POST /api/warm': warm,
  'POST /api/sound': sound,
  'POST /api/flair': flair,
  'POST /api/join': join,
  'POST /api/publish': publish,
  'POST /api/vault/delete': removeVault,
  'POST /api/vault/report': report,
  'POST /api/share': share,
  'POST /internal/on/app/install': onInstall,
  'POST /internal/on/app/upgrade': onInstall,
  'POST /internal/on/post/delete': onPostDelete,
  'POST /internal/on/comment/delete': onCommentDelete,
  'POST /internal/menu/new-post': menuNewPost,
  'POST /internal/cron/daily': cronDaily,
}

export async function onReq(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const path = (req.url ?? '').split('?')[0]
  const handler = routes[`${req.method} ${path}`]
  if (!handler) return writeJson(404, {error: 'not found', status: 404} satisfies ErrorRsp, rsp)
  try {
    const body = req.method === 'POST' ? await readJson(req) : undefined
    writeJson(200, await handler(body), rsp)
  } catch (err) {
    if (err instanceof HttpError)
      return writeJson(err.status, {error: err.message, status: err.status} satisfies ErrorRsp, rsp)
    console.error(`server error; ${err instanceof Error ? err.stack : err}`)
    writeJson(500, {error: 'server error', status: 500} satisfies ErrorRsp, rsp)
  }
}

const today = (): number => dayNumber(Date.now())

async function who(): Promise<{uid: T2 | undefined; name: string | undefined}> {
  const uid = context.userId
  if (!uid) return {uid: undefined, name: undefined}
  const name = context.username ?? (await reddit.getCurrentUsername())
  return {uid, name}
}

function str(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'bad request')
  return v
}

function field(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'bad request')
  return (body as Record<string, unknown>)[key]
}

// --- Play ------------------------------------------------------------------

async function init(): Promise<InitRsp> {
  const {uid, name} = await who()
  const now = today()
  const postDay = Number((context.postData as {day?: unknown} | undefined)?.day) || now
  const day = Math.min(postDay, now)
  const v = await store.getVault(`d${day}`)
  if (!v) throw new HttpError(500, 'no vault')
  if (uid && name) await store.touchUser(uid, name)
  const [me, mine, latest] = await Promise.all([
    store.getMe(uid, name),
    store.myMovesOn(uid, v.id),
    day < now ? store.postForDay(now) : Promise.resolve(undefined),
  ])
  return {
    me,
    today: now,
    daily: store.toCard(v, uid, mine?.length),
    todayUrl: latest ? `https://www.reddit.com/comments/${latest.replace('t3_', '')}` : undefined,
    canPostAsUser: !!uid,
    sub: context.subredditName ?? '',
  }
}

async function start(body: unknown): Promise<StartRsp> {
  const req: StartReq = {vaultId: str(field(body, 'vaultId'), 12)}
  let journeyId = ''
  try {
    const j = await telemetry.startJourney()
    journeyId = j.journeyId
    if (journeyId)
      await telemetry.journeyProgress({
        journeyId,
        progress: 0,
        action: 'vault_start',
        actionDetails: req.vaultId,
      })
  } catch (err) {
    console.warn(`journey start skipped; ${err}`)
  }
  return {journeyId}
}

async function run(body: unknown): Promise<Result> {
  const req: RunReq = {
    vaultId: str(field(body, 'vaultId'), 12),
    moves: str(field(body, 'moves'), 80),
    journeyId: str(field(body, 'journeyId') ?? '', 80),
  }
  const v = await store.getVault(req.vaultId)
  if (!v || v.hidden) throw new HttpError(404, 'vault gone')
  const vault = decodeVault(v.code)
  if (!vault || !simulate(compile(vault), req.moves)) throw new HttpError(400, 'not a clean job')
  const {uid, name} = await who()
  let first = false
  let recorded = req.moves
  const own = !!uid && v.author === uid
  if (uid && name && !own) {
    await store.touchUser(uid, name)
    first = await store.recordRun(v, uid, name, req.moves, today())
    if (!first) recorded = (await store.myMovesOn(uid, v.id)) ?? req.moves
    if (first && (await store.getMe(uid, name)).flair) await wearFlair(uid, name)
  }
  if (req.journeyId) {
    try {
      await telemetry.journeyProgress({
        journeyId: req.journeyId,
        progress: 1,
        action: 'vault_finish',
        actionDetails: v.id,
      })
      await telemetry.endJourney({
        journeyId: req.journeyId,
        complete: true,
        game: {win: true, score: Math.max(0, 100 - (req.moves.length - v.par) * 5)},
      })
    } catch (err) {
      console.warn(`journey end skipped; ${err}`)
    }
  }
  const fresh = first ? ((await store.getVault(v.id)) ?? v) : v
  const res = await store.buildResult(fresh, uid, recorded, first, !!uid && !own)
  // Signed out, nothing is recorded, so the routes stay back: otherwise you could
  // watch the ghost line, sign in, and enter it as your first run.
  return uid ? res : {...res, ghost: '', replays: []}
}

async function result(body: unknown): Promise<Result> {
  const req: ResultReq = {vaultId: str(field(body, 'vaultId'), 12)}
  const {uid} = await who()
  const v = await store.getVault(req.vaultId)
  if (!v) throw new HttpError(404, 'vault gone')
  const mine = await store.myMovesOn(uid, v.id)
  if (!mine) throw new HttpError(403, 'finish the job first')
  return store.buildResult(v, uid, mine, false, true)
}

async function warm(): Promise<OkRsp> {
  const {uid} = await who()
  if (uid) await store.setWarmedUp(uid)
  return {ok: true}
}

async function sound(body: unknown): Promise<OkRsp> {
  const {uid} = await who()
  if (uid) await store.setFlag(uid, 'quiet', field(body, 'quiet') === true)
  return {ok: true}
}

/** Puts the player's record on them as subreddit flair. Returns the text, or '' if Reddit refused. */
async function wearFlair(uid: T2, name: string): Promise<string> {
  const text = await store.flairText(uid)
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName!,
      username: name,
      text,
      backgroundColor: '#f2b22e',
      textColor: 'dark',
    })
    return text
  } catch (err) {
    console.warn(`flair failed; ${err}`)
    return ''
  }
}

/** Flair is opt-in: the player turns it on from the result card, and can take it off. */
async function flair(body: unknown): Promise<FlairRsp> {
  const {uid, name} = await who()
  if (!uid || !name || !context.subredditName) throw new HttpError(401, 'sign in for flair')
  const on = field(body, 'on') === true
  if (!on) {
    await store.setFlag(uid, 'flair', false)
    try {
      await reddit.removeUserFlair(context.subredditName, name)
    } catch (err) {
      console.warn(`flair removal failed; ${err}`)
    }
    return {text: ''}
  }
  const text = await wearFlair(uid, name)
  if (!text) throw new HttpError(502, 'flair refused')
  await store.setFlag(uid, 'flair', true)
  return {text}
}

/** Joining is always the player's tap; Reddit subscribes them as themselves. */
async function join(): Promise<OkRsp> {
  const {uid} = await who()
  if (!uid) throw new HttpError(401, 'sign in to join')
  await reddit.subscribeToCurrentSubreddit()
  await store.setFlag(uid, 'joined', true)
  return {ok: true}
}

// --- The shelf and the workshop --------------------------------------------

async function vaults(): Promise<VaultsRsp> {
  const {uid, name} = await who()
  const [list, cutters, me] = await Promise.all([
    store.listVaults(uid),
    store.topCutters(),
    store.getMe(uid, name),
  ])
  return {vaults: list, cutters, me}
}

async function publish(body: unknown): Promise<PublishRsp> {
  const {uid, name} = await who()
  if (!uid || !name) throw new HttpError(401, 'sign in to publish')
  const label = field(body, 'label')
  const vault = decodeVault(str(field(body, 'code'), 120))
  if (!vault || !validLabel(label)) return {problem: 'That vault did not survive the post. Try again.'}
  if (!vault.guards.length) return {problem: 'A vault needs at least one guard.'}
  const verdict = judge(vault)
  if (verdict.problem !== 'ok') return {problem: 'There is no way out of that vault yet.'}
  if (verdict.par < 8) return {problem: 'Too short a walk. Move the loot further from the door.'}
  const code = encodeVault(vault)
  const out = await store.publishVault(
    uid,
    name,
    code,
    verdict.par,
    verdict.ghost,
    verdict.par - bareDistance(vault),
    label,
    today(),
  )
  if ('problem' in out) {
    const why = {
      duplicate: 'That exact vault is already on the shelf.',
      limit: `Three vaults a day is the house limit. Come back tomorrow.`,
      full: `You have ${store.MAX_LIVE_VAULTS} vaults on the shelf. Take one down first.`,
    }[out.problem]
    return {problem: why}
  }
  await store.touchUser(uid, name)
  const v = await store.getVault(out.id)
  if (!v) throw new HttpError(500, 'publish failed')
  return {card: store.toCard(v, uid, undefined)}
}

async function removeVault(body: unknown): Promise<OkRsp> {
  const req: VaultActionReq = {id: str(field(body, 'id'), 12)}
  const {uid} = await who()
  const v = await store.getVault(req.id)
  if (!v) return {ok: true}
  if (!uid || v.author !== uid) throw new HttpError(403, 'not your vault')
  await store.deleteVault(v)
  return {ok: true}
}

async function report(body: unknown): Promise<OkRsp> {
  const req: VaultActionReq = {id: str(field(body, 'id'), 12)}
  const {uid} = await who()
  if (!uid) throw new HttpError(401, 'sign in to report')
  const v = await store.getVault(req.id)
  if (v?.author && v.author !== uid) await store.reportVault(v, uid)
  return {ok: true}
}

// --- Sharing ---------------------------------------------------------------

async function share(body: unknown): Promise<ShareRsp> {
  const kind = field(body, 'kind')
  if (kind !== 'copy' && kind !== 'comment') throw new HttpError(400, 'bad request')
  const req: ShareReq = {
    vaultId: str(field(body, 'vaultId'), 12),
    kind,
    journeyId: str(field(body, 'journeyId') ?? '', 80),
  }
  if (req.journeyId) {
    try {
      await telemetry.journeyInteraction({
        journeyId: req.journeyId,
        action: 'share',
        actionDetails: req.kind,
      })
    } catch (err) {
      console.warn(`journey share skipped; ${err}`)
    }
  }
  if (req.kind === 'copy') return {ok: true}

  // Posting is always the player's explicit choice, and the words are built
  // here from their recorded job, never taken from the request.
  const {uid} = await who()
  const t3 = context.postId
  if (!uid || !t3) throw new HttpError(401, 'sign in to post')
  const v = await store.getVault(req.vaultId)
  const mine = v ? await store.myMovesOn(uid, v.id) : undefined
  if (!v || !mine) throw new HttpError(403, 'finish the job first')
  const res = await store.buildResult(v, uid, mine, false, true)
  if (res.shared) throw new HttpError(409, 'already posted')
  const text = shareText(store.toCard(v, uid, mine.length), mine, v.par, res.streak, '  \n')
  const parent = ((await store.stickyFor(t3)) ?? t3) as T1 | T3
  let comment
  try {
    comment = await reddit.submitComment({id: parent, text, runAs: 'USER'})
  } catch (err) {
    console.warn(`reply to pinned comment failed, posting on the post; ${err}`)
    comment = await reddit.submitComment({id: t3, text, runAs: 'USER'})
  }
  await store.saveShare(uid, v.id, comment.id)
  return {ok: true}
}

// --- Posts, schedule, cleanup ----------------------------------------------

async function createDailyPost(day: number): Promise<{id: string; url: string; made: boolean}> {
  const existing = await store.postForDay(day)
  if (existing) return {id: existing, url: `https://www.reddit.com/comments/${existing.slice(3)}`, made: false}
  const v = await store.getVault(`d${day}`)
  if (!v) throw Error('no vault')
  const title = `Paper Vault No. ${day}: ${labelText(v.label)}`
  const post = await reddit.submitCustomPost({
    title,
    postData: {day},
    textFallback: {
      text: `${title}. Sneak in, lift the loot, and get back out the door in as few moves as you can. Then cut a vault of your own.`,
    },
  })
  let sticky = ''
  try {
    const c = await reddit.submitComment({
      id: post.id,
      text: `**Results for No. ${day} go here.**\n\nFinished the vault? The result card has a button that posts your moves as a reply to this comment. No routes, no spoilers, only your count and your rhythm.`,
    })
    await c.distinguish(true)
    sticky = c.id
  } catch (err) {
    console.warn(`pinned comment failed; ${err}`)
  }
  await store.savePost(post.id, day, sticky)
  return {id: post.id, url: post.url, made: true}
}

async function onInstall(): Promise<Json> {
  await store.seedHouse()
  await createDailyPost(today())
  return {}
}

async function menuNewPost(): Promise<Json> {
  await store.seedHouse()
  const post = await createDailyPost(today())
  return {
    showToast: {
      text: post.made ? `Today's vault is up.` : `Today's vault is already posted.`,
      appearance: 'success',
    },
    navigateTo: post.url,
  }
}

async function cronDaily(): Promise<Json> {
  await createDailyPost(today())
  // Deleted accounts send no event to apps, so check a few of the
  // longest-unseen players each night and forget any that are gone.
  for (const uid of await store.stalestUsers(15)) {
    try {
      const user = await reddit.getUserById(uid as T2)
      if (user) await store.markChecked(uid)
      else await store.forgetUser(uid)
    } catch {
      await store.forgetUser(uid)
    }
  }
  return {}
}

async function onPostDelete(body: unknown): Promise<Json> {
  const ev = body as OnPostDeleteRequest
  if (ev.postId) await store.forgetPost(ev.postId)
  return {}
}

async function onCommentDelete(body: unknown): Promise<Json> {
  const ev = body as OnCommentDeleteRequest
  if (ev.commentId) await store.forgetComment(ev.commentId, ev.postId)
  return {}
}

// --- Plumbing --------------------------------------------------------------

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  req.on('data', (chunk: Uint8Array) => {
    size += chunk.length
    if (size <= 16_384) chunks.push(chunk)
  })
  await once(req, 'end')
  if (size > 16_384) throw new HttpError(413, 'too large')
  const text = `${Buffer.concat(chunks)}`
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad json')
  }
}

function writeJson(status: number, json: Json, rsp: ServerResponse): void {
  const body = JSON.stringify(json)
  rsp.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
