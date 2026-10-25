# It Dog

A pass-the-phone party game in the style of Poetry for Neanderthals. The poet gets
their team to guess the word on a card while speaking only in words of one
syllable. Break the rule and the other team yells NO! and bonks you.

One phone runs the whole game: no accounts, no network needed once it has loaded.

## Play

Open `index.html` from any static web server, for example:

```sh
npm start            # python3 -m http.server 8080
# then open http://localhost:8080 on your phone (same Wi-Fi) or laptop
```

On a phone, use "Add to Home Screen" and it runs full screen like an app.

To host it, turn on GitHub Pages for this repo (Settings → Pages → Deploy from
branch → `main` / root). There is no build step.

## How a game goes

1. **New game.** Name the two teams (Glad and Mad by default) and, optionally,
   the players. With names, the game says whose turn it is to be poet and
   rotates through everyone. Pick turn length (60/90/120 s) and rounds.
2. **Pass the phone.** The ready screen shows the score, the team up next and the
   poet. Someone from the other team sits beside the poet as judge.
3. **The turn.** After a 3-2-1 countdown the card appears with the easier
   word on top and the harder word below.
   - **Tap the top word** when the team guesses it: **+1**. The card stays up
     so the poet can go for the 3.
   - **Tap the bottom word** when the team guesses it: the card is worth **3**
     (with or without the top word first; 3 is the most a card can earn).
   - **Next** (appears once the top word is in): keep the +1 and move on.
   - **Skip**: **−1**, and any point already on the card is lost. If the poet
     breaks a rule, the judge yells NO! and the card is skipped.
   - If time runs out while going for the 3, the +1 is kept.
   - Each tap has its own sound: a ding, a swish for Next, a drum-and-fanfare,
     and a sad trombone.
   - **Undo** reverses the last tap and puts the card back.
   - **Pause** hides the card and stops the clock. Leaving the app also pauses.
4. **Review.** After the buzzer, every card from the turn is listed. Fix any
   result the judge disputes (including a guess right on the buzzer) before the
   turn is saved.
5. **Game over.** Winner, final score, top poet, best turn and most skips.
   Tied? Play a tiebreaker round. Rematch keeps the teams and swaps who starts.

The in-game menu lets you change turn length and rounds mid-game, fix the
score, turn sound off, or end the game early.

## No repeated cards

The deck has 830 cards. Every card dealt is saved in the phone's local storage,
across turns, teams and Play Again, and nothing repeats on that phone until all
of them have been played. When the deck runs out, the half of the deck seen
longest ago comes back into play; recent cards (tonight's games) stay out. The
home screen shows how many fresh cards are left and can reset the history.

To add cards, append `[1-point word, 3-point word]` pairs to `src/cards.js`. A
card's id is its 1-point word, so new cards count as unseen and are dealt
straight away, and the seen history of existing cards is kept.

## Phone details

- Keeps the screen awake during a game (where the browser allows it).
- Sound effects and vibration, with a mute switch in the menu.
- The game is saved after every tap. Reloading or closing the tab mid-turn
  brings you back to a paused turn.
- Large tap targets in thumb reach, a guard against accidental double taps, and
  a layout that fits small phones without scrolling during a turn.
- Laptop shortcuts during a turn: `1`, `3`, `N` (next), `S` (skip), `U` (undo),
  space (pause).

## Code

Plain HTML, CSS and JavaScript modules, no dependencies or build.

| File | What it does |
| --- | --- |
| `src/cards.js` | The deck: `[1-point word, 3-point word]` pairs |
| `src/deck.js` | Deals cards without repeats |
| `src/game.js` | Game rules and scoring, no DOM |
| `src/main.js` | Screens, timer, input |
| `src/sound.js` | Synthesized sound effects |
| `styles.css` | All styling |

Run the tests (Node 20+):

```sh
npm test
```

The card tests fail if a 1-point or 3-point word is duplicated, so add cards
freely and let the tests catch collisions.
