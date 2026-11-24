/**
 * The diorama. One SVG, built from layered "sheets": frame, floor, routes,
 * light, walls, loot, pencil line, figures. Guards are told apart by head
 * shape and route dash as well as by position, never by colour alone.
 */

import {
  type Compiled,
  compile,
  cx,
  cy,
  cycleOf,
  dirBetween,
  DOOR,
  type Dir,
  DX,
  DY,
  guardAt,
  H,
  N,
  type State,
  startState,
  step,
  type Vault,
  W,
} from '../shared/engine.ts'
import {EMBLEMS} from '../shared/gen.ts'

const C = 100
const PAD = 14
const VW = W * C + PAD * 2
const VH = H * C + PAD * 2 + 26
const NS = 'http://www.w3.org/2000/svg'

const px = (c: number): number => PAD + cx(c) * C + C / 2
const py = (c: number): number => PAD + cy(c) * C + C / 2

/** Route dash per guard: solid, long dash, dots, dash-dot. */
const DASH = ['', '26 14', '2 16', '30 12 4 12']

function headShape(i: number, fill: string): string {
  switch (i % 4) {
    case 0:
      return `<circle cx="0" cy="-30" r="15" fill="${fill}"/>`
    case 1:
      return `<path d="M0 -50 L17 -18 L-17 -18 Z" fill="${fill}"/>`
    case 2:
      return `<rect x="-14" y="-46" width="28" height="28" rx="3" fill="${fill}"/>`
    default:
      return `<path d="M0 -50 L17 -31 L0 -12 L-17 -31 Z" fill="${fill}"/>`
  }
}

/** Small route marker in the same shape as the guard's head. */
function markShape(i: number, x: number, y: number): string {
  const t = `transform="translate(${x} ${y}) scale(.5) translate(0 31)"`
  return `<g ${t}>${headShape(i, 'var(--guard-deep)')}</g>`
}

function guardDoll(i: number): string {
  return `
    <ellipse cx="0" cy="30" rx="26" ry="7" fill="rgba(20,30,34,.28)"/>
    <g class="doll">
    <path d="M-22 30 Q-24 -14 0 -16 Q24 -14 22 30 Z" fill="var(--guard)"/>
    <path d="M-22 30 Q-23 12 -19 0 L19 0 Q23 12 22 30 Z" fill="var(--guard-deep)"/>
    <rect x="-22" y="4" width="44" height="7" fill="var(--cream)"/>
    ${headShape(i, 'var(--guard)')}
    </g>
    <g class="lamp"><circle r="11" fill="var(--light)" stroke="var(--ink)" stroke-width="3"/><circle r="4" fill="var(--cream)"/></g>`
}

const THIEF = `
  <ellipse cx="0" cy="30" rx="24" ry="7" fill="rgba(20,30,34,.3)"/>
  <path d="M20 22 Q42 18 36 -6" fill="none" stroke="var(--ink)" stroke-width="9" stroke-linecap="round"/>
  <path d="M-21 30 Q-25 -8 0 -10 Q25 -8 21 30 Z" fill="var(--ink)"/>
  <path d="M-21 -38 L-19 -12 L19 -12 L21 -38 L8 -27 L-8 -27 Z" fill="var(--ink)"/>
  <ellipse cx="0" cy="-12" rx="21" ry="16" fill="var(--ink)"/>
  <path d="M-17 -16 Q0 -24 17 -16 L17 -8 Q0 -14 -17 -8 Z" fill="var(--cream)"/>
  <circle cx="-8" cy="-13" r="3.4" fill="var(--ink)"/><circle cx="8" cy="-13" r="3.4" fill="var(--ink)"/>
  <g class="sack"><path d="M-36 30 Q-44 8 -30 4 Q-18 8 -22 30 Z" fill="var(--gold)" stroke="var(--ink)" stroke-width="3"/><path d="M-34 6 L-26 6" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/></g>`

