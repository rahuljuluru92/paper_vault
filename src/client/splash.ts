import {requestExpandedMode} from '@devvit/web/client'
import {type InitRsp, vaultTitle} from '../shared/api.ts'
import {decodeVault, startState} from '../shared/engine.ts'
import {dayLabel, TIER_WORDS, tierForDay} from '../shared/gen.ts'
import {Board} from './board.ts'
import {$, fit, get, reducedMotion} from './dom.ts'

const start = $<HTMLButtonElement>('start-btn')
start.addEventListener('click', ev => {
  try {
    requestExpandedMode(ev, 'game')
  } catch {
    location.href = 'game.html'
  }
})

async function main(): Promise<void> {
  const rsp = await get<InitRsp>('/api/init')
  if (!rsp) return
  const card = rsp.daily
  const vault = decodeVault(card.code)
  if (!vault) return
  const board = new Board($('stage'))
  board.setVault(vault, card.label.e)
  const refit = (): void => fit($('stage'), board.svg)
  new ResizeObserver(refit).observe($('stage'))
  $('s-name').textContent = vaultTitle(card)
  $('s-date').textContent = `${dayLabel(card.day)} · ${TIER_WORDS[tierForDay(card.day)]}`
  $('s-crews').textContent =
    card.runs === 0 ? 'No crew has cracked it yet' : card.runs === 1 ? '1 crew through so far' : `${card.runs} crews through so far`
  const streak = rsp.me.streak
  if (card.my) {
    const over = card.my.moves - card.my.par
    $('s-line').textContent =
      `You got out in ${card.my.moves}${over <= 0 ? ', on the ghost line.' : `, ${over} over the ghost line.`}` +
      (streak > 1 ? ` 🔥 ${streak} nights running.` : '')
    start.textContent = 'See your card and the crew vaults'
  } else if (streak > 0) $('s-line').textContent = `🔥 ${streak}-night streak. Keep it going tonight.`
  // The post is a living diorama: guards walk their rounds in the feed.
  const s = startState()
  board.render({states: [s], empty: true})
  refit()
  if (reducedMotion()) return
  setInterval(() => {
    if (document.hidden) return
    s.k++
    board.render({states: [s], empty: true})
  }, 620)
}
void main()
