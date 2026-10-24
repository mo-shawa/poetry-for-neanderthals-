// Pure game rules. No DOM, no clock: callers pass `now` and a `draw()` that
// returns the next [onePointWord, threePointWord] card.
//
// Card results:
//   'one'   poet's team +1
//   'three' poet's team +3
//   'no'    poet broke a rule: other team +1
//   'skip'  other team +1 (or 0 when skips are free)
//   'none'  nobody scores (time ran out mid-card, or fixed in review)

export const DEFAULT_SETTINGS = { seconds: 90, rounds: 5, skipPenalty: true };
export const DEFAULT_TEAM_NAMES = ['Glad', 'Mad'];
export const RESULTS = ['one', 'three', 'no', 'skip', 'none'];

const MAX_UNDO = 60;

export function createGame({ teams, settings = {}, firstTeam = 0 }) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return {
    v: 1,
    settings: merged,
    baseRounds: merged.rounds,
    teams: teams.map((team, i) => ({
      name: team.name.trim() || DEFAULT_TEAM_NAMES[i] || `Team ${i + 1}`,
      players: team.players.map((p) => p.trim()).filter(Boolean),
      next: 0,
    })),
    firstTeam,
    turns: [],
    adjust: teams.map(() => 0),
    phase: 'ready',
    turn: null,
  };
}

/** Returns the saved game if it looks valid, otherwise null. */
export function restore(saved) {
  if (!saved || saved.v !== 1 || !Array.isArray(saved.teams) || saved.teams.length < 2) return null;
  if (!['ready', 'turn', 'review', 'over'].includes(saved.phase)) return null;
  if ((saved.phase === 'turn' || saved.phase === 'review') && !saved.turn) return null;
  return saved;
}

export const other = (g, team) => (team + 1) % g.teams.length;
export const activeTeam = (g) => (g.firstTeam + g.turns.length) % g.teams.length;
export const currentRound = (g) => Math.floor(g.turns.length / g.teams.length) + 1;

export function isFinalRound(g) {
  return g.settings.rounds > 0 && currentRound(g) >= g.settings.rounds;
}

export function isFinalTurn(g) {
  return g.settings.rounds > 0 && g.turns.length + 1 >= g.settings.rounds * g.teams.length;
}

/** Name of the player due to be poet for a team, or null if the team has no names. */
export function poetFor(g, team = activeTeam(g)) {
  const { players, next } = g.teams[team];
  return players.length ? players[next % players.length] : null;
}

export function choosePoet(g, index) {
  const team = g.teams[activeTeam(g)];
  if (index >= 0 && index < team.players.length) team.next = index;
}

export function cardPoints(g, result, poetTeam) {
  const pts = g.teams.map(() => 0);
  if (result === 'one') pts[poetTeam] += 1;
  else if (result === 'three') pts[poetTeam] += 3;
  else if (result === 'no') pts[other(g, poetTeam)] += 1;
  else if (result === 'skip' && g.settings.skipPenalty) pts[other(g, poetTeam)] += 1;
  return pts;
}

/** Points each team earned during one turn (finished or in progress). */
export function turnPoints(g, turn) {
  const pts = g.teams.map(() => 0);
  for (const card of turn.cards) {
    if (!card.result) continue;
    cardPoints(g, card.result, turn.team).forEach((p, i) => (pts[i] += p));
  }
  return pts;
}

/** Score from saved turns plus manual adjustments. */
export function scores(g) {
  const pts = [...g.adjust];
  for (const turn of g.turns) turnPoints(g, turn).forEach((p, i) => (pts[i] += p));
  return pts;
}

/** Scores including the turn being played or reviewed right now. */
export function liveScores(g) {
  const pts = scores(g);
  if (g.turn) turnPoints(g, g.turn).forEach((p, i) => (pts[i] += p));
  return pts;
}

export function standings(g) {
  const pts = scores(g);
  const top = Math.max(...pts);
  const leaders = pts.flatMap((p, i) => (p === top ? [i] : []));
  return { scores: pts, winner: leaders.length === 1 ? leaders[0] : null };
}

// ---- Turn ----

export function startTurn(g, now, draw) {
  const team = activeTeam(g);
  const total = g.settings.seconds * 1000;
  g.turn = {
    team,
    poet: poetFor(g, team),
    round: currentRound(g),
    total,
    endsAt: now + total,
    left: null, // ms remaining while paused; null while running
    cards: [],
    queue: [], // cards put back by undo, dealt again before new ones
    undo: [],
  };
  g.phase = 'turn';
  deal(g.turn, draw);
}

function deal(turn, draw) {
  const [one, three] = turn.queue.shift() ?? draw();
  turn.cards.push({ one, three, result: null, banked: false });
}

/** The card on screen, or null once the turn is over. */
export function currentCard(turn) {
  const card = turn.cards[turn.cards.length - 1];
  return card && card.result === null ? card : null;
}

