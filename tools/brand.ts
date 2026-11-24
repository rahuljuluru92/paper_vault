/**
 * Subreddit art, drawn from the game's own sprites so the sub matches the board.
 *
 *   node --experimental-strip-types tools/brand.ts <out-dir>
 *
 * Writes icon.html (512x512) and banner.html (1920x384) to <out-dir>, ready for
 * a headless browser screenshot. The PNGs live in assets/reddit/.
 */

import {writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {emblemArt, guardDoll, headShape, THIEF} from '../src/client/board.ts'

const out = process.argv[2] ?? '.'
const css = resolve('public/style.css')

const page = (w: number, h: number, svg: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${css}">
<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:var(--desk)}
svg{display:block}.sack{display:block}.route{opacity:.7}</style></head>
<body>${svg}</body></html>`

const defs = `<defs>
  <pattern id="lit" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="18" height="18" fill="var(--light)"/><rect width="7" height="18" fill="var(--light-deep)"/>
  </pattern>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
    <circle cx="14" cy="14" r="2.2" fill="var(--desk-deep)"/>
  </pattern>
  <filter id="lift" x="-5%" y="-30%" width="110%" height="160%">
    <feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#0b1c20" flood-opacity=".45"/>
  </filter>
  <filter id="fig" x="-40%" y="-40%" width="180%" height="190%">
    <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#0b1c20" flood-opacity=".35"/>
  </filter>
</defs>`

// --- Banner: one long strip of vault floor, mid-heist ----------------------

const C = 100
const TOP = 100
const COLS = 20
const x = (col: number): number => col * C + C / 2
const y = (row: number): number => TOP + row * C + C / 2

function banner(): string {
  const walls: [number, number][] = [
    [1, 0],
    [4, 0],
    [5, 0],
    [8, 1],
    [11, 0],
    [12, 0],
    [15, 1],
    [18, 0],
    [19, 1],
  ]
  // Pencil line from the door to the thief, then the planned route on to the loot.
  const done: [number, number][] = [
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 1],
    [7, 1],
    [7, 0],
    [8, 0],
    [9, 0],
  ]
  const plan: [number, number][] = [
    [9, 0],
    [10, 0],
    [10, 1],
    [11, 1],
    [12, 1],
    [13, 1],
    [14, 1],
    [14, 0],
    [15, 0],
    [16, 0],
    [17, 0],
  ]
  const guards = [
    {
      cell: [3, 0],
      route: [
        [2, 0],
        [3, 0],
      ],
      dir: 3,
      beam: [
        [2, 0],
        [2, 0],
      ],
      head: 0,
    },
    {
      cell: [13, 0],
      route: [
        [13, 0],
        [14, 0],
        [15, 0],
      ],
      dir: 1,
      beam: [
        [14, 0],
        [15, 0],
      ],
      head: 1,
    },
    {
      cell: [17, 1],
      route: [
        [16, 1],
        [17, 1],
        [18, 1],
      ],
      dir: 3,
      beam: [
        [16, 1],
        [16, 1],
      ],
      head: 2,
    },
  ] as const
  const DX = [0, 1, 0, -1]
  const DY = [-1, 0, 1, 0]
  const DASH = ['', '26 14', '2 16']
  const pts = (cells: readonly (readonly number[])[]): string =>
    cells.map(([c, r]) => `${x(c!)} ${y(r!)}`).join(' L')

  let s = `<svg width="1920" height="384" viewBox="0 0 2000 400">${defs}
  <rect width="2000" height="400" fill="var(--desk)"/><rect width="2000" height="400" fill="url(#dots)" opacity=".7"/>
  <g filter="url(#lift)">
    <rect x="-20" y="${TOP - 16}" width="2040" height="${2 * C + 32}" fill="var(--kraft)"/>
    <rect x="-20" y="${TOP}" width="2040" height="${2 * C}" fill="var(--floor)"/>
  </g>
  <rect x="${2 * C + 10}" y="${TOP + 2 * C}" width="${C - 20}" height="16" fill="var(--mint)"/>
  <path class="mat-line" d="M${2 * C + 30} ${TOP + 2 * C + 8} H${3 * C - 30}"/>`
  for (let c = 1; c < COLS; c++)
    s += `<path class="seam" d="M${c * C} ${TOP + 8} V${TOP + 2 * C - 8}"/>`
  s += `<path class="seam" d="M8 ${TOP + C} H${COLS * C - 8}"/>`
  guards.forEach((g, i) => {
    s += `<path class="route" d="M${pts(g.route)}" stroke-dasharray="${DASH[i]}"/>`
    const [a, b] = g.beam
    const bx = Math.min(x(a[0]), x(b[0])) - C / 2 + 7
    const by = Math.min(y(a[1]), y(b[1])) - C / 2 + 7
    const bw = Math.abs(x(a[0]) - x(b[0])) + C - 14
    const bh = Math.abs(y(a[1]) - y(b[1])) + C - 14
    s += `<rect class="lit" fill="url(#lit)" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="16"/>`
  })
  for (const [c, r] of walls) {
    const wx = c * C + 3
    const wy = TOP + r * C + 3
    s += `<rect class="wall" x="${wx}" y="${wy}" width="${C - 6}" height="${C - 6}" rx="7"/><rect class="wall-top" x="${wx}" y="${wy}" width="${C - 6}" height="${C - 24}" rx="7"/>`
  }
  s += `<ellipse cx="${x(17)}" cy="${y(0) + 30}" rx="30" ry="8" fill="var(--seam)"/>`
  s += `<g transform="translate(${x(17)} ${y(0)}) scale(1.15)">${emblemArt(0)}</g>`
  s += `<path class="line" d="M${x(2)} ${TOP + 2 * C + 14} L${pts(done)}"/>`
  s += `<path class="line out" d="M${pts(plan)}"/>`
  guards.forEach((g, i) => {
    const doll = guardDoll(i).replace(
      '<g class="lamp">',
      `<g class="lamp" transform="translate(${DX[g.dir]! * 30} ${DY[g.dir]! * 24 + 6})">`,
    )
    s += `<g filter="url(#fig)" transform="translate(${x(g.cell[0])} ${y(g.cell[1])})">${doll}</g>`
  })
  s += `<g filter="url(#fig)" transform="translate(${x(9)} ${y(0)})"><g class="thief">${THIEF.replace('<g class="sack">', '<g class="sack" style="display:none">')}</g></g>`
  return `${s}</svg>`
}

// --- Icon: Scrap the cat with the loot, on a sheet of vault floor -----------

function icon(): string {
  return `<svg width="512" height="512" viewBox="0 0 200 200">${defs}
  <rect width="200" height="200" fill="var(--desk)"/><rect width="200" height="200" fill="url(#dots)" opacity=".7"/>
  <g transform="rotate(-6 100 104)" filter="url(#lift)">
    <rect x="30" y="34" width="140" height="140" rx="12" fill="var(--kraft)"/>
    <rect x="38" y="42" width="124" height="124" rx="8" fill="var(--floor)"/>
    <path class="seam" d="M100 50 V158 M46 104 H154"/>
  </g>
  <g transform="translate(143 60) scale(.78) rotate(10)" filter="url(#fig)">${emblemArt(0)}</g>
  <g transform="translate(96 108) scale(1.75)" filter="url(#fig)">${THIEF}</g>
</svg>`
}

writeFileSync(join(out, 'banner.html'), page(1920, 384, banner()))
writeFileSync(join(out, 'icon.html'), page(512, 512, icon()))
console.log(`wrote banner.html and icon.html to ${out}`)
