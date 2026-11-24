// Runs every level of the ladder against the local dev server as a fresh player.
// For each level: solves it, submits the ghost line, checks the result, and
// prints a difficulty table. Usage: node --experimental-strip-types tools/ladder.ts [player]

import {LEVELS, type Result, type VaultCard} from '../src/shared/api.ts'
import {
  bareDistance,
  compile,
  decodeVault,
  solve,
} from '../src/shared/engine.ts'
import {labelText} from '../src/shared/gen.ts'

const base = 'http://localhost:5173'
const as = process.argv[2] ?? `ladder${Date.now() % 10000}`
const headers = {cookie: `as=${as}`, 'content-type': 'application/json'}

const vaults = (await (
  await fetch(`${base}/api/vaults`, {headers})
).json()) as {vaults: VaultCard[]}
const rungs = vaults.vaults
  .filter(c => c.level > 0)
  .sort((a, b) => a.level - b.level)
if (rungs.length !== LEVELS)
  throw new Error(`expected ${LEVELS} levels, got ${rungs.length}`)
if (rungs.some((c, i) => c.level !== i + 1))
  throw new Error('levels are not 1..12')

console.log('lvl  guards  bare  par  detour  waits  grab  name')
let prev = 0
for (const c of rungs) {
  const v = decodeVault(c.code)
  if (!v) throw new Error(`level ${c.level}: bad code`)
  const sol = solve(compile(v))
  if (!sol) throw new Error(`level ${c.level}: unsolvable`)
  const bare = bareDistance(v)
  const waits = (sol.moves.match(/W/g) ?? []).length
  const r = (await fetch(`${base}/api/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({vaultId: c.id, moves: sol.moves, journeyId: ''}),
  })) as Response
  if (!r.ok)
    throw new Error(`level ${c.level}: run ${r.status} ${await r.text()}`)
  const res = (await r.json()) as Result
  if (
    !res.first ||
    !res.saved ||
    res.moves !== sol.moves ||
    res.par !== sol.par
  )
    throw new Error(`level ${c.level}: bad result ${JSON.stringify(res)}`)
  const grab = sol.moves.length / 2 // rough: where the grab sits is not in the string, so show half
  console.log(
    `${String(c.level).padStart(3)}  ${String(v.guards.length).padStart(6)}  ${String(bare).padStart(4)}  ${String(sol.par).padStart(3)}  ${String(sol.par - bare).padStart(6)}  ${String(waits).padStart(5)}  ${String(grab).padStart(4)}  ${labelText(c.label)}  (${c.id}, ${sol.moves})`,
  )
  if (sol.par < prev) console.log(`     ^ par fell from ${prev}`)
  prev = sol.par
}

// A second listing: all rungs should now be marked played and sort after unplayed ones.
const after = (await (await fetch(`${base}/api/vaults`, {headers})).json()) as {
  vaults: VaultCard[]
}
const played = after.vaults.filter(c => c.level > 0 && c.my)
console.log(`\n${played.length}/${LEVELS} levels recorded for ${as}`)
