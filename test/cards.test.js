import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, cardId } from '../src/cards.js';

test('deck is big enough for several games without repeats', () => {
  assert.ok(CARDS.length >= 600, `only ${CARDS.length} cards`);
});

test('every card has two different, trimmed, non-empty words', () => {
  for (const card of CARDS) {
    assert.equal(card.length, 2, JSON.stringify(card));
    for (const word of card) {
      assert.equal(typeof word, 'string');
      assert.ok(word.length > 0, JSON.stringify(card));
      assert.equal(word, word.trim(), JSON.stringify(card));
    }
    assert.notEqual(card[0].toLowerCase(), card[1].toLowerCase(), JSON.stringify(card));
  }
});

test('no 1-point word appears twice (it is the card id)', () => {
  const seen = new Map();
  for (const card of CARDS) {
    const id = cardId(card);
    assert.ok(!seen.has(id), `"${card[0]}" is used by ${JSON.stringify(seen.get(id))} and ${JSON.stringify(card)}`);
    seen.set(id, card);
  }
});

test('no 3-point word appears twice', () => {
  const seen = new Map();
  for (const card of CARDS) {
    const key = card[1].toLowerCase();
    assert.ok(!seen.has(key), `"${card[1]}" is used by ${JSON.stringify(seen.get(key))} and ${JSON.stringify(card)}`);
    seen.set(key, card);
  }
});

test('no word is both a 1-point word and a 3-point word', () => {
  const ones = new Set(CARDS.map(cardId));
  for (const card of CARDS) {
    assert.ok(!ones.has(card[1].toLowerCase()), `"${card[1]}" is also a 1-point word`);
  }
});
