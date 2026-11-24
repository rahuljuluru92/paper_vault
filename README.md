# Paper Vault

A daily heist-planning puzzle for Reddit, built as a Devvit Web interactive post.

Every day there is one new vault. Guards walk routes you can see. You plan a path in pencil — in through the door, lift the loot, back out — in as few moves as you can. Then you commit and watch the job play. After that, the other half opens up: cutting vaults of your own for other crews to crack.

## How to play

1. **Open the post and press "Case the vault."** The post itself is a small living diorama of tonight's vault.
2. **Plan your route.** Tap a square next to Scrap (the cat) to step there, or drag a path. Tap Scrap or press **Hold** to wait a beat. On a keyboard: arrow keys move, space holds, Z undoes, Enter runs.
3. **Read the room.** Each guard steps one square per beat toward their lantern and lights the three squares ahead; walls cut the light short. The board shows the moment at the tip of your pencil line: green squares are safe, a cross would get you seen, and dashed boxes show where lanterns shine next. Undo freely.
4. **Mind the bell.** The moment you lift the loot, every guard turns on their heel and walks their route *backwards*. The way out is never quite the way in, and when you grab matters.
5. **Run the job.** Once your line reaches the door mat with the loot, press **Run the job**. Your first run on a vault is the one that counts.
6. **Read your card.** One result card shows your moves against the *ghost line* (the shortest route that exists), where you sit among other crews, and replays you can watch: the ghost line, your own, and other players'.

First time here? Three ten-second lessons teach it by doing: walk, wait, bell. Then twelve numbered levels climb from one guard to four.

### Stamps

- **Ghost** — you matched the shortest possible route.
- **Clean** — within two moves of it.
- **Out** — you got out. That still counts.

### Sharing

**Copy result** puts a short, spoiler-free summary on your clipboard: your move count and a "rhythm strip" (▪ step, ▫ held breath, ◆ the grab). An optional second button posts the same text as a comment *from your account*, as a reply to the pinned results comment. It asks you to confirm first, and nothing in the game is locked behind it.

## Cutting vaults

The **Workshop** tab is a vault editor. A vault is made of only three things: **walls**, **guards** (drag to draw a patrol, or tap to stand one still and tap again to turn them) and **loot**. The name is picked from two word lists and a loot emblem; there is no free text anywhere.

A solver checks your vault on every edit. If there is no way out, it cannot be published. You can try your own vault before putting it on the **Shelf**.

Designers earn **marks** whenever a crew runs their vault. A vault pays most when between a quarter and 60% of crews find its ghost line — too soft or too cruel pays little. Vaults earn a seal once three crews have run them: *Soft*, *Fair*, *Well cut*, or *Fiendish*. Until then they show the solver's estimate.

You can take down your own vaults. You can report someone else's; three reports take a vault off the shelf.

## How it works

- **The rules** live in one small shared module (`src/shared/engine.ts`) used by both the browser and the server, so they can never disagree.
- **The solver** is a breadth-first search over (square, beat, beat of the grab). It returns the shortest clean route or proves there is none within 72 moves. Every vault — daily, house, or player-made — goes through it on the server.
- **Daily vaults** are generated from the date (`src/shared/gen.ts`): the generator proposes layouts, the solver throws out anything unsolvable, and the best-scoring candidate for that weekday's difficulty wins. Monday is gentle; the weekend bites. A scheduled job posts each day's vault with a pinned results comment.
- **Never empty:** twelve house vaults are seeded on install, the daily always exists, and the result card always has the ghost line to watch even if you are the first crew in.
- **The server** (`src/server/`) checks every submitted route by replaying it under the real rules before recording it. Only the first run per player per vault is kept. A designer's runs on their own vault are not recorded.
- **Storage** is Redis only (no browser storage). A run is a string of move letters; a vault is about 25 characters. Runs and player profiles carry expiry times.
- **Cleanup:** deleting a post or comment removes what the app stored about it. Reddit does not notify apps when an account is deleted, so a nightly job checks the players it has not seen for longest and erases everything belonging to accounts that no longer exist.
- **Telemetry:** Devvit Journeys events are sent when a player starts a vault, finishes it, and shares a result.
- **No outside requests.** Fonts (Caprasimo and Atkinson Hyperlegible, both SIL Open Font License) and all art are bundled; the art is drawn in code as SVG, and the sound is made in code with Web Audio. A speaker button turns it off. No AI model calls, no payments, no links off Reddit.
- **Accessibility:** guards differ by head shape and route dash, not colour; light is striped as well as yellow; controls are at least 44 px; play works by keyboard; animation stops under "reduce motion."

## Developing

```
npm install
npm run dev:local    # plays locally at http://localhost:5173 against an in-memory stand-in for Reddit
npm run test:unit    # rules, solver, generator
npm run playtest     # uploads and installs to your test subreddit (needs `npx devvit login`)
```

Add `?as=somename` to the local URL to play as another pretend player, or `?as=anon` to play signed out. `LOG.md` is the build log.
