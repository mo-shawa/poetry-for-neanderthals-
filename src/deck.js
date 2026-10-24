import { cardId } from './cards.js';

// The deck never repeats a card on this device until every card has been dealt.
// `seen` is a Set of card ids already dealt here, across games; it is the only
// state the deck needs, so persisting it is enough to survive reloads.

/** Number of cards not yet dealt on this device. */
export function freshCount(cards, seen) {
  let n = 0;
  for (const card of cards) if (!seen.has(cardId(card))) n++;
  return n;
}

/**
 * Deal one random card that has not been seen, and mark it seen.
 * When every card has been seen, history is wiped and dealing starts over,
 * except for `protectedIds` (cards already used in the current game), so a
 * single game still never shows the same card twice.
 */
export function drawCard(cards, seen, protectedIds = [], rng = Math.random) {
  let pool = cards.filter((card) => !seen.has(cardId(card)));
  let reshuffled = false;
  if (pool.length === 0) {
    reshuffled = true;
    seen.clear();
    for (const id of protectedIds) seen.add(id);
    pool = cards.filter((card) => !seen.has(cardId(card)));
    if (pool.length === 0) {
      seen.clear();
      pool = cards.slice();
    }
  }
  const card = pool[Math.floor(rng() * pool.length)];
  seen.add(cardId(card));
  return { card, reshuffled };
}
