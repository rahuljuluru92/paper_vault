#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Local play-test server. Serves public/ and runs the real server routes
 * against an in-memory stand-in for Redis and Reddit. Not uploaded.
 *
 *   node --experimental-strip-types tools/dev.ts [port]
 *   ?as=name on any page switches the pretend player; ?as=anon signs out.
 */
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, join, normalize} from 'node:path'
import {type Context, reddit, redis, runWithContext} from '@devvit/web/server'
import {onReq} from '../src/server/server.ts'
import {dayNumber} from '../src/shared/gen.ts'

const strings = new Map<string, string>()
const hashes = new Map<string, Map<string, string>>()
const zsets = new Map<string, Map<string, number>>()
const h = (k: string) => hashes.get(k) ?? hashes.set(k, new Map()).get(k)!
const z = (k: string) => zsets.get(k) ?? zsets.set(k, new Map()).get(k)!
const r = redis as unknown as Record<string, unknown>
r.get = async (k: string) => strings.get(k)
r.set = async (k: string, v: string) => (strings.set(k, v), 'OK')
r.del = async (...ks: string[]) => { for (const k of ks) { strings.delete(k); hashes.delete(k); zsets.delete(k) } }
r.incrBy = async (k: string, n: number) => { const v = Number(strings.get(k) ?? 0) + n; strings.set(k, `${v}`); return v }
r.expire = async () => {}
r.hSet = async (k: string, fv: Record<string, string>) => { for (const [f, v] of Object.entries(fv)) h(k).set(f, v); return 1 }
r.hSetNX = async (k: string, f: string, v: string) => (h(k).has(f) ? 0 : (h(k).set(f, v), 1))
r.hGet = async (k: string, f: string) => hashes.get(k)?.get(f)
r.hGetAll = async (k: string) => Object.fromEntries(hashes.get(k) ?? [])
r.hMGet = async (k: string, fs: string[]) => fs.map(f => hashes.get(k)?.get(f) ?? null)
r.hDel = async (k: string, fs: string[]) => fs.forEach(f => hashes.get(k)?.delete(f))
r.hIncrBy = async (k: string, f: string, n: number) => { const v = Number(h(k).get(f) ?? 0) + n; h(k).set(f, `${v}`); return v }
r.zAdd = async (k: string, ...ms: {member: string; score: number}[]) => { for (const m of ms) z(k).set(m.member, m.score); return ms.length }
r.zIncrBy = async (k: string, m: string, n: number) => { const v = (z(k).get(m) ?? 0) + n; z(k).set(m, v); return v }
r.zScore = async (k: string, m: string) => zsets.get(k)?.get(m)
r.zCard = async (k: string) => zsets.get(k)?.size ?? 0
r.zRem = async (k: string, ms: string[]) => ms.forEach(m => zsets.get(k)?.delete(m))
r.zRange = async (k: string, a: number, b: number, o?: {reverse?: boolean}) => {
  const all = [...(zsets.get(k) ?? [])].map(([member, score]) => ({member, score})).sort((x, y) => x.score - y.score)
  if (o?.reverse) all.reverse()
  return all.slice(a, b === -1 ? undefined : b + 1)
}
const rd = reddit as unknown as Record<string, unknown>
let seq = 0
rd.getCurrentUsername = async () => 'dev'
rd.submitCustomPost = async (o: {title: string}) => (console.log('post:', o.title), {id: `t3_dev${++seq}`, url: '/'})
rd.submitComment = async (o: {text: string; id: string; runAs?: string}) => (console.log(`comment on ${o.id} as ${o.runAs ?? 'APP'}:\n${o.text}`), {id: `t1_dev${++seq}`, distinguish: async () => {}})
rd.getUserById = async () => ({})
rd.setUserFlair = async (o: {username: string; text: string}) => console.log(`flair on u/${o.username}: ${o.text}`)
rd.removeUserFlair = async (_s: string, u: string) => console.log(`flair off u/${u}`)
rd.subscribeToCurrentSubreddit = async () => console.log("subscribed")

const types: Record<string, string> = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json'}
const ctx = (name: string | undefined): Context => ({appName: 'paper-vault', appSlug: 'paper-vault', postId: 't3_dev0', subredditName: 'dev', userId: name ? `t2_${name}` : undefined, username: name, postData: {day: dayNumber(Date.now())}}) as unknown as Context

const server = createServer(async (req, rsp) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const cookie = /as=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'dev'
  const as = url.searchParams.get('as') ?? cookie
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/'))
    return runWithContext(ctx(as === 'anon' ? undefined : as), () => onReq(req, rsp))
  const file = normalize(url.pathname === '/' ? '/splash.html' : url.pathname)
  try {
    const data = await readFile(join(import.meta.dirname, '../public', file))
    rsp.writeHead(200, {'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Set-Cookie': `as=${as}; Path=/`, 'Cache-Control': 'no-store'})
    rsp.end(data)
  } catch {
    rsp.writeHead(404).end('not found')
  }
})
const port = Number(process.argv[2] ?? 5173)
await runWithContext(ctx('dev'), async () => {
  const {seedHouse} = await import('../src/server/store.ts')
  await seedHouse()
  // The local post behaves like tonight's daily post, with a pinned results comment.
  const {savePost} = await import('../src/server/store.ts')
  await savePost('t3_dev0', dayNumber(Date.now()), 't1_pinned')
})
server.listen(port, () => console.log(`http://localhost:${port}`))
