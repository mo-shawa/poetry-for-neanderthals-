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

test('tapping +1 twice keeps the point and deals the next card', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  assert.equal(G.act(g, 'one', draw), 'banked');
  assert.equal(G.currentCard(g.turn).one, 'Word1');
  assert.equal(G.act(g, 'one', draw), 'dealt');
  assert.equal(G.currentCard(g.turn).one, 'Word2');
  assert.deepEqual(G.turnPoints(g, g.turn), [1, 0]);
});

test('a card is worth 3 at most, banked or not', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.act(g, 'three', draw);
  G.act(g, 'three', draw);
  assert.deepEqual(G.turnPoints(g, g.turn), [6, 0]);
});

test('NO! gives the other team a point and wipes a banked point', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.act(g, 'no', draw);
  assert.deepEqual(G.turnPoints(g, g.turn), [0, 1]);
});

test('skips give the other team a point unless skips are free', () => {
  const official = newGame();
  playTurn(official, ['skip', 'skip']);
  assert.deepEqual(G.scores(official), [0, 2]);

  const casual = newGame({ settings: { skipPenalty: false } });
  playTurn(casual, ['skip', 'skip']);
  assert.deepEqual(G.scores(casual), [0, 0]);
});

test('skip after banking keeps the 1 point', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.act(g, 'skip', draw);
  assert.equal(g.turn.cards[0].result, 'one');
});

test('time running out keeps a banked point and scores nothing otherwise', () => {
  const banked = newGame();
  const draw = dealer();
  G.startTurn(banked, 0, draw);
  G.act(banked, 'one', draw);
  G.endTurn(banked);
  assert.equal(banked.turn.cards[0].result, 'one');

  const unbanked = newGame();
  G.startTurn(unbanked, 0, dealer());
  G.endTurn(unbanked);
  assert.equal(unbanked.turn.cards[0].result, 'none');
  assert.equal(unbanked.turn.cards[0].timedOut, true);
});

test('undo restores the previous card and re-deals the card that was on screen', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'no', draw); // Word1 lost, Word2 on screen
  assert.equal(G.undo(g), true);
  assert.equal(G.currentCard(g.turn).one, 'Word1');
  assert.deepEqual(G.turnPoints(g, g.turn), [0, 0]);
  G.act(g, 'three', draw);
  assert.equal(G.currentCard(g.turn).one, 'Word2', 'the put-back card comes next');
  G.act(g, 'three', draw);
  assert.equal(G.currentCard(g.turn).one, 'Word3');
});

test('undo after a re-deal does not duplicate the card', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'no', draw); // Word2 on screen
  G.undo(g); // Word2 queued
  G.act(g, 'skip', draw); // Word2 dealt from the queue
  G.undo(g); // Word2 queued again
  assert.deepEqual(g.turn.queue, [['Word2', 'Phrase2']]);
});

test('undo of a bank un-banks without touching the deck', () => {
  const g = newGame();
  const draw = dealer();
  G.startTurn(g, 0, draw);
  G.act(g, 'one', draw);
  G.undo(g);
  assert.equal(G.currentCard(g.turn).banked, false);
  assert.equal(g.turn.queue.length, 0);
  assert.equal(g.turn.cards.length, 1);
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
  G.act(g, 'no', draw);
  G.endTurn(g);
  G.setResult(g, 0, 'three');
  G.finishTurn(g);
  assert.deepEqual(G.scores(g), [3, 0]);
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

test('stats name the top poet, best turn and most bonked', () => {
  const g = newGame({ gladPlayers: ['Ugg'], madPlayers: ['Bo'] });
  playTurn(g, ['three', 'one', 'one']);
  playTurn(g, ['no', 'no', 'one', 'one']);
  const s = G.stats(g);
  assert.equal(s.mvp.name, 'Ugg');
  assert.equal(s.best.points, 4);
  assert.equal(s.bonked.name, 'Bo');
  assert.equal(s.bonked.nos, 2);
  assert.equal(s.threes, 1);
});

test('restore rejects malformed saves', () => {
  assert.equal(G.restore(null), null);
  assert.equal(G.restore({ v: 2 }), null);
  assert.equal(G.restore({ v: 1, teams: [{}, {}], phase: 'turn', turn: null }), null);
  const g = newGame();
  assert.equal(G.restore(JSON.parse(JSON.stringify(g))).phase, 'ready');
});
