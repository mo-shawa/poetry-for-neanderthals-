import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game.js';

function dealer() {
  let n = 0;
  return () => {
    n += 1;
    return [`Word${n}`, `Phrase${n}`];
  };
}

function newGame(opts = {}) {
  return G.createGame({
    teams: [
      { name: 'Glad', players: opts.gladPlayers ?? [] },
      { name: 'Mad', players: opts.madPlayers ?? [] },
    ],
    settings: opts.settings,
  });
}

function playTurn(g, presses, draw = dealer()) {
  G.startTurn(g, 0, draw);
  for (const p of presses) G.act(g, p, draw);
  G.endTurn(g);
  G.finishTurn(g);
}

test('tapping the top word banks 1 point and keeps the card up', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  assert.equal(G.act(g, 'one', draw), 'banked');
  assert.equal(G.currentCard(g.turn).one, 'Word1');
  assert.equal(G.turnPoints(g.turn), 1, 'the banked point shows in the live score');
  assert.equal(G.act(g, 'one', draw), null, 'tapping the top word again does nothing');
  assert.equal(G.act(g, 'next', draw), 'dealt');
  assert.equal(G.currentCard(g.turn).one, 'Word2');
  assert.equal(g.turn.cards[0].result, 'one');
  assert.equal(G.turnPoints(g.turn), 1);
});

test('Next does nothing until the top word is banked', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  assert.equal(G.act(g, 'next', draw), null);
  assert.equal(g.turn.cards.length, 1);
});

test('getting the bottom word after the top one makes the card worth 3, not 4', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.act(g, 'three', draw);
  assert.equal(g.turn.cards[0].result, 'three');
  assert.equal(G.turnPoints(g.turn), 3);
});

test('going straight for the bottom word scores 3', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  assert.equal(G.act(g, 'three', draw), 'dealt');
  assert.equal(G.turnPoints(g.turn), 3);
});

test('skip costs 1, and skipping a banked card loses its point too', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'skip', draw);
  G.act(g, 'one', draw);
  G.act(g, 'skip', draw);
  assert.deepEqual(
    g.turn.cards.map((c) => c.result),
    ['skip', 'skip', null]
  );
  assert.equal(G.turnPoints(g.turn), -2);
});

test('only the poet team scores, and scores can go negative', () => {
  const g = newGame();
  playTurn(g, ['skip', 'skip', 'one']);
  playTurn(g, ['three']);
  assert.deepEqual(G.scores(g), [-1, 3]);
});

test('unknown actions are ignored', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  assert.equal(G.act(g, 'no', draw), null);
  assert.equal(g.turn.cards.length, 1);
});

test('at the buzzer a banked card keeps its point and any other card scores nothing', () => {
  const g = newGame();
  G.startTurn(g, 0, dealer());
  G.endTurn(g);
  assert.equal(g.turn.cards[0].result, 'none');
  assert.equal(g.turn.cards[0].timedOut, true);
  assert.equal(G.turnPoints(g.turn), 0);

  const banked = newGame();
  const draw = dealer();
  G.startTurn(banked, 0, draw);
  G.act(banked, 'one', draw);
  G.endTurn(banked);
  assert.equal(banked.turn.cards[0].result, 'one');
  assert.equal(G.turnPoints(banked.turn), 1);
});

test('undo un-banks the top word without touching the deck', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.undo(g);
  assert.equal(G.currentCard(g.turn).banked, false);
  assert.equal(g.turn.cards.length, 1);
  assert.equal(g.turn.queue.length, 0);
});

test('undo restores the previous card and re-deals the card that was on screen', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'skip', draw); // Word1 skipped, Word2 on screen
  assert.equal(G.undo(g), true);
  assert.equal(G.currentCard(g.turn).one, 'Word1');
  assert.equal(G.turnPoints(g.turn), 0);
  G.act(g, 'three', draw);
  assert.equal(G.currentCard(g.turn).one, 'Word2', 'the put-back card comes next');
  G.act(g, 'three', draw);
  assert.equal(G.currentCard(g.turn).one, 'Word3');
});

test('undo after a re-deal does not duplicate the card', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'skip', draw); // Word2 on screen
  G.undo(g); // Word2 queued
  G.act(g, 'three', draw); // Word2 dealt from the queue
  G.undo(g); // Word2 queued again
  assert.deepEqual(g.turn.queue, [['Word2', 'Phrase2']]);
});

test('presses are ignored while paused', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.pause(g, 30_000);
  assert.equal(G.act(g, 'three', draw), null);
  assert.equal(G.timeLeft(g.turn, 999_999), 60_000);
  G.resume(g, 100_000);
  assert.equal(G.timeLeft(g.turn, 110_000), 50_000);
});

