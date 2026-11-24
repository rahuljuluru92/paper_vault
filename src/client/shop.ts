/** The workshop: cut a vault from walls, guards and loot, and name it from the lists. */

import type {PublishRsp} from '../shared/api.ts'
import {
  bareDistance,
  type Dir,
  DOOR,
  dirBetween,
  encodeVault,
  judge,
  MAX_GUARDS,
  MAX_ROUTE,
  startState,
  type Vault,
} from '../shared/engine.ts'
import {EMBLEMS, generate, type Label, NAME_A, NAME_B} from '../shared/gen.ts'
import {Board, emblemArt} from './board.ts'
import {$, fit, post, toast} from './dom.ts'

type Tool = 'wall' | 'guard' | 'loot' | 'erase'
type Hooks = {
  signedIn: () => boolean
  test: (vault: Vault, label: Label) => void
  published: () => void
}

export class Workshop {
  private readonly board = new Board($('shop-stage'))
  private vault: Vault | undefined
  private label: Label = {a: 0, b: 0, e: 0}
  private tool: Tool = 'wall'
  private painting = true
  private drawing = -1
  private ok = false
  private readonly hooks: Hooks

  constructor(hooks: Hooks) {
    this.hooks = hooks
    this.board.onCell = (c, phase) => this.cell(c, phase)
    new ResizeObserver(() => fit($('shop-stage'), this.board.svg)).observe($('shop-stage'))
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
      b.addEventListener('click', () => {
        this.tool = b.dataset.tool as Tool
        for (const o of document.querySelectorAll('[data-tool]')) o.setAttribute('aria-pressed', `${o === b}`)
        this.say()
      })
    $('e-shuffle').addEventListener('click', () => this.sketch())
    $('e-a').addEventListener('click', () => this.rename('a', NAME_A.length))
    $('e-b').addEventListener('click', () => this.rename('b', NAME_B.length))
    $('e-e').addEventListener('click', () => this.rename('e', EMBLEMS.length))
    $('e-test').addEventListener('click', () => this.vault && this.ok && this.hooks.test(this.vault, this.label))
    $('e-publish').addEventListener('click', () => void this.publish())
  }

  open(): void {
    if (!this.vault) this.sketch()
    else this.refresh()
  }

  /** Start from a working vault rather than a blank sheet. */
  private sketch(): void {
    const seed = Math.floor(Math.random() * 2 ** 31)
    this.vault = generate(seed, 1).vault
    this.label = {
      a: seed % NAME_A.length,
      b: (seed >> 5) % NAME_B.length,
      e: (seed >> 10) % EMBLEMS.length,
    }
    this.refresh()
  }

  private rename(key: keyof Label, count: number): void {
    this.label[key] = (this.label[key] + 1) % count
    this.refresh()
  }

  private refresh(): void {
    const v = this.vault!
    this.board.setVault(v, this.label.e)
    this.board.render({states: [startState()], empty: true})
    fit($('shop-stage'), this.board.svg)
    $('e-a').textContent = NAME_A[this.label.a]!
    $('e-b').textContent = NAME_B[this.label.b]!
    $('e-e').innerHTML = `<svg viewBox="-34 -34 68 68">${emblemArt(this.label.e)}</svg>`
    this.say()
  }

  /** The solver's verdict, in words. Nothing unsolvable can be published. */
  private say(note?: string): void {
    const v = this.vault!
    const j = judge(v)
    let text: string
    this.ok = false
    if (!v.guards.length) text = 'Add a guard. An empty room is not a vault.'
    else if (j.problem === 'watched') text = 'A lantern is on the door mat at the start. Nobody could even come in.'
    else if (j.problem === 'sealed') text = 'The loot is walled in. Open a gap.'
    else if (j.problem !== 'ok') text = 'No way out yet. Open a gap or shorten a patrol.'
    else if (j.par < 8) text = 'Too short a walk. Move the loot further from the door.'
    else {
      this.ok = true
      // No move count here: the workshop must not double as an answer key.
      const detour = j.par - bareDistance(v)
      text = `It can be done. It reads as ${detour <= 3 ? 'gentle' : detour <= 7 ? 'tricky' : 'knotty'}. ${TIP[this.tool]}`
    }
    const el = $('verdict')
    el.textContent = note ?? text
    el.dataset.ok = this.ok || note ? '1' : '0'
    $<HTMLButtonElement>('e-publish').disabled = !this.ok
    $<HTMLButtonElement>('e-test').disabled = !this.ok
  }

