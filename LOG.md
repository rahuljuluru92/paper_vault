# Paper Vault — build log

Short running notes: what was built, what was tested, what was fixed.

## 0. Before building: the three closest games

| Game | What it shares | How Paper Vault differs |
| --- | --- | --- |
| **Hitman GO / Lara Croft GO** | Turn-based sneaking past guards who walk visible routes. | Those are fixed campaigns you step through and fail in. Here you *draft the whole job in pencil* with free undo, commit once, and are scored against the provably shortest route. And the moment you lift the loot **every guard turns on their heel and walks their route backwards**, so the way out is never the way in, and *when* you grab decides the whole second half. |
| **Invisible, Inc.** | Heist planning, guard vision, getting out with the goods. | That is a long, hidden-information tactics run. This is a two-minute, full-information daily with one committed answer and a shared result everyone can compare. |
| **Super Mario Maker (and Wordle-style dailies)** | Player-made levels with clear rates; one shared daily. | Vaults are built from three pieces only, are solver-verified before they can be published, and designers are paid for the *middle* of the difficulty curve: a vault earns most when between a quarter and 60% of crews find its shortest route. |

The one-line pitch: **a daily route-optimisation heist where time runs backwards after the grab, and half the game is cutting vaults that are fair but not obvious.**

## 1. Design decisions

