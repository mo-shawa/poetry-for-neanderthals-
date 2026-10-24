import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, cardId } from '../src/cards.js';
import { drawCard, freshCount } from '../src/deck.js';

const SMALL = [
  ['Sun', 'Sunglasses'],
  ['Moon', 'Moonwalk'],
  ['Star', 'Starbucks'],
  ['Sky', 'Skyscraper'],
];

test('deals every card once before any repeat', () => {
  const seen = new Set();
  const dealt = new Set();
  for (let i = 0; i < CARDS.length; i++) {
    const { card, reshuffled } = drawCard(CARDS, seen);
    assert.equal(reshuffled, false);
    assert.ok(!dealt.has(cardId(card)), `repeat: ${card[0]} after ${i} cards`);
    dealt.add(cardId(card));
  }
  assert.equal(dealt.size, CARDS.length);
  assert.equal(freshCount(CARDS, seen), 0);
});

test('history carries over between games (seen persists)', () => {
  const seen = new Set();
  const first = [drawCard(SMALL, seen).card, drawCard(SMALL, seen).card];
  // Simulate a reload: rebuild the set from the saved array.
  const restored = new Set([...seen]);
  const next = [drawCard(SMALL, restored).card, drawCard(SMALL, restored).card];
  const ids = [...first, ...next].map(cardId);
  assert.equal(new Set(ids).size, 4);
});

test('when the deck runs out, the cards seen longest ago come back first', () => {
  const seen = new Set();
  const order = [];
  for (let i = 0; i < CARDS.length; i++) order.push(cardId(drawCard(CARDS, seen).card));
  const oldHalf = new Set(order.slice(0, CARDS.length / 2));
  const recentHalf = new Set(order.slice(CARDS.length / 2));
  const { card, reshuffled } = drawCard(CARDS, seen);
  assert.equal(reshuffled, true);
  const next = [cardId(card)];
  for (let i = 1; i < CARDS.length / 2; i++) next.push(cardId(drawCard(CARDS, seen).card));
  assert.ok(next.every((id) => oldHalf.has(id)), 'only old cards come back');
  assert.ok(!next.some((id) => recentHalf.has(id)), 'nothing from the recent half repeats');
  assert.equal(new Set(next).size, next.length);
});

test('reshuffles when the deck runs out but never repeats within the current game', () => {
  const seen = new Set(SMALL.map(cardId));
  const inThisGame = ['sun', 'moon'];
  for (let i = 0; i < 2; i++) {
    const { card, reshuffled } = drawCard(SMALL, seen, inThisGame);
    assert.equal(reshuffled, i === 0);
    assert.ok(!inThisGame.includes(cardId(card)), `dealt ${card[0]} again in the same game`);
    inThisGame.push(cardId(card));
  }
});

test('still deals when a single game has used every card', () => {
  const seen = new Set(SMALL.map(cardId));
  const { card, reshuffled } = drawCard(SMALL, seen, SMALL.map(cardId));
  assert.ok(card);
  assert.equal(reshuffled, true);
});

test('uses the injected random source', () => {
  const seen = new Set();
  assert.deepEqual(drawCard(SMALL, seen, [], () => 0).card, SMALL[0]);
  assert.deepEqual(drawCard(SMALL, seen, [], () => 0.999).card, SMALL[3]);
});

test('cards added to the list later are fresh, and removed cards do not get in the way', () => {
  const seen = new Set([...SMALL.map(cardId), 'a card that was deleted']);
  const expanded = [...SMALL, ['Rain', 'Rainbow']];
  const { card, reshuffled } = drawCard(expanded, seen);
  assert.equal(reshuffled, false);
  assert.equal(card[0], 'Rain');
});
