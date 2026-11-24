import {
  type InitRsp,
  LEVELS,
  type Me,
  type OkRsp,
  type Result,
  type ShareRsp,
  shareText,
  type StartRsp,
  stampFor,
  type VaultCard,
  type VaultsRsp,
  vaultTitle,
} from '../shared/api.ts'
import {
  type Compiled,
  compile,
  decodeVault,
  dirBetween,
  MAX_MOVES,
  type Move,
  simulate,
  type State,
  startState,
  step,
  type Vault,
} from '../shared/engine.ts'
import {LESSON_CODES, labelText} from '../shared/gen.ts'
import {Board, thumb} from './board.ts'
import {$, fit, get, post, reducedMotion, toast} from './dom.ts'
import {Workshop} from './shop.ts'
import {setSound, sfx, soundOn} from './sound.ts'

/** Three ten-second vaults, one idea each: walk, hold, bell. */
type Lesson = {emblem: number; start: string; learned: string; next: string}
const LESSONS: Lesson[] = [
  {
    emblem: 0,
    start: 'Tap a green square to sneak Scrap, the cat, toward the gem.',
    learned: 'In, grab, out. That is every job.',
    next: 'Next: a guard',
  },
  {
    emblem: 3,
    start: 'Guards only move when you move. The red arrow is his next step.',
    learned: 'Guards move only when you do, and holding still counts as a move.',
    next: 'Next: the bell',
  },
  {
    emblem: 1,
    start: 'This guard stands still and his lantern shuts the right side. Go round the left.',
    learned: 'After the bell the way out is never the way in. Fewest moves wins.',
    next: 'Level 1',
  },
]

type Kind = 'warm' | 'scored' | 'test'
type Session = {
  kind: Kind
  lesson: number
  card: VaultCard | undefined
  title: string
  by: string
  c: Compiled
  states: State[]
  moves: string
  journeyId: string
  started: boolean
  busy: boolean
  result: Result | undefined
  flash: string
}

let me: Me = {name: '', signedIn: false, warmedUp: false, quiet: false, streak: 0, marks: 0}
let daily: VaultCard | undefined
let sess: Session | undefined
let watching = 0

const board = new Board($('stage'))
const hint = $('hint')
const cardEl = $('card')
const controls = $('controls')
const bUndo = $<HTMLButtonElement>('b-undo')
const bWait = $<HTMLButtonElement>('b-wait')
const bRun = $<HTMLButtonElement>('b-run')

// --- Tabs ------------------------------------------------------------------