/** Loot art. Two-tone cut shapes on a 0-centred 60-unit box. */
export function emblemArt(e: number): string {
  const g = 'var(--gold)'
  const d = 'var(--gold-deep)'
  const k = 'var(--ink)'
  switch (EMBLEMS[e % EMBLEMS.length]) {
    case 'gem':
      return `<path d="M-24 -8 L-12 -24 L12 -24 L24 -8 L0 26 Z" fill="${g}"/><path d="M-24 -8 L24 -8 L0 26 Z" fill="${d}"/><path d="M-12 -24 L-6 -8 L6 -8 L12 -24" fill="none" stroke="${k}" stroke-width="2.5"/>`
    case 'crown':
      return `<path d="M-26 20 L-28 -16 L-12 0 L0 -24 L12 0 L28 -16 L26 20 Z" fill="${g}"/><rect x="-26" y="10" width="52" height="12" fill="${d}"/><circle cx="0" cy="16" r="4" fill="var(--guard)"/>`
    case 'vase':
      return `<path d="M-10 -26 L10 -26 L8 -14 Q26 0 14 26 L-14 26 Q-26 0 -8 -14 Z" fill="${g}"/><path d="M-19 4 Q0 12 19 4 L17 14 Q0 20 -17 14 Z" fill="${d}"/>`
    case 'key':
      return `<circle cx="-12" cy="-10" r="14" fill="${g}"/><circle cx="-12" cy="-10" r="5" fill="var(--floor)"/><path d="M-4 -2 L22 24 L28 18 L22 12 L26 8 L18 0 L14 4 L2 -8 Z" fill="${d}"/>`
    case 'pearl':
      return `<path d="M-28 4 Q0 -34 28 4 Q0 14 -28 4 Z" fill="${d}"/><path d="M-28 6 Q0 34 28 6 Q0 -4 -28 6 Z" fill="${g}"/><circle cx="0" cy="5" r="10" fill="var(--cream)" stroke="${k}" stroke-width="2.5"/>`
    case 'coin':
      return `<ellipse cx="0" cy="16" rx="24" ry="9" fill="${d}"/><ellipse cx="0" cy="6" rx="24" ry="9" fill="${g}"/><ellipse cx="0" cy="-4" rx="24" ry="9" fill="${d}"/><ellipse cx="0" cy="-14" rx="24" ry="9" fill="${g}"/><path d="M-8 -14 L8 -14" stroke="${k}" stroke-width="3" stroke-linecap="round"/>`
    case 'egg':
      return `<path d="M0 -28 Q24 -6 20 10 Q14 28 0 28 Q-14 28 -20 10 Q-24 -6 0 -28 Z" fill="${g}"/><path d="M-21 4 L-10 -4 L0 4 L10 -4 L21 4 L20 12 L10 4 L0 12 L-10 4 L-20 12 Z" fill="${d}"/>`
    default:
      return `<path d="M-22 16 Q-20 -22 0 -24 Q20 -22 22 16 L28 22 L-28 22 Z" fill="${g}"/><rect x="-28" y="14" width="56" height="9" rx="2" fill="${d}"/><circle cx="0" cy="27" r="6" fill="${k}"/>`
  }
}

export type CellEvent = (cell: number, phase: 'down' | 'move' | 'up') => void

export type View = {
  /** States visited so far; the last one is "now". */
  states: State[]
  /** Show step marks around the thief. */
  marks?: boolean
  /** Lights out: the look used while a job plays back. */
  night?: boolean
  /** Hide the thief and the pencil line (the workshop). */
  empty?: boolean
}

let boards = 0

export class Board {
  readonly svg: SVGSVGElement
  /** Each board needs its own filter and pattern ids, or a hidden board breaks the visible one. */
  private readonly uid = ++boards
  onCell: CellEvent | undefined
  private c: Compiled | undefined
  private emblem = 0
  private readonly fixed: SVGGElement
  private readonly light: SVGGElement
  private readonly walls: SVGGElement
  private readonly loot: SVGGElement
  private readonly pencil: SVGGElement
  private readonly marks: SVGGElement
  private readonly figures: SVGGElement
  private guards: SVGGElement[] = []
  private readonly thief: SVGGElement
  private down = false
  private lastCell = -1