- **Grid:** 7 × 7. Cells stay ≥ 44 px on a 343 px-wide phone; big enough for two or three interlocking patrols.
- **One door.** You come in and leave by the same door at the bottom. Fixed, so vaults are made of walls, guards and loot only.
- **Guards:** each walks a drawn route (a loop, a back-and-forth, or standing still) one square per beat and lights the three squares ahead of them; walls cut the light short. You are spotted in the light, on a guard's square, or swapping squares with one.
- **The bell:** lifting the loot reverses every guard. Routes are walked backwards and lanterns point the other way.
- **Drafting, then committing:** the board always shows the moment at the tip of your pencil line. Squares that would get you spotted are marked and refuse the step, so there is no fail state to grind against — the puzzle is finding the *short* route. Your first committed job on a vault is your result for it.
- **Scoring:** moves against the "ghost line" (the solver's shortest). Ghost = equal to it, Clean = within 2, Out = anything else. The ghost line is hidden until you commit.
- **Solvability:** every vault — daily, house or player-made — goes through the same breadth-first solver on the server. No solution, no publish.
- **Designer reward ("marks"):** each crew that runs your vault pays marks scaled by how close the vault's ghost rate is to the 25–60% band. Too soft or too cruel pays little.
- **Quiet days:** the daily is generated from the date, twelve house vaults are seeded on install, and the result card always has the ghost line to watch even if you are the first crew in.
- **Result card:** one card — stamp, moves vs ghost line, where you sit among today's crews, streak, replays, share.
- **Sharing:** copy-to-clipboard by default; an optional button posts the same text as *you*, as a reply to the pinned results comment. Nothing is locked behind it.

## 2. Build log

**Scaffold.** Devvit Web bare template (plain Node server, esbuild, TypeScript). Removed the template mascot image. Empty app builds; upload is waiting on `devvit login`, which only the account owner can approve in a browser.

**Engine, solver, generator** (`src/shared`). Rules, breadth-first solver, seeded generator, compact vault text format, name lists.
- Tested: 7 unit tests; 366 consecutive dailies generated and each ghost line replayed under the rules; encode/decode round trip.
- Fixed: launch day was off by one against UTC.

**Server** (`src/server`). Redis store, play/shelf/publish/report/delete/share endpoints, install + upgrade seeding, daily cron, PostDelete / CommentDelete handlers, nightly sweep for deleted accounts, Journeys start / finish / share.
- Tested locally against an in-memory Redis/Reddit stand-in (`tools/dev.ts`): duplicate share refused (409), share before finishing refused (403), invalid route refused (400), junk vault code / bad label / no guards refused, three reports hide a vault, deleting someone else's vault refused (403), triggers and cron return cleanly.
- Not yet tested on Reddit itself: the real Redis, `runAs: 'USER'` comments, the pinned comment, the scheduler, and Journeys receipts.

**Client** (`src/client`, `public`). SVG diorama board, play view, one result card, shelf with vault thumbnails, workshop editor, splash diorama for the feed.
- Play-tested in a browser at 320×568, 375×812 and 1100×700 with screenshots after each feature.
- Fixed from play-testing:
  - Page overflowed sideways on phones (grid column had no minimum); tabs did not fit at 375 px.
  - Result card's action row ran off the edge; histogram labels overlapped the bars; histogram now hidden until three crews exist.
  - Six replay chips squeezed to "G…"; now three, with one that cycles through other crews.
  - Finished vaults showed "Beat 0" instead of the move count.
  - Workshop board had no walls, frame or light: two SVGs shared filter ids and the hidden one won. Ids are now per board.
  - A fast drag skipped squares and broke the line; gaps are now walked.
  - Long vault names spilled out of shelf tiles; shelf tiles restyled as cut tags so they are not identical cards.
  - Result card too tall on short phones; compact layout under 680 px high. Side-by-side layout on desktop.

## 3. Skeptical judge pass

Played it as a reviewer who has seen a lot of grid puzzles. The five worst problems, and what was done:

1. **The workshop was an answer key.** It printed the exact ghost-line length for any layout, so you could rebuild the daily there and read off the target. *Fixed:* the workshop now only says gentle / tricky / knotty.
2. **The big moment had no weight.** Lifting the loot and getting your stamp were both silent state changes. *Fixed:* guards jump as they turn at the bell; the stamp thunks onto the card. Both off under reduced motion.
3. **The designer reward was invisible.** Marks existed only in one truncated line. *Fixed:* the workshop says how marks are earned; the result card on a player vault says your run paid its designer and what pays most; seals show on shelf tiles.
4. **Guards were hard to read ahead.** Routes were faint and nothing said how to predict a step. *Fixed:* route lines darkened; the standing hint now teaches "guards step toward their lantern"; desktop players are told the keys.
5. **Loose ends a reviewer trips on.** "Tonight" tab could show a shelf vault; a designer's own runs skewed their vault's stats; the board had no accessible name. *Fixed* all three.

Still open, honestly: a signed-out player can finish a vault, see the ghost line, then sign in and enter it. Closing that needs sign-in before play, which felt worse than the leak. And the game has no sound.

## 4. First real player, and the first-minute rework

The first person to try it could not play, even with the rules explained aloud. Earlier play-tests had only checked that the game worked for someone who already knew it.

What was wrong:
- Five ideas arrived before the first win, and the one warm-up vault opened by asking for a wait, the hardest idea.
- "Guards move only when you move" was invisible. The board drew the lantern light as it is *now*, but only the light *after your next move* decides what is safe, so a safe square could sit in bright yellow.
- A real bug: after the bell rang once, the loot stayed invisible on every later vault, and after undoing the grab. Anyone going from the warm-up into the daily saw a vault with no loot.

What changed:
- **The board shows the next beat.** Safe squares are green tiles (and a green ring when holding still is safe). A red arrow marks each guard's next step. A dashed box marks where each lantern shines after your next move, and today's light is faded while you plan. Crosses now always sit inside a dashed box.
- **Three ten-second lessons replace the warm-up**, one idea each: walk in and out with no guard (6 moves); hold once to let a guard pass (9); the bell turns a standing guard, so leave by the other side (12). "Skip lessons" is always on screen, and anyone who has finished or skipped them never sees them again.
- Loot bug fixed. Hints rewritten around the new marks.
- Tested: each lesson played through by tap and by keys at 375x812 and 1100x700, skip and reload checked, a three-guard daily checked for clutter. Unit test pins each lesson's shortest route.

Tradeoff accepted: the marks make hard vaults a little easier to read. The puzzle is the shortest route, not guessing which squares are legal.

## 5. Levels

The first player finished the lessons, landed on the daily and asked "so this is the last level?" There was no visible path forward.

- **The twelve house vaults are now a ladder, Level 1 to 12**, three per difficulty tier and ordered by tier, guard count, then how far the guards push you off the straight line. Level 1 has one guard; levels 10 to 12 have four.
- The last lesson leads to Level 1 (or tonight's vault). Each level's result card leads to the next level. The shelf lists unfinished levels first, in order, and always includes the ladder however many player vaults exist.
- Fixed while testing: a route longer than the 72-move cap could be drawn, then failed on Run with a "check your connection" message. The pencil now stops at 72 and says why.
- Tested: shelf order, Level 1 solved by its ghost line, card leads to Level 2, at 375x812.
- **Start over** button removed: Undo covers it and every card has a next button. The three lessons now run on their own the moment the path reaches the mat; levels and the daily keep **Run the job**, since the first run there is the scored one.

## 6. All twelve levels

`tools/ladder.ts` plays the whole ladder against the local server as a fresh player: solves each level, submits the ghost line, and checks it is recorded as a first run. All twelve pass. The table it prints:

| Level | Guards | Shortest route | Moves forced off the straight line |
| --- | --- | --- | --- |
| 1–3 | 1, 2, 2 | 19, 15, 17 | 3, 3, 3 |
| 4–6 | 2, 3, 3 | 17, 27, 20 | 5, 5, 6 |
| 7–9 | 3, 3, 3 | 20, 18, 21 | 6, 8, 9 |
| 10–12 | 4, 4, 4 | 21, 25, 27 | 11, 11, 11 |

The last column is the real difficulty and never falls. Route length alone is not a measure: Level 5 is long but open, Level 8 is short but twisty.

By hand at 375x812: Level 3 (keys, Ghost, card leads to Level 4), Level 12 (keys, Ghost, card ends the ladder with "More vaults"), played levels drop to the end of the shelf with their stamp.
- Fixed: shelf tiles broke long names mid-word ("Chandelie r"). The text column was 77 px and "Clockwork" in the display face is 77 px; the thumbnail column is now narrower and the name a touch smaller, checked at 375 and 320 px against the widest words in the name lists.

## 7. First run on Reddit

Uploaded privately as `paper-vault` v0.0.1 and installed on the test subreddit r/paper_vault_dev with `devvit playtest`. The automatic install during `devvit upload` failed with a vague error; installing again through `devvit playtest paper_vault_dev` worked.
- Seen in the Reddit logs: the daily cron is scheduled; a vault was opened and, 19 seconds later, a run was replayed by the server and recorded, with no errors or warnings from the app. Journeys events arrive but Reddit does not keep them for playtest versions, as expected.
- Not yet seen on Reddit: posting a result as a comment from the player's account, and the cron's first real daily post.

## 8. Sound

The skeptical judge pass said the game had no sound. Now every sound is made in code with Web Audio (`src/client/sound.ts`): no audio files, no outside requests, and nothing plays until the player's first tap or key.
- Planning: a pencil stroke per step, a clock tick for Hold, an eraser for Undo, a dull knock for a refused move.
- The grab: a struck bell (partials at 1, 2, 2.76 and 5.4 times 740 Hz), together with the guards' jump.
- The run: a soft footstep for each square moved and the bell again at the grab.
- The card: a low knock timed to the stamp landing; a ghost line adds a two-note chime.
- A speaker button in the header turns sound off. The choice is stored on the player's Redis profile (`quiet`), like the lessons flag, so it follows them across posts; still no browser storage.
- Tested locally by counting the sounds the page creates: each action plays exactly its sound, the replay plays 5 footsteps and the bell, muting plays nothing and suspends audio, and the setting survives a reload.
- Fixed: at 320 px the new button stuck out 2 px; tabs are a little narrower on phones.

## 9. The sign-in leak, closed

Section 3 left one hole open: a signed-out player could finish a vault, watch the ghost line, then sign in and enter it as their first run.
- Signed-out runs are not recorded, so their result no longer carries any route: `/api/run` returns an empty ghost line and no other crews' replays when there is no user. The stamp and move target still come back, so the card still works.
- The card drops the "Ghost line" button when there is no route and says: sign in and your first run counts; then you can watch the ghost line.
- Tested: the same vault run through `/api/run` signed out (no ghost line, no replays, not saved) and signed in (19-move ghost line, saved, first run). Tonight's vault played signed out in the browser: Ghost stamp, the note, and only the "Yours" button.
- What is still possible: knowing the target move count before signing in. That alone does not give the route.
