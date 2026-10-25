import { TALK_RULES, CLASSIC_RULE } from './talk-rules.js';

// Pure game rules. No DOM, no clock: callers pass `now` and a `draw()` that
// returns the next [onePointWord, threePointWord] card.
//
// The player describing the card is the "talker" (shown as "It" in the app).
// Card results, all scored for the talker's team:
//   'one'   got the top word: +1
//   'three' got the bottom word: +3 (a card is worth 3 at most)
//   'skip'  skipped, or the talker broke a rule: -1
//   'none'  no score (time ran out mid-card, or set in review)
// While the talker goes for the bottom word after getting the top one, the card
// is "banked": it counts as 'one' until something else happens.

export const DEFAULT_SETTINGS = { seconds: 90, rounds: 5, talk: 'mix' };
export const DEFAULT_TEAM_NAMES = ['Blue', 'Red'];
export const POINTS = { one: 1, three: 3, skip: -1, none: 0 };

const MAX_UNDO = 60;

/**
 * Order of talk rules by round. Round 1 is always One syllable so everyone
 * learns the game on the simplest rule; the rest are shuffled.
 */
function talkRuleOrder(rng) {
  const rest = TALK_RULES.map((r) => r.id).filter((id) => id !== CLASSIC_RULE);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [CLASSIC_RULE, ...rest];
}

export function createGame({ teams, settings = {}, firstTeam = 0, rng = Math.random }) {
  const seconds = settings.seconds ?? DEFAULT_SETTINGS.seconds;
  const rounds = settings.rounds ?? DEFAULT_SETTINGS.rounds;
  const talk = settings.talk === 'classic' ? 'classic' : 'mix';
  return {
    v: 3,
    settings: { seconds, rounds, talk },
    baseRounds: rounds,
    ruleOrder: talkRuleOrder(rng),
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
  if (!saved || saved.v !== 3 || !Array.isArray(saved.teams) || saved.teams.length < 2) return null;
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

/** Id of the talk rule for a round (defaults to the current round). */
export function talkRuleFor(g, round = currentRound(g)) {
  if (g.settings.talk === 'classic') return CLASSIC_RULE;
  return g.ruleOrder[(round - 1) % g.ruleOrder.length];
}

/** Name of the player due to talk for a team, or null if the team has no names. */
export function talkerFor(g, team = activeTeam(g)) {
  const { players, next } = g.teams[team];
  return players.length ? players[next % players.length] : null;
}

export function chooseTalker(g, index) {
  const team = g.teams[activeTeam(g)];
  if (index >= 0 && index < team.players.length) team.next = index;
}

/** Points the talker's team earned in one turn (finished or in progress). */
export function turnPoints(turn) {
  let pts = 0;
  for (const card of turn.cards) pts += POINTS[card.result ?? (card.banked ? 'one' : 'none')] ?? 0;
  return pts;
}

/** Score from saved turns plus manual adjustments. */
export function scores(g) {
  const pts = [...g.adjust];
  for (const turn of g.turns) pts[turn.team] += turnPoints(turn);
  return pts;
}

/** Scores including the turn being played or reviewed right now. */
export function liveScores(g) {
  const pts = scores(g);
  if (g.turn) pts[g.turn.team] += turnPoints(g.turn);
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
    talker: talkerFor(g, team),
    round: currentRound(g),
    rule: talkRuleFor(g),
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
 * Apply a press on the card on screen.
 *   'one'   the team got the top word: bank +1 and keep the card up so the
 *           talker can go for the bottom word
 *   'next'  keep the banked +1 and move on
 *   'three' the team got the bottom word: the card is worth 3
 *   'skip'  give up on the card, or the talker broke a rule: -1, and any
 *           banked point is lost
 * Returns 'banked' or 'dealt', or null when the press did nothing.
 */
export function act(g, action, draw) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.left !== null) return null;
  const card = currentCard(turn);
  if (!card) return null;
  const allowed =
    action === 'three' || action === 'skip' || (action === 'one' && !card.banked) || (action === 'next' && card.banked);
  if (!allowed) return null;
  turn.undo.push(JSON.stringify(turn.cards));
  if (turn.undo.length > MAX_UNDO) turn.undo.shift();
  if (action === 'one') {
    card.banked = true;
    return 'banked';
  }
  card.result = action === 'next' ? 'one' : action;
  deal(turn, draw);
  return 'dealt';
}

/** Undo the last press in this turn: the previous card comes back. */
export function undo(g) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn || turn.undo.length === 0) return false;
  const onScreen = currentCard(turn);
  const restored = JSON.parse(turn.undo.pop());
  // Put the card that was on screen back on top of the pile instead of losing it.
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

/** Time's up (or the talker ended early). A banked card keeps its 1 point. */
export function endTurn(g) {
  const turn = g.turn;
  if (g.phase !== 'turn' || !turn) return;
  const card = currentCard(turn);
  if (card) {
    card.result = card.banked ? 'one' : 'none';
    card.timedOut = true;
  }
  turn.left = 0;
  turn.endsAt = null;
  turn.undo = [];
  turn.queue = [];
  g.phase = 'review';
}

/** Fix a card's result on the review screen. */
export function setResult(g, index, result) {
  if (g.phase !== 'review' || !(result in POINTS)) return;
  const card = g.turn.cards[index];
  if (card) card.result = result;
}

/** Lock in the reviewed turn and move to the next team, or end the game. */
export function finishTurn(g) {
  if (g.phase !== 'review') return;
  const turn = g.turn;
  g.turns.push({
    team: turn.team,
    talker: turn.talker,
    round: turn.round,
    rule: turn.rule,
    cards: turn.cards.map(({ one, three, result }) => ({ one, three, result })),
  });
  const team = g.teams[turn.team];
  if (team.players.length) {
    const i = team.players.indexOf(turn.talker);
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
  const talkers = new Map();
  let best = null;
  let cards = 0;
  let threes = 0;
  for (const turn of g.turns) {
    const pts = turnPoints(turn);
    cards += turn.cards.length;
    threes += turn.cards.filter((c) => c.result === 'three').length;
    if (!best || pts > best.points) best = { team: turn.team, talker: turn.talker, round: turn.round, points: pts };
    if (turn.talker) {
      const key = `${turn.team}:${turn.talker}`;
      const p = talkers.get(key) ?? { name: turn.talker, team: turn.team, points: 0, skips: 0 };
      p.points += pts;
      p.skips += turn.cards.filter((c) => c.result === 'skip').length;
      talkers.set(key, p);
    }
  }
  const list = [...talkers.values()];
  const mvp = list.reduce((a, b) => (!a || b.points > a.points ? b : a), null);
  const skipper = list.filter((p) => p.skips > 0).reduce((a, b) => (!a || b.skips > a.skips ? b : a), null);
  return { cards, threes, best, mvp, skipper };
}
