import { cardId } from './cards.js';

// The deck never repeats a card on this device until every card has been dealt.
// `seen` is a Set of card ids already dealt here, across games, in the order they
// were dealt (oldest first). It is the only state the deck needs, so saving it is
// enough to survive reloads. Cards added to the list later are simply unseen.

/** Number of cards not yet dealt on this device. */
export function freshCount(cards, seen) {
  let n = 0;
  for (const card of cards) if (!seen.has(cardId(card))) n++;
  return n;
}

/**
 * Deal one random card that has not been seen, and mark it seen.
 * When every card has been seen, the oldest half of the history is forgotten so
 * those cards can come round again. Recently dealt cards (tonight's games) and
 * `protectedIds` (the game in progress) stay off limits.
 */
export function drawCard(cards, seen, protectedIds = [], rng = Math.random) {
  let pool = cards.filter((card) => !seen.has(cardId(card)));
  let reshuffled = false;
  if (pool.length === 0) {
    reshuffled = true;
    recycle(cards, seen, protectedIds);
    pool = cards.filter((card) => !seen.has(cardId(card)));
  }
  const card = pool[Math.floor(rng() * pool.length)];
  seen.add(cardId(card));
  return { card, reshuffled };
}

function recycle(cards, seen, protectedIds) {
  const live = new Set(cards.map(cardId));
  const history = [...seen].filter((id) => live.has(id));
  const recent = history.slice(Math.ceil(history.length / 2));
  // Keep as much as possible off limits while still leaving a card to deal
  // (only matters for tiny decks).
  for (const keep of [[...recent, ...protectedIds], protectedIds, []]) {
    seen.clear();
    for (const id of keep) seen.add(id);
    if (cards.some((card) => !seen.has(cardId(card)))) return;
  }
}