  private guardOn(c: number): number {
    return this.vault!.guards.findIndex(g => g.path.includes(c))
  }

  private cell(c: number, phase: 'down' | 'move' | 'up'): void {
    const v = this.vault
    if (!v || c < 0) return
    if (phase === 'up') {
      this.drawing = -1
      return
    }
    const gi = this.guardOn(c)
    let note: string | undefined
    if (this.tool === 'wall') {
      if (phase === 'down') this.painting = !v.walls[c]
      if (c === DOOR) note = 'That is the door. It stays open.'
      else if (c === v.loot) note = 'The loot sits there. Move it first.'
      else if (gi !== -1) note = 'A guard walks there. Erase the guard first.'
      else v.walls[c] = this.painting
    } else if (this.tool === 'erase') {
      if (gi !== -1) v.guards.splice(gi, 1)
      else v.walls[c] = false
    } else if (this.tool === 'loot') {
      if (c === DOOR) note = 'Not on the door mat.'
      else if (v.walls[c] || gi !== -1) note = 'Something is already there.'
      else v.loot = c
    } else {
      note = this.drawGuard(c, phase, gi)
    }
    this.board.setVault(v, this.label.e)
    this.board.render({states: [startState()], empty: true})
    this.say(note)
  }

  private drawGuard(c: number, phase: 'down' | 'move', gi: number): string | undefined {
    const v = this.vault!
    if (phase === 'down') {
      if (gi !== -1) {
        const g = v.guards[gi]!
        if (g.path.length > 1) return 'A guard already walks there.'
        g.dir = ((g.dir + 1) % 4) as Dir
        return 'Turned. A guard who stands still looks one way.'
      }
      if (c === DOOR || c === v.loot || v.walls[c]) return 'Guards need open floor.'
      if (v.guards.length >= MAX_GUARDS) return 'Four guards is the limit.'
      v.guards.push({path: [c], dir: 0})
      this.drawing = v.guards.length - 1
      return 'Drag to draw the route, or leave them standing and tap to turn.'
    }
    const g = v.guards[this.drawing]
    if (!g) return undefined
    const tip = g.path[g.path.length - 1]!
    if (g.path.length > 1 && g.path[g.path.length - 2] === c) {
      g.path.pop()
      return undefined
    }
    const d = dirBetween(tip, c)
    if (d === -1 || g.path.length >= MAX_ROUTE) return undefined
    if (c === DOOR || c === v.loot || v.walls[c] || gi !== -1) return undefined
    g.path.push(c)
    if (g.path.length === 2) g.dir = d
    return undefined
  }

  private async publish(): Promise<void> {
    const v = this.vault
    if (!v || !this.ok) return
    if (!this.hooks.signedIn()) return toast('Sign in to put a vault on the shelf.')
    const b = $<HTMLButtonElement>('e-publish')
    b.disabled = true
    const rsp = await post<PublishRsp>('/api/publish', {code: encodeVault(v), label: this.label})
    b.disabled = false
    if (!rsp) return toast('That did not reach the shelf. Try again in a moment.')
    if ('problem' in rsp) return this.say(rsp.problem)
    toast('On the shelf. Crews can try it now.')
    this.vault = undefined
    this.hooks.published()
  }
}

const TIP: Record<Tool, string> = {
  wall: 'Tap squares to raise or flatten walls.',
  guard: 'Press a square and drag to draw a patrol.',
  loot: 'Tap a square to move the loot.',
  erase: 'Tap a wall or a guard to remove it.',
}