  constructor(host: HTMLElement) {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`)
    svg.setAttribute('class', 'board')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', 'The vault, seen from above')
    svg.innerHTML = `
      <defs>
        <pattern id="lit${this.uid}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="18" height="18" fill="var(--light)"/>
          <rect width="7" height="18" fill="var(--light-deep)"/>
        </pattern>
        <filter id="lift${this.uid}" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#0b1c20" flood-opacity=".38"/>
        </filter>
        <filter id="lifts${this.uid}" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#0b1c20" flood-opacity=".32"/>
        </filter>
      </defs>
      <g filter="url(#lift${this.uid})">
        <path class="frame" d="M4 4 H${VW - 4} V${VH - 4} H${PAD + 4 * C + 6} V${VH - 30} H${PAD + 3 * C - 6} V${VH - 4} H4 Z"/>
      </g>
      <rect class="floor" x="${PAD}" y="${PAD}" width="${W * C}" height="${H * C}" rx="6"/>
      <g class="l-fixed"></g>
      <g class="l-light"></g>
      <g class="l-walls" filter="url(#lift${this.uid})"></g>
      <g class="l-loot" filter="url(#lifts${this.uid})"></g>
      <g class="l-pencil"></g>
      <g class="l-marks"></g>
      <g class="l-figures"></g>
      <rect class="hit" x="0" y="0" width="${VW}" height="${VH}" fill="transparent"/>`
    host.append(svg)
    this.svg = svg
    const q = (s: string): SVGGElement => svg.querySelector(s) as SVGGElement
    this.fixed = q('.l-fixed')
    this.light = q('.l-light')
    this.walls = q('.l-walls')
    this.loot = q('.l-loot')
    this.pencil = q('.l-pencil')
    this.marks = q('.l-marks')
    this.figures = q('.l-figures')
    this.thief = document.createElementNS(NS, 'g')
    this.thief.setAttribute('class', 'fig thief')
    this.thief.innerHTML = THIEF
    this.listen()
  }

  private listen(): void {
    const cellAt = (ev: PointerEvent): number => {
      const r = this.svg.getBoundingClientRect()
      const x = Math.floor((((ev.clientX - r.left) / r.width) * VW - PAD) / C)
      const y = Math.floor((((ev.clientY - r.top) / r.height) * VH - PAD) / C)
      return x < 0 || y < 0 || x >= W || y >= H ? -1 : x + y * W
    }
    this.svg.addEventListener('pointerdown', ev => {
      const c = cellAt(ev)
      if (c === -1) return
      this.down = true
      this.lastCell = c
      this.svg.setPointerCapture(ev.pointerId)
      this.onCell?.(c, 'down')
    })
    this.svg.addEventListener('pointermove', ev => {
      if (!this.down) return
      const c = cellAt(ev)
      if (c === -1 || c === this.lastCell) return
      // A fast finger skips squares. Walk the gap so a drag never breaks.
      let at = this.lastCell
      while (at !== c) {
        const dx = Math.sign(cx(c) - cx(at))
        const dy = Math.sign(cy(c) - cy(at))
        at += Math.abs(cx(c) - cx(at)) >= Math.abs(cy(c) - cy(at)) ? dx : dy * W
        this.lastCell = at
        this.onCell?.(at, 'move')
      }
    })
    const up = (): void => {
      if (!this.down) return
      this.down = false
      this.onCell?.(this.lastCell, 'up')
    }
    this.svg.addEventListener('pointerup', up)
    this.svg.addEventListener('pointercancel', up)
  }

  setVault(v: Vault, emblem: number): void {
    this.c = compile(v)
    this.emblem = emblem
    this.svg.classList.remove('bell')
    // Floor seams, the doormat, and each guard's route.
    let fixed = ''
    for (let i = 1; i < W; i++)
      fixed += `<path class="seam" d="M${PAD + i * C} ${PAD + 8} V${PAD + H * C - 8}"/><path class="seam" d="M${PAD + 8} ${PAD + i * C} H${PAD + W * C - 8}"/>`
    fixed += `<rect class="mat" x="${px(DOOR) - 34}" y="${py(DOOR) - 6}" width="68" height="44" rx="5"/>`
    fixed += `<path class="mat-line" d="M${px(DOOR) - 22} ${py(DOOR) + 8} h44 M${px(DOOR) - 22} ${py(DOOR) + 22} h44"/>`
    v.guards.forEach((g, i) => {
      const cyc = cycleOf(g)
      if (cyc.period === 1) return
      const pts = g.path.map(c => `${px(c)} ${py(c)}`)
      const d = `M${pts.join(' L')}${cyc.loop ? ' Z' : ''}`
      fixed += `<path class="route" d="${d}" stroke-dasharray="${DASH[i % 4]}"/>`
      const ends = cyc.loop ? [g.path[0]!] : [g.path[0]!, g.path[g.path.length - 1]!]
      for (const e of ends) fixed += markShape(i, px(e), py(e))
    })
    this.fixed.innerHTML = fixed
    let walls = ''
    for (let c = 0; c < N; c++) {
      if (!v.walls[c]) continue
      const x = PAD + cx(c) * C
      const y = PAD + cy(c) * C
      walls += `<rect class="wall" x="${x + 3}" y="${y + 3}" width="${C - 6}" height="${C - 6}" rx="7"/><rect class="wall-top" x="${x + 3}" y="${y + 3}" width="${C - 6}" height="${C - 24}" rx="7"/>`
    }
    this.walls.innerHTML = walls
    this.loot.innerHTML = `<g transform="translate(${px(v.loot)} ${py(v.loot)})"><ellipse class="plinth" cx="0" cy="30" rx="34" ry="10"/><g class="prize">${emblemArt(emblem)}</g></g>`
    this.figures.innerHTML = ''
    this.guards = v.guards.map((_, i) => {
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('class', 'fig guard')
      g.innerHTML = guardDoll(i)
      this.figures.append(g)
      return g
    })
    this.figures.append(this.thief)
  }

  render(view: View): void {
    const c = this.c
    if (!c) return
    const s = view.states[view.states.length - 1] ?? startState()
    this.svg.classList.toggle('night', !!view.night)
    this.svg.classList.toggle('has', s.has)
    this.svg.classList.toggle('plan', !!view.marks && !s.done)

    let light = ''
    c.vault.guards.forEach((_, i) => {
      const g = guardAt(c, i, s.k, s.has)
      this.guards[i]!.style.transform = `translate(${px(g.cell)}px, ${py(g.cell)}px)`
      const lamp = this.guards[i]!.querySelector('.lamp') as SVGGElement
      lamp.style.transform = `translate(${DX[g.dir] * 30}px, ${DY[g.dir] * 24 + 6}px)`
      if (!g.beam.length) return
      const a = g.beam[0]!
      const b = g.beam[g.beam.length - 1]!
      const x = Math.min(px(a), px(b)) - C / 2 + 7
      const y = Math.min(py(a), py(b)) - C / 2 + 7
      const w = Math.abs(px(a) - px(b)) + C - 14
      const h = Math.abs(py(a) - py(b)) + C - 14
      light += `<rect class="lit" fill="url(#lit${this.uid})" x="${x}" y="${y}" width="${w}" height="${h}" rx="16"/>`
    })
    this.light.innerHTML = light

    this.thief.style.display = view.empty ? 'none' : ''
    this.thief.style.transform = `translate(${px(s.pos)}px, ${py(s.pos)}px)`
    this.pencil.innerHTML = view.empty ? '' : this.pencilLine(view.states)
    this.marks.innerHTML = view.marks && !s.done ? this.nextBeat(s) + this.stepMarks(s) : ''
  }

  /** The bell: every guard jumps as they turn. */
  ring(): void {
    this.svg.classList.remove('bell')
    void this.svg.getBoundingClientRect()
    this.svg.classList.add('bell')
  }

  /** The way in is a solid line; the way out is dashed and nudged aside. */
  private pencilLine(states: State[]): string {
    if (states.length < 2) return ''
    const OFF = 11
    const grab = states.findIndex(s => s.has)
    const at = (s: State, o: number): string => `${px(s.pos) + o} ${py(s.pos) + o}`
    const inn = (grab === -1 ? states : states.slice(0, grab + 1)).map(s => at(s, 0))
    const out = grab === -1 ? [] : [at(states[grab]!, 0), ...states.slice(grab).map(s => at(s, OFF))]
    let held = ''
    for (let i = 1; i < states.length; i++) {
      if (states[i]!.pos !== states[i - 1]!.pos) continue
      const o = grab !== -1 && i > grab ? OFF : 0
      held += `<circle class="held" cx="${px(states[i]!.pos) + o}" cy="${py(states[i]!.pos) + o}" r="15"/>`
    }
    return `${inn.length > 1 ? `<path class="line in" d="M${inn.join(' L')}"/>` : ''}${out.length > 2 ? `<path class="line out" d="M${out.join(' L')}"/>` : ''}${held}`
  }

  /** What the guards do on the next beat: one step each, and where the light lands. */
  private nextBeat(s: State): string {
    const c = this.c!
    const k = s.has ? s.k - 1 : s.k + 1
    let out = ''
    c.vault.guards.forEach((_, i) => {
      const a = guardAt(c, i, s.k, s.has)
      const b = guardAt(c, i, k, s.has)
      if (b.beam.length) {
        const p = b.beam[0]!
        const q = b.beam[b.beam.length - 1]!
        const x = Math.min(px(p), px(q)) - C / 2 + 12
        const y = Math.min(py(p), py(q)) - C / 2 + 12
        out += `<rect class="soon" x="${x}" y="${y}" width="${Math.abs(px(p) - px(q)) + C - 24}" height="${Math.abs(py(p) - py(q)) + C - 24}" rx="14"/>`
      }
      const d = dirBetween(a.cell, b.cell)
      if (d === -1) return
      const x = (px(a.cell) + px(b.cell)) / 2
      const y = (py(a.cell) + py(b.cell)) / 2 + 8
      out += `<path class="tread" transform="translate(${x} ${y}) rotate(${d * 90})" d="M-13 8 L0 -8 L13 8"/>`
    })
    return out
  }

  private stepMarks(s: State): string {
    const c = this.c!
    let out = c.cycles.length && step(c, s, 4).ok ? `<circle class="stay" cx="${px(s.pos)}" cy="${py(s.pos) + 4}" r="43"/>` : ''
    for (let m = 0; m < 4; m++) {
      const r = step(c, s, m as Dir)
      if (!r.ok && r.why === 'wall') continue
      const x = px(s.pos) + DX[m as Dir] * C
      const y = py(s.pos) + DY[m as Dir] * C
      out += r.ok
        ? `<rect class="go" x="${x - 37}" y="${y - 37}" width="74" height="74" rx="20"/>`
        : `<g class="no" transform="translate(${x} ${y})"><circle r="20"/><path d="M-9 -9 L9 9 M9 -9 L-9 9"/></g>`
    }
    return out
  }
}

/** A small still of a vault for the shelf: walls, routes, loot, door. */
export function thumb(v: Vault, emblem: number): string {
  let s = `<svg class="thumb" viewBox="0 0 ${VW} ${VH}" aria-hidden="true"><path class="frame" d="M4 4 H${VW - 4} V${VH - 4} H${PAD + 4 * C + 6} V${VH - 30} H${PAD + 3 * C - 6} V${VH - 4} H4 Z"/><rect class="floor" x="${PAD}" y="${PAD}" width="${W * C}" height="${H * C}" rx="6"/>`
  v.guards.forEach((g, i) => {
    const cyc = cycleOf(g)
    const pts = g.path.map(c => `${px(c)} ${py(c)}`)
    if (cyc.period > 1)
      s += `<path class="route" d="M${pts.join(' L')}${cyc.loop ? ' Z' : ''}" stroke-dasharray="${DASH[i % 4]}"/>`
    s += `<g transform="translate(${px(g.path[0]!)} ${py(g.path[0]!)}) scale(1.5) translate(0 31)">${headShape(i, 'var(--guard)')}</g>`
  })
  for (let c = 0; c < N; c++)
    if (v.walls[c])
      s += `<rect class="wall" x="${PAD + cx(c) * C + 3}" y="${PAD + cy(c) * C + 3}" width="${C - 6}" height="${C - 6}" rx="7"/>`
  s += `<g transform="translate(${px(v.loot)} ${py(v.loot)}) scale(1.5)">${emblemArt(emblem)}</g>`
  return `${s}</svg>`
}
