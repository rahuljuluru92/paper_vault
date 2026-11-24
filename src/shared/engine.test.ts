import assert from 'node:assert/strict'
import {test} from 'node:test'
import {compile, decodeVault, encodeVault, judge, simulate, solve, startState, step, N, type Vault} from './engine.ts'
import {dailyVault, generate, LESSON_CODES} from './gen.ts'

const empty = (): boolean[] => new Array<boolean>(N).fill(false)

test('empty room: straight up and back', () => {
  const v: Vault = {walls: empty(), loot: 3 + 2 * 7, guards: []}
  const j = judge(v)
  assert.equal(j.problem, 'ok')
  assert.equal(j.par, 8)
  assert.ok(simulate(compile(v), j.ghost))
})

test('walking into the light is refused', () => {
  // Guard stands at column 3 row 3 looking down at the door column.
  const v: Vault = {walls: empty(), loot: 0, guards: [{path: [3 + 3 * 7], dir: 2}]}
  const r = step(compile(v), startState(), 0)
  assert.deepEqual(r, {ok: false, why: 'light', by: 0})
})

test('door in the light at the start is unsolvable', () => {
  const v: Vault = {walls: empty(), loot: 0, guards: [{path: [3 + 4 * 7], dir: 2}]}
  assert.equal(judge(v).problem, 'watched')
})

test('the bell reverses a standing guard', () => {
  // Guard at (0,1) looks right along row 1; loot at (3,0). After the grab he
  // looks left, so row 1 is safe on the way home.
  const v: Vault = {walls: empty(), loot: 3, guards: [{path: [7], dir: 1}]}
  const c = compile(v)
  const j = judge(v)
  assert.equal(j.problem, 'ok')
  // Going up column 3 crosses row 1 at (3,1): in the beam (reach 3). Must go round.
  assert.ok(j.par > 12)
  assert.ok(simulate(c, j.ghost))
  assert.equal(solve(c)?.par, j.par)
})

test('sealed loot is rejected', () => {
  const walls = empty()
  walls[1] = walls[7] = walls[8] = true
  assert.equal(judge({walls, loot: 0, guards: []}).problem, 'sealed')
})

test('encode / decode round trip', () => {
  for (let d = 1; d <= 30; d++) {
    const m = dailyVault(d)
    const code = encodeVault(m.vault)
    const back = decodeVault(code)
    assert.ok(back, code)
    assert.equal(encodeVault(back), code)
    assert.equal(judge(back).par, m.par)
  }
})

test('a year of dailies is solvable and deterministic', () => {
  for (let d = 1; d <= 60; d++) {
    const m = dailyVault(d)
    assert.ok(simulate(compile(m.vault), m.ghost), `day ${d}`)
    assert.ok(m.par >= 8 && m.par <= 36, `day ${d} par ${m.par}`)
  }
  assert.equal(encodeVault(dailyVault(5).vault), encodeVault(dailyVault(5).vault))
  assert.ok(generate(1, 0))
})

test('the three lessons: a walk, one wait, and a different way out', () => {
  const [walk, wait, bell] = LESSON_CODES.map(code => {
    const v = decodeVault(code)
    assert.ok(v)
    return judge(v)
  })
  assert.equal(walk!.ghost, 'UUUDDD')
  assert.equal(wait!.par, 9)
  assert.equal((wait!.ghost.match(/W/g) ?? []).length, 1)
  assert.equal(bell!.par, 12)
  assert.ok(bell!.ghost.includes('L') && bell!.ghost.includes('R'))
})