test('review edits change the score before it is saved', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'skip', draw);
  G.endTurn(g);
  G.setResult(g, 0, 'three');
  G.setResult(g, 1, 'one'); // guessed right on the buzzer
  G.setResult(g, 1, 'bogus');
  G.finishTurn(g);
  assert.deepEqual(G.scores(g), [4, 0]);
});

test('teams alternate and poets rotate within each team', () => {
  const g = newGame({ gladPlayers: ['Ugg', 'Ogg', 'Zog'], madPlayers: ['Bo', 'Mo'] });
  const order = [];
  for (let i = 0; i < 6; i++) {
    order.push(`${g.teams[G.activeTeam(g)].name}:${G.poetFor(g)}`);
    playTurn(g, []);
  }
  assert.deepEqual(order, ['Glad:Ugg', 'Mad:Bo', 'Glad:Ogg', 'Mad:Mo', 'Glad:Zog', 'Mad:Bo']);
});

test('choosing a different poet continues the rotation from them', () => {
  const g = newGame({ gladPlayers: ['Ugg', 'Ogg', 'Zog'] });
  G.choosePoet(g, 2);
  assert.equal(G.poetFor(g), 'Zog');
  playTurn(g, []);
  playTurn(g, []);
  assert.equal(G.poetFor(g), 'Ugg');
});

test('the game ends after the last round and declares a winner', () => {
  const g = newGame({ settings: { rounds: 2 } });
  playTurn(g, ['three']);
  playTurn(g, ['one']);
  assert.equal(G.isFinalRound(g), true);
  playTurn(g, ['one']);
  assert.equal(g.phase, 'ready');
  assert.equal(G.isFinalTurn(g), true);
  playTurn(g, []);
  assert.equal(g.phase, 'over');
  assert.deepEqual(G.standings(g), { scores: [4, 1], winner: 0 });
});

test('a tie can be broken with one more round', () => {
  const g = newGame({ settings: { rounds: 1 } });
  playTurn(g, ['one']);
  playTurn(g, ['one']);
  assert.equal(g.phase, 'over');
  assert.equal(G.standings(g).winner, null);
  G.addRound(g);
  assert.equal(g.phase, 'ready');
  assert.equal(g.settings.rounds, 2);
  playTurn(g, ['three']);
  playTurn(g, []);
  assert.equal(g.phase, 'over');
  assert.equal(G.standings(g).winner, 0);
});

test('unlimited games only end when asked', () => {
  const g = newGame({ settings: { rounds: 0 } });
  for (let i = 0; i < 20; i++) playTurn(g, []);
  assert.equal(g.phase, 'ready');
  G.endGame(g);
  assert.equal(g.phase, 'over');
});

test('rematch keeps teams, resets scores, restores planned rounds and swaps who starts', () => {
  const g = newGame({ gladPlayers: ['Ugg'], settings: { rounds: 1 } });
  playTurn(g, ['three']);
  playTurn(g, ['three']);
  G.addRound(g);
  const next = G.rematch(g);
  assert.equal(next.firstTeam, 1);
  assert.equal(next.settings.rounds, 1);
  assert.deepEqual(next.teams[0].players, ['Ugg']);
  assert.deepEqual(G.scores(next), [0, 0]);
  assert.equal(G.activeTeam(next), 1);
});

test('stats name the top poet, best turn and most skips', () => {
  const g = newGame({ gladPlayers: ['Ugg'], madPlayers: ['Bo'] });
  playTurn(g, ['three', 'one', 'next', 'one', 'next']); // 3 + 1 + 1, then a card at the buzzer
  playTurn(g, ['skip', 'skip', 'one', 'next', 'one', 'next']); // -1 - 1 + 1 + 1, then a card at the buzzer
  const s = G.stats(g);
  assert.equal(s.mvp.name, 'Ugg');
  assert.equal(s.best.points, 5);
  assert.equal(s.skipper.name, 'Bo');
  assert.equal(s.skipper.skips, 2);
  assert.equal(s.threes, 1);
  assert.equal(s.cards, 9, 'includes the card on screen at each buzzer');
});

test('restore rejects malformed and old-format saves', () => {
  assert.equal(G.restore(null), null);
  assert.equal(G.restore({ v: 1, teams: [{}, {}], phase: 'ready' }), null);
  assert.equal(G.restore({ v: 2, teams: [{}, {}], phase: 'turn', turn: null }), null);
  const g = newGame();
  assert.equal(G.restore(JSON.parse(JSON.stringify(g))).phase, 'ready');
});