/**
 * Apply a poet/judge button press.
 *   'one'   first press banks the 1-point word and keeps the card up so the
 *           poet can go for 3; a second press keeps the 1 and moves on.
 *   'three' scores 3 (with or without banking first).
 *   'no'    the judge caught a rule break: the card and anything banked on it is lost.
 *   'skip'  give up on the card.
 * Returns 'banked', 'dealt' or null when nothing happened.
 */
export function act(g, action, draw) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.left !== null) return null;
  const card = currentCard(turn);
  if (!card) return null;

  const before = JSON.stringify(turn.cards);
  if (action === 'one' && !card.banked) {
    card.banked = true;
  } else if (action === 'one' || action === 'three' || action === 'no') {
    card.result = action;
  } else if (action === 'skip') {
    card.result = card.banked ? 'one' : 'skip';
  } else {
    return null;
  }
  turn.undo.push(before);
  if (turn.undo.length > MAX_UNDO) turn.undo.shift();

  if (card.result === null) return 'banked';
  deal(turn, draw);
  return 'dealt';
}

/** Undo the last button press in this turn. */
export function undo(g) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.undo.length === 0) return false;
  const onScreen = currentCard(turn);
  const restored = JSON.parse(turn.undo.pop());
  // If the press dealt a new card, put that card back on top of the pile
  // instead of throwing it away.
  if (onScreen && restored.length < turn.cards.length) {
    turn.queue.unshift([onScreen.one, onScreen.three]);
  }
  turn.cards = restored;
  return true;
}

export function timeLeft(turn, now) {
  return turn.left !== null ? turn.left : Math.max(0, turn.endsAt - now);
}

export const isPaused = (turn) => turn.left !== null;

export function pause(g, now) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.left !== null) return;
  turn.left = Math.max(0, turn.endsAt - now);
  turn.endsAt = null;
}

export function resume(g, now) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.left === null) return;
  turn.endsAt = now + turn.left;
  turn.left = null;
}

/** Time's up (or the poet ended early). A banked card still counts its 1 point. */
export function endTurn(g) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn) return;
  const card = currentCard(turn);
  if (card) {
    card.result = card.banked ? 'one' : 'none';
    if (!card.banked) card.timedOut = true;
  }
  turn.left = 0;
  turn.endsAt = null;
  turn.undo = [];
  turn.queue = [];
  g.phase = 'review';
}

/** Fix a card's result on the review screen. */
export function setResult(g, index, result) {
  if (g.phase !== 'review' || !RESULTS.includes(result)) return;
  const card = g.turn.cards[index];
  if (card) card.result = result;
}

/** Lock in the reviewed turn and move to the next team, or end the game. */
export function finishTurn(g) {
  if (g.phase !== 'review') return;
  const turn = g.turn;
  g.turns.push({
    team: turn.team,
    poet: turn.poet,
    round: turn.round,
    cards: turn.cards.map(({ one, three, result }) => ({ one, three, result })),
  });
  const team = g.teams[turn.team];
  if (team.players.length) {
    const i = team.players.indexOf(turn.poet);
    team.next = ((i >= 0 ? i : team.next) + 1) % team.players.length;
  }
  g.turn = null;
  g.phase = isOver(g) ? 'over' : 'ready';
}

export function isOver(g) {
  return g.settings.rounds > 0 && g.turns.length >= g.settings.rounds * g.teams.length;
}

/** End the game from the between-turns screen. */
export function endGame(g) {
  if (g.phase === 'ready') g.phase = 'over';
}

/** Play one more round (tiebreaker, or to keep going after the last round). */
export function addRound(g) {
  const played = Math.floor(g.turns.length / g.teams.length);
  if (g.settings.rounds > 0) g.settings.rounds = played + 1;
  g.phase = 'ready';
}

/** Same teams and settings, fresh scores. The other team opens. */
export function rematch(g) {
  return createGame({
    teams: g.teams,
    settings: { ...g.settings, rounds: g.baseRounds ?? g.settings.rounds },
    firstTeam: (g.firstTeam + 1) % g.teams.length,
  });
}

export function stats(g) {
  const poets = new Map();
  let best = null;
  let cards = 0;
  let threes = 0;
  for (const turn of g.turns) {
    const pts = turnPoints(g, turn)[turn.team];
    cards += turn.cards.length;
    threes += turn.cards.filter((c) => c.result === 'three').length;
    if (!best || pts > best.points) best = { team: turn.team, poet: turn.poet, round: turn.round, points: pts };
    if (turn.poet) {
      const key = `${turn.team}:${turn.poet}`;
      const p = poets.get(key) ?? { name: turn.poet, team: turn.team, points: 0, nos: 0 };
      p.points += pts;
      p.nos += turn.cards.filter((c) => c.result === 'no').length;
      poets.set(key, p);
    }
  }
  const list = [...poets.values()];
  const mvp = list.reduce((a, b) => (!a || b.points > a.points ? b : a), null);
  const bonked = list.filter((p) => p.nos > 0).reduce((a, b) => (!a || b.nos > a.nos ? b : a), null);
  return { cards, threes, best, mvp, bonked };
}