type Tab = 'play' | 'shelf' | 'shop'
function show(tab: Tab): void {
  for (const id of ['play', 'shelf', 'shop'] as const) $(id).hidden = id !== tab
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button'))
    b.setAttribute('aria-selected', `${b.dataset.tab === tab}`)
  if (tab === 'shelf') void loadShelf()
  if (tab === 'shop') shop.open()
  if (tab === 'play') refit()
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button'))
  b.addEventListener('click', () => {
    const tab = b.dataset.tab as Tab
    // "Tonight" always means the daily, whatever was open before.
    if (tab === 'play' && daily && sess?.kind !== 'warm' && sess?.card !== daily) void openVault(daily)
    show(tab)
  })

const refit = (): void => fit($('stage'), board.svg)
new ResizeObserver(refit).observe($('stage'))

// --- A session on one vault --------------------------------------------------

function begin(kind: Kind, vault: Vault, emblem: number, title: string, by: string, card?: VaultCard, lesson = 0): void {
  watching++
  sess = {
    kind,
    lesson,
    card,
    title,
    by,
    c: compile(vault),
    states: [startState()],
    moves: '',
    journeyId: '',
    started: false,
    busy: false,
    result: undefined,
    flash: '',
  }
  board.setVault(vault, emblem)
  $('v-name').textContent = title
  renderBy()
  cardEl.hidden = true
  controls.hidden = false
  hint.hidden = false
  $('play').classList.remove('done')
  draw()
  refit()
}

function renderBy(): void {
  const s = sess!
  const el = $('v-by')
  el.textContent = ''
  if (s.by) el.textContent = `by u/${s.by}`
  if (s.kind === 'warm') {
    const skip = document.createElement('button')
    skip.className = 'link'
    skip.type = 'button'
    skip.textContent = 'Skip lessons'
    skip.addEventListener('click', () => {
      doneWarming()
      if (daily) void openVault(daily)
    })
    el.append(skip)
    return
  }
  const c = s.card
  if (!c || c.day || !c.by) return
  const link = document.createElement('button')
  link.className = 'link'
  link.type = 'button'
  link.textContent = c.mine ? 'Take down' : 'Report'
  let armed = false
  link.addEventListener('click', async () => {
    if (!armed) {
      armed = true
      link.textContent = c.mine ? 'Really take it down?' : 'Report this vault?'
      return
    }
    link.disabled = true
    const ok = await post<OkRsp>(c.mine ? '/api/vault/delete' : '/api/vault/report', {id: c.id})
    if (!ok) return toast('That did not go through. Try again in a moment.')
    toast(c.mine ? 'Taken down.' : 'Reported. Thank you.')
    if (c.mine) show('shelf')
    else link.textContent = 'Reported'
  })
  el.append(' ', link)
}

function draw(): void {
  const s = sess!
  const now = s.states[s.states.length - 1]!
  board.render({states: s.states, marks: !s.busy})
  const n = s.states.length - 1
  $('v-count').textContent = now.done ? `${n} moves` : `Beat ${n}`
  bUndo.disabled = n === 0 || s.busy
  bWait.hidden = now.done || (s.kind === 'warm' && s.lesson === 0)
  bRun.hidden = !now.done || s.kind === 'warm'
  bRun.disabled = s.busy
  bWait.disabled = s.busy || !step(s.c, now, 4).ok
  hint.textContent = hintFor(s, now)
  s.flash = ''
}

function hintFor(s: Session, now: State): string {
  if (s.flash) return s.flash
  const n = s.states.length - 1
  const prev = s.states[n - 1]
  const warm = s.kind === 'warm'
  if (now.done)
    return warm
      ? 'Out! Watch it happen.'
      : `That works: ${n} moves. Run it, or undo and hunt for a shorter way. Your first run is the one that counts.`
  if (now.has && prev && !prev.has)
    return warm && s.lesson === 0
      ? 'Got it. Now back to the door mat.'
      : warm && s.lesson === 2
        ? 'The bell! Every guard turns round. The way in is shut, so find another way out.'
        : 'The bell! Every guard turns on their heel and walks their route backwards.'
  if (warm && s.lesson === 0) return n === 0 ? LESSONS[0]!.start : now.has ? 'Back to the door mat.' : 'Keep going. Tap green squares, or drag a path.'
  if (n === 0)
    return warm
      ? LESSONS[s.lesson]!.start
      : matchMedia('(hover: hover)').matches
        ? 'Plan a path to the loot and back to the mat. Arrow keys move, space holds, Z undoes.'
        : 'Plan a path to the loot and back to the mat. Fewest moves wins.'
  let blocked = false
  for (let m = 0; m < 5; m++) {
    const r = step(s.c, now, m as Move)
    if (!r.ok && r.why !== 'wall') blocked = true
  }
  if (blocked)
    return warm && s.lesson === 1
      ? 'The dashed box is where his lantern shines after your next move. Press Hold to let him pass.'
      : 'Dashed boxes show where the lanterns shine after your next move. Hold still, or go round.'
  if (now.has) return 'Loot in the bag. Now back to the door mat.'
  return 'Each move you make, every guard takes one step along his arrow. Green squares are safe.'
}

function tryMove(m: Move): void {
  const s = sess
  if (!s || s.busy || s.result) return
  const now = s.states[s.states.length - 1]!
  if (s.moves.length >= MAX_MOVES && !now.done) {
    s.flash = `A job can take ${MAX_MOVES} moves at most. Undo and find a shorter way.`
    draw()
    return
  }
  const r = step(s.c, now, m)
  if (!r.ok) {
    s.flash =
      r.why === 'wall'
        ? 'Solid paper. No way through.'
        : r.why === 'guard'
          ? 'That walks you straight into a guard.'
          : r.why === 'light'
            ? m === 4
              ? 'Stay here and the lantern finds you. Move.'
              : 'You would be standing in the lantern light. Hold a beat, or go round.'
            : 'You are out. Run the job, or undo.'
    sfx.blocked()
    draw()
    hint.classList.remove('nudge')
    void hint.offsetWidth
    hint.classList.add('nudge')
    return
  }
  s.states.push(r.state)
  s.moves += 'URDLW'[m]
  if (r.state.has && !now.has) {
    board.ring()
    sfx.bell()
  } else if (m === 4) sfx.hold()
  else sfx.step()
  if (!s.started && s.kind === 'scored') {
    s.started = true
    const id = s.card!.id
    void post<StartRsp>('/api/start', {vaultId: id}).then(j => {
      if (j && sess === s) s.journeyId = j.journeyId
    })
  }
  draw()
  // Lessons have nothing at stake, so the job runs the moment you are out.
  if (s.kind === 'warm' && r.state.done) void runJob()
}

function undo(to?: number): void {
  const s = sess
  if (!s || s.busy || s.result) return
  const keep = to ?? s.states.length - 2
  if (keep < 0) return
  s.states.length = keep + 1
  s.moves = s.moves.slice(0, keep)
  sfx.undo()
  draw()
}

let dragged = false
board.onCell = (cell, phase) => {
  const s = sess
  if (!s || s.busy || s.result) return
  const now = s.states[s.states.length - 1]!
  if (phase === 'down') dragged = false
  if (phase === 'up') {
    if (!dragged && cell === now.pos && downOnSelf) tryMove(4)
    downOnSelf = false
    return
  }
  if (cell === now.pos) {
    if (phase === 'down') downOnSelf = true
    return
  }
  const d = dirBetween(now.pos, cell)
  if (d !== -1) {
    const back = s.states[s.states.length - 2]
    dragged = true
    if (phase === 'move' && back && back.pos === cell) undo()
    else tryMove(d)
    return
  }
  if (phase === 'down') {
    for (let i = s.states.length - 2; i >= 0; i--)
      if (s.states[i]!.pos === cell) return undo(i)
    s.flash = 'One square at a time. Tap next to Scrap, or drag a path.'
    draw()
  }
}
let downOnSelf = false

bUndo.addEventListener('click', () => undo())
bWait.addEventListener('click', () => tryMove(4))
bRun.addEventListener('click', () => void runJob())
addEventListener('keydown', ev => {
  if ($('play').hidden || ev.metaKey || ev.ctrlKey) return
  const k = ev.key.toLowerCase()
  const m = ({arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3, ' ': 4} as Record<string, Move>)[k]
  if (m !== undefined) {
    ev.preventDefault()
    tryMove(m)
  } else if (k === 'z' || k === 'backspace') undo()
  else if (k === 'enter' && sess && !bRun.hidden) void runJob()
})

/** Lights out: play a list of states on the board. Tap the board to skip. */
async function playback(states: State[], token: number): Promise<void> {
  const beat = reducedMotion() ? 140 : 250
  let skip = false
  const stop = (): void => {
    skip = true
  }
  board.svg.addEventListener('pointerdown', stop, {once: true})
  for (let i = 0; i < states.length; i++) {
    if (token !== watching) return
    board.render({states: states.slice(0, i + 1), night: true})
    if (!skip && i > 0) {
      const s = states[i]!
      const was = states[i - 1]!
      if (s.has && !was.has) sfx.bell()
      else if (s.pos !== was.pos) sfx.foot()
    }
    if (!skip) await new Promise(r => setTimeout(r, beat))
  }
  board.svg.removeEventListener('pointerdown', stop)
  if (!skip) await new Promise(r => setTimeout(r, 350))
}

async function runJob(): Promise<void> {
  const s = sess
  if (!s || s.busy) return
  s.busy = true
  draw()
  hint.textContent = 'Lights out.'
  const token = ++watching
  const asked =
    s.kind === 'scored'
      ? post<Result>('/api/run', {vaultId: s.card!.id, moves: s.moves, journeyId: s.journeyId})
      : undefined
  await playback(s.states, token)
  if (token !== watching) return
  if (s.kind === 'test') {
    toast(`It holds. Out in ${s.moves.length} moves.`)
    show('shop')
    return
  }
  if (s.kind === 'warm') {
    if (s.lesson === LESSONS.length - 1) doneWarming()
    showWarmCard(s.lesson)
    return
  }
  const res = await asked
  if (token !== watching) return
  if (!res) {
    s.busy = false
    draw()
    hint.textContent = 'The job ran, but the result did not reach the ledger. Check your connection and run it again.'
    return
  }
  s.result = res
  if (s.card) s.card.my = {moves: res.moves.length, par: res.par}
  showCard(s, res, s.moves)
}

// --- The one result card -----------------------------------------------------

/** The stamp drops in after 0.3 s and lands about 0.15 s later (see `thunk` in style.css). */
function stampSound(ghost: boolean): void {
  sfx.stamp(ghost, reducedMotion() ? 0 : 0.42)
}

function doneWarming(): void {
  me.warmedUp = true
  void post<OkRsp>('/api/warm', {})
}

function showWarmCard(at: number): void {
  const l = LESSONS[at]!
  const last = at === LESSONS.length - 1
  controls.hidden = true
  hint.hidden = true
  cardEl.hidden = false
  $('play').classList.add('done')
  cardEl.innerHTML = `
    <div class="card-head">
      <div class="stamp" data-s="Ghost">Out</div>
      <div><p class="card-score">Lesson ${at + 1} of ${LESSONS.length} done</p>
      <p class="card-sub">${l.learned}</p></div>
    </div>
    <div class="row">${last ? '<button id="c-daily" class="btn" type="button">Tonight\'s vault</button>' : ''}<button id="c-next" class="btn gold" type="button">${l.next}</button></div>`
  stampSound(false)
  $('c-next').addEventListener('click', () => (last ? void openLevel(1) : openWarm(at + 1)))
  document.getElementById('c-daily')?.addEventListener('click', () => daily && void openVault(daily))
  refit()
}

function showCard(s: Session, r: Result, thisRun: string): void {
  const card = s.card!
  const mine = r.moves.length
  const over = mine - r.par
  const stamp = stampFor(mine, r.par)
  const max = Math.max(1, ...r.hist)
  const myBucket = Math.min(r.hist.length - 1, Math.max(0, over))
  const bars = r.hist
    .map((n, i) => `<div class="${i === myBucket && r.saved ? 'me' : ''}" style="height:${n ? Math.max(12, (n / max) * 100) : 0}%" title="${n}"></div>`)
    .join('')
  const axis = r.hist.map((_, i) => `<span>${i === 0 ? 'ghost' : i === r.hist.length - 1 ? `${i}+` : `+${i}`}</span>`).join('')
  const ghosts = r.hist[0] ?? 0
  const longer = r.hist.reduce((a, n, i) => a + (i > myBucket ? n : 0), 0)
  let crowd: string
  if (card.mine) crowd = 'Your own vault, so your runs here stay off the books.'
  else if (!r.saved)
    crowd = 'You are not signed in, so this job is off the books. Sign in and your first run counts; then you can watch the ghost line.'
  else if (r.runs <= 1) crowd = 'You are the first crew through. Everyone after you gets measured against this.'
  else if (r.runs < 6) crowd = `${r.runs} crews so far. ${ghosts === 0 ? 'Nobody has' : ghosts === 1 ? 'One has' : `${ghosts} have`} found the ghost line.`
  else crowd = `Shorter than ${Math.round((longer / (r.runs - 1)) * 100)}% of ${r.runs} crews. ${ghosts} found the ghost line.`
  if (!r.first && r.saved && thisRun.length !== mine) crowd = `This run took ${thisRun.length}, but your first job is the one on record. ${crowd}`
  if (card.day && r.streak > 1) crowd += ` ${r.streak} nights running.`
  if (card.by && !card.mine && r.first) crowd += ` Your run pays u/${esc(card.by)} marks. Vaults that are neither soft nor fiendish pay most.`
  const sub = over <= 0 ? 'That is the ghost line. There is no shorter way.' : `Ghost line: ${r.par}. You were ${over} over.`
  const climbing = card.level > 0 && card.level < LEVELS
  const crews = r.replays.map(p => ({name: `u/${p.name}`, moves: p.moves}))
  let crewAt = -1
  $('v-count').textContent = `${mine} moves`
  controls.hidden = true
  hint.hidden = true
  cardEl.hidden = false
  $('play').classList.add('done')
  cardEl.innerHTML = `
    <div class="card-head">
      <div class="stamp" data-s="${stamp}">${stamp}</div>
      <div><p class="card-score">Out in ${mine} moves</p><p class="card-sub">${sub}</p></div>
    </div>
    ${r.runs >= 3 ? `<div><div class="hist" role="img" aria-label="Crews by moves over the ghost line">${bars}</div><div class="hist-axis">${axis}</div></div>` : ''}
    <p class="crowd">${crowd}</p>
    <div class="chips"><span>Watch</span>${r.ghost ? '<button class="chip" type="button" data-w="ghost" aria-pressed="false">Ghost line</button>' : ''}<button class="chip" type="button" data-w="mine" aria-pressed="false">Yours</button>${crews.length ? `<button class="chip" type="button" data-w="crew" aria-pressed="false">Others</button>` : ''}</div>
    <div class="row" id="c-actions">
      <button id="c-copy" class="btn small" type="button">Copy result</button>
      ${me.signedIn && r.saved && !card.mine ? `<button id="c-post" class="btn small" type="button" ${r.shared ? 'disabled' : ''}>${r.shared ? 'Posted' : `Post as u/${esc(me.name)}`}</button>` : ''}
      <button id="c-next" class="btn gold small" type="button">${climbing ? `Level ${card.level + 1}` : card.day ? 'Levels' : 'More vaults'}</button>
    </div>`
  const text = shareText(card, r.moves, r.par, r.streak)
  stampSound(stamp === 'Ghost')
  $('c-copy').addEventListener('click', async () => {
    const ok = await copy(text)
    toast(ok ? 'Copied. Paste it anywhere.' : 'Could not reach the clipboard here.')
    void post<ShareRsp>('/api/share', {vaultId: card.id, kind: 'copy', journeyId: s.journeyId})
  })
  $('c-next').addEventListener('click', () => (climbing ? void openLevel(card.level + 1) : show('shelf')))
  const postBtn = document.getElementById('c-post') as HTMLButtonElement | null
  postBtn?.addEventListener('click', () => confirmPost(s, card))
  for (const chip of cardEl.querySelectorAll<HTMLButtonElement>('.chip'))
    chip.addEventListener('click', async () => {
      let moves = chip.dataset.w === 'ghost' ? r.ghost : r.moves
      if (chip.dataset.w === 'crew') {
        // Each tap plays the next crew's route and names whose it is.
        crewAt = (crewAt + 1) % crews.length
        const crew = crews[crewAt]!
        moves = crew.moves
        chip.textContent = `${crew.name} · ${crew.moves.length}`
      }
      const states = simulate(s.c, moves)
      if (!states) return
      for (const c of cardEl.querySelectorAll('.chip')) c.setAttribute('aria-pressed', `${c === chip}`)
      await playback(states, ++watching)
    })
  board.render({states: simulate(s.c, r.moves) ?? s.states, night: true})
  refit()
}

/** Posting is a second, explicit step that says exactly what will happen. */
function confirmPost(s: Session, card: VaultCard): void {
  const row = $('c-actions')
  const before = [...row.children]
  row.innerHTML = `
    <p class="fine" style="flex:2">This posts your result as a comment from <b>u/${esc(me.name)}</b>, replying to the pinned results comment.</p>
    <button id="c-yes" class="btn gold small" type="button">Post it</button>
    <button id="c-no" class="btn small" type="button">Cancel</button>`
  const restore = (): void => row.replaceChildren(...before)
  $('c-no').addEventListener('click', restore)
  $('c-yes').addEventListener('click', async () => {
    $<HTMLButtonElement>('c-yes').disabled = true
    const ok = await post<ShareRsp>('/api/share', {vaultId: card.id, kind: 'comment', journeyId: s.journeyId})
    restore()
    const b = document.getElementById('c-post') as HTMLButtonElement | null
    if (ok && b) {
      b.disabled = true
      b.textContent = 'Posted'
    }
    toast(ok ? 'Posted under the pinned comment.' : 'That did not post. You can still copy it.')
  })
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

const esc = (s: string): string => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)

// --- Opening vaults ----------------------------------------------------------

async function openVault(card: VaultCard): Promise<void> {
  const vault = decodeVault(card.code)
  if (!vault) return toast('That vault has crumbled. Pick another.')
  begin('scored', vault, card.label.e, vaultTitle(card), card.day ? '' : card.by, card)
  show('play')
  if (!card.my) return
  const s = sess!
  s.busy = true
  draw()
  hint.textContent = 'Fetching your card.'
  const res = await post<Result>('/api/result', {vaultId: card.id})
  if (sess !== s) return
  if (!res) {
    s.busy = false
    return draw()
  }
  s.result = res
  showCard(s, res, res.moves)
}

/** The ladder of house vaults, each rung harder than the last. */
async function openLevel(n: number): Promise<void> {
  let card = shelf.find(c => c.level === n)
  if (!card) {
    const rsp = await get<VaultsRsp>('/api/vaults')
    if (rsp) shelf = rsp.vaults
    card = shelf.find(c => c.level === n)
  }
  if (card) await openVault(card)
  else show('shelf')
}

function openWarm(at = 0): void {
  const l = LESSONS[at]!
  begin('warm', decodeVault(LESSON_CODES[at]!)!, l.emblem, `Lesson ${at + 1} of ${LESSONS.length}`, '', undefined, at)
}

// --- The shelf ---------------------------------------------------------------

let shelf: VaultCard[] = []
let page = 0
const EST = ['Gentle', 'Tricky', 'Knotty']
const SEAL = {new: '', soft: 'Soft', well: 'Well cut', fiend: 'Fiendish', fair: 'Fair'}

async function loadShelf(): Promise<void> {
  const tiles = $('tiles')
  if (!shelf.length) tiles.innerHTML = '<p>Pulling vaults off the shelf.</p>'
  const rsp = await get<VaultsRsp>('/api/vaults')
  if (!rsp) {
    tiles.innerHTML = '<p>The shelf would not open. Check your connection and tap Shelf again.</p>'
    return
  }
  shelf = rsp.vaults
  me = rsp.me
  const top = rsp.cutters.map(c => `u/${c.name} ${c.marks}`).join(' · ')
  $('cutters').textContent = top ? `Top cutters: ${top}` : me.marks ? `Your marks: ${me.marks}` : 'Cut a vault to earn marks'
  renderShelf()
}

function renderShelf(): void {
  const tiles = $('tiles')
  const box = tiles.getBoundingClientRect()
  const cols = box.width >= 600 ? 3 : 2
  const rows = Math.max(2, Math.min(4, Math.floor(box.height / 128)))
  const per = cols * rows
  const pages = Math.max(1, Math.ceil(shelf.length / per))
  page = Math.min(page, pages - 1)
  tiles.style.setProperty('--cols', `${cols}`)
  tiles.style.setProperty('--rows', `${rows}`)
  tiles.replaceChildren()
  for (const card of shelf.slice(page * per, page * per + per)) {
    const v = decodeVault(card.code)
    if (!v) continue
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tile'
    const tags: string[] = []
    if (card.my) tags.push(`<span class="tag done">${card.my.moves <= card.my.par ? 'Ghost' : `+${card.my.moves - card.my.par}`}</span>`)
    tags.push(card.seal === 'new' ? `<span class="tag">${EST[card.est]}</span>` : `<span class="tag ${card.seal}">${SEAL[card.seal]}</span>`)
    tags.push(`<span class="tag">${card.runs === 0 ? 'Uncracked' : card.runs === 1 ? '1 crew' : `${card.runs} crews`}</span>`)
    b.innerHTML = `${thumb(v, card.label.e)}<span><span class="tile-name">${labelText(card.label)}</span><span class="tile-by">${card.mine ? 'Yours' : card.by ? `u/${esc(card.by)}` : `Level ${card.level}`}</span>${tags.join('')}</span>`
    b.addEventListener('click', () => void openVault(card))
    tiles.append(b)
  }
  $('p-note').textContent = `Page ${page + 1} of ${pages}`
  $<HTMLButtonElement>('p-prev').disabled = page === 0
  $<HTMLButtonElement>('p-next').disabled = page >= pages - 1
}
$('p-prev').addEventListener('click', () => {
  page--
  renderShelf()
})
$('p-next').addEventListener('click', () => {
  page++
  renderShelf()
})
new ResizeObserver(() => !$('shelf').hidden && shelf.length && renderShelf()).observe($('tiles'))

// --- The workshop ------------------------------------------------------------

const shop = new Workshop({
  signedIn: () => me.signedIn,
  test: (vault, label) => {
    begin('test', vault, label.e, `Trying · ${labelText(label)}`, '')
    show('play')
  },
  published: () => {
    page = 0
    show('shelf')
  },
})

// --- Sound -------------------------------------------------------------------

const bSound = $<HTMLButtonElement>('b-sound')
function paintSound(): void {
  bSound.setAttribute('aria-pressed', String(soundOn()))
  bSound.title = soundOn() ? 'Sound on' : 'Sound off'
}
bSound.addEventListener('click', () => {
  setSound(!soundOn())
  me.quiet = !soundOn()
  paintSound()
  if (soundOn()) sfx.hold()
  void post<OkRsp>('/api/sound', {quiet: me.quiet})
})

// --- Go ----------------------------------------------------------------------

async function main(): Promise<void> {
  hint.textContent = 'Unrolling the plans.'
  const rsp = await get<InitRsp>('/api/init')
  if (!rsp) {
    hint.textContent = 'The plans did not arrive. Check your connection and reopen the post.'
    return
  }
  me = rsp.me
  setSound(!me.quiet)
  paintSound()
  daily = rsp.daily
  if (!me.warmedUp && !daily.my) openWarm()
  else await openVault(daily)
  if (rsp.todayUrl && daily.day < rsp.today) toast(`This is an older vault. No. ${rsp.today} is out tonight.`)
}
void main()
