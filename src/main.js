import { CARDS } from './cards.js';
import { drawCard, freshCount } from './deck.js';
import * as G from './game.js';
import { load, save } from './storage.js';
import { sfx, buzz, unlockAudio, setSoundEnabled } from './sound.js';

const app = document.getElementById('app');

// A game left alone this long opens on the home screen instead of mid-game.
const STALE_MS = 6 * 60 * 60 * 1000;
const COUNTDOWN_STEP_MS = 750;
const TIME_UP_MS = 1600;

const TIPS = [
  'Once your team says a word, you can say it too.',
  'Got the 1 but the 3 is a stretch? Tap Next to keep your point.',
  'Judge: sit close and read every word on the card.',
  'Hands down. No acting, no pointing, no counting on fingers.',
  'Tapped the wrong button? Undo puts the card back.',
  'After each turn you can fix any card before it counts.',
  'The 3-point word often has the 1-point word inside it.',
];

const prefs = { sound: true, ...load('prefs', {}) };
setSoundEnabled(prefs.sound);
const seen = new Set(load('seen', []));
let game = G.restore(load('game', null));

const ui = {
  screen: 'home', // 'home' | 'setup' | 'game'
  sheet: null, // null | 'rules' | 'menu'
  draft: null, // setup form while on the setup screen
  countdown: 0, // 3, 2, 1 before a turn starts
  timeUp: false, // TIME! splash between the turn and its review
  fx: null, // one-shot stamp for the last button press
  confirm: null, // action waiting for a second tap
  toast: null,
  shownCards: 0, // card count at last render, so only new cards animate in
  tip: Math.floor(Math.random() * TIPS.length),
};

let ticker = null;
let lastSecond = null;
let lockUntil = 0;
let countdownTimer = null;
let confirmTimer = null;
let toastTimer = null;
let wakeLock = null;

// ---------- Helpers ----------

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function fmtTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
const icons = {
  pause: svg('<rect x="6" y="5" width="4.2" height="14" rx="1.6"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6"/>'),
  undo: svg(`<path ${stroke} d="M9 8H4V3"/><path ${stroke} d="M4.6 8A8 8 0 1 1 6 17.6"/>`),
  menu: svg(`<path ${stroke} d="M4 7h16M4 12h16M4 17h16"/>`),
  back: svg(`<path ${stroke} stroke-width="2.8" d="M15 5l-7 7 7 7"/>`),
  close: svg(`<path ${stroke} stroke-width="2.8" d="M6 6l12 12M18 6L6 18"/>`),
  home: svg(`<path ${stroke} d="M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z"/>`),
  club: svg(
    '<path d="M5 20.5l8-8" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>' +
      '<path d="M12.3 6.3c1.5-2.6 5.4-3.3 7.3-1.2 1.9 2.1 1 6-1.7 7.6-2 1.2-3.9.7-5.1-.5-1.3-1.3-1.7-3.8-.5-5.9z"/>'
  ),
};

const tally = (n) => `<span class="tally" aria-hidden="true">${'<i></i>'.repeat(n)}</span>`;

function seg(action, options, current, label) {
  return `<div class="seg" role="radiogroup">${options
    .map(
      (v) =>
        `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? 'is-on' : ''}" data-action="${action}" data-value="${v}">${label(v)}</button>`
    )
    .join('')}</div>`;
}

function showToast(message) {
  ui.toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = null;
    render();
  }, 2800);
}

/** Two-tap confirmation for destructive actions. Returns true on the second tap. */
function confirmed(key) {
  clearTimeout(confirmTimer);
  if (ui.confirm === key) {
    ui.confirm = null;
    return true;
  }
  ui.confirm = key;
  confirmTimer = setTimeout(() => {
    ui.confirm = null;
    render();
  }, 3000);
  render();
  return false;
}

function commit() {
  if (game) {
    game.updatedAt = Date.now();
    save('game', game);
  }
  render();
}

function usedIds(g) {
  const ids = [];
  for (const turn of g.turns) for (const c of turn.cards) ids.push(c.one.toLowerCase());
  if (g.turn) for (const c of g.turn.cards) ids.push(c.one.toLowerCase());
  return ids;
}

function drawFromDeck() {
  const { card, reshuffled } = drawCard(CARDS, seen, usedIds(game));
  save('seen', [...seen]);
  if (reshuffled) showToast('You have played every card. Shuffling the deck.');
  return card;
}

async function holdWake() {
  try {
    if (wakeLock || !('wakeLock' in navigator) || document.hidden) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWake() {
  try {
    wakeLock?.release();
  } catch {
    // Already released.
  }
  wakeLock = null;
}

// ---------- Views ----------

function render() {
  const scroller = app.querySelector('.scroll');
  const scrollKey = scroller?.dataset.key;
  const scrollTop = scroller?.scrollTop ?? 0;
  const active = document.activeElement;
  const focusId = active && app.contains(active) && active.id ? active.id : null;
  const selection = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

  let view;
  if (ui.screen === 'setup') view = setupView();
  else if (ui.screen === 'game' && game) view = gameView();
  else view = homeView();
  app.innerHTML = view + sheetView() + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');

  const nextScroller = app.querySelector('.scroll');
  if (nextScroller && nextScroller.dataset.key === scrollKey) nextScroller.scrollTop = scrollTop;
  const focusTarget = focusId && document.getElementById(focusId);
  if (focusTarget) {
    focusTarget.focus({ preventScroll: true });
    if (selection) {
      try {
        focusTarget.setSelectionRange(...selection);
      } catch {
        // Not a text field.
      }
    }
  }
  fitText();
  ui.fx = null;
}

/** Shrink display text until it fits its box (card words, team names). */
function fitText() {
  for (const el of app.querySelectorAll('[data-fit]')) {
    const boxHeight = 'fitHeight' in el.dataset ? el.clientHeight : Infinity;
    let size = Number(el.dataset.fit);
    if (boxHeight !== Infinity) size = Math.min(size, Math.floor(boxHeight * 0.8));
    el.style.fontSize = `${size}px`;
    while (size > 14 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > boxHeight + 1)) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
  }
}

function homeView() {
  const fresh = freshCount(CARDS, seen);
  const live = game && game.phase !== 'over';
  let resume = '';
  if (live) {
    const s = G.liveScores(game);
    resume = `<button class="btn btn-primary big" data-action="continue">
        <b>Continue game</b>
        <small>Round ${G.currentRound(game)} · ${esc(game.teams[0].name)} ${s[0]} – ${s[1]} ${esc(game.teams[1].name)}</small>
      </button>`;
  }
  return `<main class="screen home">
    <div class="scroll" data-key="home">
      <div class="home-hero">
        <h1 class="logo">
          <span class="logo-small">Poetry for</span>
          <span class="logo-big" data-fit="88">Neanderthals</span>
        </h1>
        <p class="tagline">The party game where the poet may only speak in words of one syllable.</p>
        <figure class="demo" aria-label="Example card">
          <div class="card card-mini">
            <div class="half half-one">
              <div class="half-label">${tally(1)}<span>1 point</span></div>
              <p class="word">Fire</p>
            </div>
            <div class="half half-three">
              <div class="half-label">${tally(3)}<span>3 points</span></div>
              <p class="word">Fireworks</p>
            </div>
          </div>
          <figcaption class="bubble">“Hot. Bright. Go boom in sky at night.”</figcaption>
        </figure>
      </div>
    </div>
    <footer class="dock">
      ${resume}
      <div class="row">
        <button class="btn ${live ? 'btn-ghost' : 'btn-primary big'}" data-action="new-game"><b>New game</b></button>
        <button class="btn btn-ghost ${live ? '' : 'big'}" data-action="rules"><b>How to play</b></button>
      </div>
      <p class="deck-note">
        ${plural(fresh, 'card')} left to play on this phone before any repeats.
        ${
          fresh < CARDS.length
            ? `<button class="link-btn" data-action="reset-history">${ui.confirm === 'reset-history' ? 'Tap again to reset' : 'Reset'}</button>`
            : ''
        }
      </p>
    </footer>
  </main>`;
}

function setupView() {
  const d = ui.draft;
  const minutes = d.settings.rounds ? Math.round((d.settings.rounds * 2 * (d.settings.seconds + 40)) / 60) : 0;
  return `<main class="screen setup">
    <header class="topbar">
      <button class="icon-btn" data-action="home" aria-label="Back">${icons.back}</button>
      <h1 class="topbar-title">New game</h1>
      <button class="icon-btn icon-text" data-action="rules" aria-label="How to play">?</button>
    </header>
    <div class="scroll" data-key="setup">
      <div class="stack">
        ${d.teams.map(teamEditor).join('')}
        <p class="hint">Player names are optional. Add them and the game tells you who is poet each turn.</p>
        <section class="field">
          <h2 class="field-label">Turn length</h2>
          ${seg('set-draft-seconds', [60, 90, 120], d.settings.seconds, (v) => `${v} sec`)}
        </section>
        <section class="field">
          <h2 class="field-label">Rounds</h2>
          ${seg('set-draft-rounds', [3, 5, 8, 0], d.settings.rounds, (v) => (v ? v : 'No limit'))}
          <p class="hint">${
            minutes ? `Each round, both teams play one turn. About ${minutes} minutes in all.` : 'Play as long as you like and end the game from the menu.'
          }</p>
        </section>
        <label class="toggle-row" for="skip-penalty">
          <span><b>Skips cost a point</b><small>The other team gets 1 point when the poet skips a card. This is the official rule.</small></span>
          <input type="checkbox" id="skip-penalty" data-change="skip-penalty" ${d.settings.skipPenalty ? 'checked' : ''}>
          <i class="switch" aria-hidden="true"></i>
        </label>
        ${game && game.phase !== 'over' ? '<p class="hint">Starting a new game replaces the one in progress.</p>' : ''}
      </div>
    </div>
    <footer class="dock">
      <button class="btn btn-primary big" data-action="start-game"><b>Start game</b></button>
    </footer>
  </main>`;
}

function teamEditor(team, i) {
  return `<section class="team-card t${i}">
    <label class="field-label" for="team-name-${i}"><span class="team-dot"></span>Team ${i + 1}</label>
    <input id="team-name-${i}" class="team-name-input" value="${esc(team.name)}" maxlength="16" autocomplete="off"
      autocapitalize="words" spellcheck="false" placeholder="${G.DEFAULT_TEAM_NAMES[i]}" data-input="team-name" data-team="${i}">
    ${
      team.players.length
        ? `<ul class="chips">${team.players
            .map(
              (p, j) =>
                `<li class="chip">${esc(p)}<button type="button" data-action="remove-player" data-team="${i}" data-index="${j}" aria-label="Remove ${esc(p)}">${icons.close}</button></li>`
            )
            .join('')}</ul>`
        : ''
    }
    <form class="add-player" data-form="add-player" data-team="${i}">
      <input id="add-player-${i}" placeholder="Add a player" maxlength="16" autocomplete="off" autocapitalize="words"
        spellcheck="false" enterkeyhint="done" aria-label="Add a player to ${esc(team.name || G.DEFAULT_TEAM_NAMES[i])}">
      <button class="btn small" type="submit"><b>Add</b></button>
    </form>
  </section>`;
}

function gameView() {
  if (game.phase === 'ready') return readyView();
  if (game.phase === 'turn' || (game.phase === 'review' && ui.timeUp)) return turnView();
  if (game.phase === 'review') return reviewView();
  return overView();
}

function scoreboard(pts, highlight) {
  return `<section class="scoreboard" aria-label="Score">
    ${game.teams
      .map(
        (t, i) => `<div class="sb t${i} ${i === highlight ? 'is-active' : ''}">
          <span class="sb-name">${esc(t.name)}</span>
          <span class="sb-score">${pts[i]}</span>
        </div>`
      )
      .join('')}
  </section>`;
}

function roundLabel() {
  const round = G.currentRound(game);
  const total = game.settings.rounds;
  if (!total) return `Round ${round}`;
  return G.isFinalRound(game) ? `Final round · ${round} of ${total}` : `Round ${round} of ${total}`;
}

function readyView() {
  const t = G.activeTeam(game);
  const team = game.teams[t];
  const opp = game.teams[G.other(game, t)];
  const poet = G.poetFor(game, t);
  const last = game.turns[game.turns.length - 1];
  let lastLine = '';
  if (last) {
    const pts = G.turnPoints(game, last);
    const o = G.other(game, last.team);
    lastLine = `<p class="last-turn">Last turn: <span class="t${last.team}">${esc(game.teams[last.team].name)} +${pts[last.team]}</span>${
      pts[o] ? ` · <span class="t${o}">${esc(game.teams[o].name)} +${pts[o]}</span>` : ''
    }</p>`;
  }
  return `<main class="screen ready t${t}">
    <header class="topbar">
      <button class="icon-btn" data-action="home" aria-label="Home">${icons.home}</button>
      <p class="round-label">${roundLabel()}</p>
      <button class="icon-btn" data-action="menu" aria-label="Game menu">${icons.menu}</button>
    </header>
    <div class="scroll" data-key="ready">
      ${scoreboard(G.scores(game), t)}
      <section class="handoff">
        <p class="eyebrow">Up next</p>
        <h1 class="team-title" data-fit="120">${esc(team.name)}</h1>
        ${
          poet
            ? `<p class="poet-line"><b>${esc(poet)}</b> is the poet</p>`
            : `<p class="poet-line">Pick a poet from ${esc(team.name)}</p>`
        }
        ${
          team.players.length > 1
            ? `<div class="poet-picker" role="radiogroup" aria-label="Change poet">${team.players
                .map(
                  (p, i) =>
                    `<button type="button" role="radio" aria-checked="${p === poet}" class="${p === poet ? 'is-on' : ''}" data-action="pick-poet" data-index="${i}">${esc(p)}</button>`
                )
                .join('')}</div>`
            : ''
        }
        <ol class="steps">
          <li>Give the phone to ${poet ? esc(poet) : 'the poet'}.</li>
          <li>One ${esc(opp.name)} player sits beside them to judge.</li>
          <li>The rest of ${esc(team.name)} gets ready to guess.</li>
        </ol>
        <p class="tip">${esc(TIPS[ui.tip % TIPS.length])}</p>
      </section>
    </div>
    <footer class="dock">
      ${lastLine}
      <button class="btn btn-team big" data-action="start-turn"><b>Start turn</b><small>${game.settings.seconds} seconds</small></button>
    </footer>
    ${
      ui.countdown
        ? `<div class="overlay countdown">
            <p class="eyebrow">${poet ? `${esc(poet)}, get ready` : 'Poet, get ready'}</p>
            <p class="countdown-num" aria-live="assertive">${ui.countdown}</p>
            <button class="link-btn" data-action="cancel-countdown">Cancel</button>
          </div>`
        : ''
    }
  </main>`;
}

function turnView() {
  const turn = game.turn;
  const card = G.currentCard(turn);
  const team = game.teams[turn.team];
  const o = G.other(game, turn.team);
  const opp = game.teams[o];
  const pts = G.turnPoints(game, turn);
  const left = G.timeLeft(turn, Date.now());
  const paused = G.isPaused(turn) && !ui.timeUp;
  const low = left <= 10000;
  const banked = card?.banked;
  const isNew = turn.cards.length !== ui.shownCards;
  ui.shownCards = turn.cards.length;
  const fx = ui.fx;
  const fxLabel = fx && { one: '+1', three: '+3', no: 'NO!', skip: 'Skip' }[fx];

  return `<main class="screen turn t${turn.team} ${fx === 'no' ? 'shake' : ''}">
    <header class="turn-top">
      <div class="turn-team"><span class="team-dot"></span><span>${esc(team.name)}${turn.poet ? ` · ${esc(turn.poet)}` : ''}</span></div>
      <div class="clock ${low ? 'is-low' : ''}" id="clock" role="timer" aria-label="Time left">${fmtTime(left)}</div>
      <button class="icon-btn" data-action="pause" aria-label="Pause">${icons.pause}</button>
    </header>
    <div class="timebar ${low ? 'is-low' : ''}" aria-hidden="true"><i id="timefill" style="transform:scaleX(${left / turn.total})"></i></div>
    ${
      card && !paused
        ? `<section class="card ${banked ? 'is-banked' : ''} ${isNew ? 'enter' : ''}" aria-label="Card">
            <div class="half half-one">
              <div class="half-label">${tally(1)}<span>1 point</span>${banked ? '<span class="tag">Got it</span>' : ''}</div>
              <p class="word" data-fit="88" data-fit-height>${esc(card.one)}</p>
            </div>
            <div class="half half-three">
              <div class="half-label">${tally(3)}<span>3 points</span>${banked ? '<span class="tag tag-go">Go for 3?</span>' : ''}</div>
              <p class="word" data-fit="80" data-fit-height>${esc(card.three)}</p>
            </div>
          </section>`
        : '<section class="card card-empty"></section>'
    }
    <div class="turn-meta">
      <button class="link-btn" data-action="undo" ${turn.undo.length ? '' : 'disabled'}>${icons.undo}Undo</button>
      <p class="turn-score" aria-label="Points this turn">
        <span class="ts-team">${esc(team.name)} +${pts[turn.team]}</span>
        ${pts[o] ? `<span class="ts-opp">${esc(opp.name)} +${pts[o]}</span>` : ''}
      </p>
    </div>
    <div class="controls">
      ${
        banked
          ? '<button class="btn act-one is-next" data-action="one"><b>Next</b><small>Keep 1 point</small></button>'
          : '<button class="btn act-one" data-action="one"><b>+1</b><small>Got it</small></button>'
      }
      <button class="btn act-three" data-action="three"><b>+3</b><small>Got it</small></button>
      <button class="btn act-skip" data-action="skip" ${banked ? 'disabled' : ''}><b>Skip</b><small>${
        game.settings.skipPenalty ? `${esc(opp.name)} +1` : 'Free'
      }</small></button>
      <button class="btn act-no" data-action="no"><b>${icons.club}NO!</b><small>${esc(opp.name)} +1</small></button>
    </div>
    ${fxLabel ? `<div class="fx fx-${fx}" aria-hidden="true">${fxLabel}</div>` : ''}
    ${
      paused
        ? `<div class="overlay pause-overlay">
            <p class="eyebrow">Paused · card hidden</p>
            <p class="pause-time">${fmtTime(left)}</p>
            <p class="hint">The clock is stopped. Resume when everyone is ready.</p>
            <div class="overlay-actions">
              <button class="btn btn-team big" data-action="resume"><b>Resume</b></button>
              <button class="btn btn-ghost" data-action="end-turn"><b>${ui.confirm === 'end-turn' ? 'Tap again to end turn' : 'End turn now'}</b></button>
              <button class="link-btn" data-action="rules">How to play</button>
            </div>
          </div>`
        : ''
    }
    ${ui.timeUp ? '<div class="overlay timeup" role="alert"><p class="stamp">Time!</p></div>' : ''}
  </main>`;
}

const REVIEW_OPTIONS = ['no', 'none', 'one', 'three'];

function reviewSegment(card) {
  if (card.result === 'skip') return game.settings.skipPenalty ? 'no' : 'none';
  return card.result;
}

function reviewView() {
  const turn = game.turn;
  const team = game.teams[turn.team];
  const o = G.other(game, turn.team);
  const opp = game.teams[o];
  const pts = G.turnPoints(game, turn);
  const final = G.isFinalTurn(game);
  const next = game.teams[(G.activeTeam(game) + 1) % game.teams.length];
  const rows = turn.cards
    .map((card, i) => {
      const current = reviewSegment(card);
      const keepSkip = card.result === 'skip' && game.settings.skipPenalty;
      const lostLabel = keepSkip ? 'Skip' : 'NO!';
      const labels = { no: lostLabel, none: '0', one: '1', three: '3' };
      const names = { no: `${lostLabel}, ${opp.name} gets 1`, none: 'No points', one: '1 point', three: '3 points' };
      return `<li class="rv-row">
        <div class="rv-words">
          <span class="rv-one">${esc(card.one)}</span>
          <span class="rv-three">${esc(card.three)}${card.timedOut ? ' <span class="tag tag-quiet">Buzzer</span>' : ''}</span>
        </div>
        <div class="seg seg-result" role="radiogroup" aria-label="Result for ${esc(card.one)}">
          ${REVIEW_OPTIONS.map(
            (v) =>
              `<button type="button" role="radio" aria-checked="${v === current}" aria-label="${esc(names[v])}" class="${v === current ? 'is-on' : ''}" data-action="set-result" data-index="${i}" data-value="${v === 'no' && keepSkip ? 'skip' : v}" data-kind="${v}">${labels[v]}</button>`
          ).join('')}
        </div>
      </li>`;
    })
    .join('');
  return `<main class="screen review t${turn.team}">
    <header class="review-head">
      <p class="eyebrow">Turn over · ${esc(team.name)}${turn.poet ? ` · ${esc(turn.poet)}` : ''}</p>
      <p class="review-total">${esc(team.name)} +${pts[turn.team]}</p>
      <p class="review-sub">${pts[o] ? `<span class="ts-opp">${esc(opp.name)} +${pts[o]}</span> from skips and NO!s` : 'No points given away'}</p>
    </header>
    <p class="hint review-hint">Judge disagrees? Fix any card before it counts.</p>
    <div class="scroll" data-key="review">
      ${turn.cards.length ? `<ul class="rv-list">${rows}</ul>` : '<p class="hint">No cards this turn.</p>'}
    </div>
    <footer class="dock">
      <button class="btn btn-primary big" data-action="finish-turn">
        <b>${final ? 'See final score' : 'Save turn'}</b>
        ${final ? '' : `<small>Next up: ${esc(next.name)}</small>`}
      </button>
    </footer>
  </main>`;
}

function overView() {
  const { scores, winner } = G.standings(game);
  const st = G.stats(game);
  const w = winner === null ? null : game.teams[winner];
  const l = winner === null ? null : game.teams[G.other(game, winner)];
  const rounds = Math.ceil(game.turns.length / game.teams.length);
  const award = (label, value, note) =>
    `<li class="award"><span class="eyebrow">${label}</span><span class="award-value">${value}</span><span class="award-note">${note}</span></li>`;
  const awards = [];
  if (st.mvp?.points > 0) awards.push(award('Top poet', esc(st.mvp.name), `${plural(st.mvp.points, 'point')} for ${esc(game.teams[st.mvp.team].name)}`));
  if (st.best?.points > 0)
    awards.push(
      award('Best turn', `${esc(game.teams[st.best.team].name)} +${st.best.points}`, `${st.best.poet ? `${esc(st.best.poet)}, ` : ''}round ${st.best.round}`)
    );
  if (st.bonked) awards.push(award('Most bonked', esc(st.bonked.name), `${st.bonked.nos} NO!${st.bonked.nos === 1 ? '' : 's'}`));
  awards.push(award('Cards played', st.cards, `${st.threes} for 3 points`));

  return `<main class="screen over ${winner === null ? 'is-tie' : `t${winner}`}">
    <div class="scroll" data-key="over">
      <div class="over-head">
        <p class="eyebrow">Game over · ${plural(rounds, 'round')}</p>
        <h1 class="winner" data-fit="112">${w ? `${esc(w.name)} win!` : 'Tie!'}</h1>
        <p class="grunt">${w ? `${esc(w.name)} happy. ${esc(l.name)} sad.` : 'Same score. Both good. Both bad.'}</p>
      </div>
      ${scoreboard(scores, winner)}
      <ul class="awards">${awards.join('')}</ul>
    </div>
    <footer class="dock">
      ${winner === null ? '<button class="btn btn-primary big" data-action="add-round"><b>Play a tiebreaker round</b></button>' : ''}
      <div class="row">
        <button class="btn ${winner === null ? 'btn-ghost' : 'btn-primary big'}" data-action="rematch"><b>Rematch</b><small>Same teams</small></button>
        <button class="btn btn-ghost ${winner === null ? '' : 'big'}" data-action="setup-again"><b>New teams</b></button>
      </div>
      <button class="link-btn center" data-action="home">Home</button>
    </footer>
  </main>`;
}

function sheetView() {
  if (!ui.sheet) return '';
  const title = ui.sheet === 'rules' ? 'How to play' : 'Game menu';
  const body = ui.sheet === 'rules' ? rulesSheet() : menuSheet();
  return `<div class="sheet-wrap">
    <div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-head">
        <h2 class="sheet-title">${title}</h2>
        <button class="icon-btn" data-action="close-sheet" aria-label="Close">${icons.close}</button>
      </div>
      ${body}
    </div>
  </div>`;
}

function rulesSheet() {
  const freeSkips = game && ui.screen === 'game' && !game.settings.skipPenalty;
  return `<ol class="rules">
    <li><b>Teams take turns.</b> On your turn you are the poet. Get your own team to guess as many cards as you can before time runs out.</li>
    <li><b>Words of one syllable only.</b> “Big rock fall from sky. Go boom.” is fine. Say “meteor” and you get bonked.</li>
    <li><b>No tricks.</b> No gestures or acting, no “sounds like” or “rhymes with”, no spelling, initials or other languages. Never say any part of the word on the card. Once your team says a word, you may use it.</li>
    <li><b>1 point or 3 points.</b> Each card has an easier 1-point word and a harder 3-point word, and you can go for either. When your team gets the 1, tap +1. Tap again to keep the point and move on, or push for the 3. A card is worth 3 at most.</li>
    <li><b>The judge.</b> A player from the other team sits beside the poet and watches the card. Break a rule and they yell “NO!”, bonk you (gently) and tap NO!. The card is lost, along with any point you had on it, and their team gets 1 point.</li>
    <li><b>Skips.</b> ${freeSkips ? 'Stuck? Skip the card. Skips are free in this game.' : 'Stuck? Skip the card. The other team gets 1 point.'}</li>
    <li><b>Winning.</b> Most points after the last round wins.</li>
  </ol>
  <p class="hint">Tapped the wrong button? Undo puts the card back. After each turn you can fix any card before the score is saved.</p>`;
}

function menuSheet() {
  const s = game.settings;
  const minRounds = G.currentRound(game);
  const pts = G.scores(game);
  return `<div class="menu-list">
    <label class="toggle-row" for="sound-toggle">
      <span><b>Sound and vibration</b></span>
      <input type="checkbox" id="sound-toggle" data-change="sound" ${prefs.sound ? 'checked' : ''}>
      <i class="switch" aria-hidden="true"></i>
    </label>
    <section class="field">
      <h3 class="field-label">Turn length</h3>
      ${seg('set-seconds', [60, 90, 120], s.seconds, (v) => `${v} sec`)}
    </section>
    <section class="field">
      <h3 class="field-label">Rounds</h3>
      <div class="stepper">
        <button type="button" data-action="rounds-dec" aria-label="Fewer rounds" ${!s.rounds || s.rounds <= minRounds ? 'disabled' : ''}>−</button>
        <output>${s.rounds || '∞'}</output>
        <button type="button" data-action="rounds-inc" aria-label="More rounds" ${!s.rounds || s.rounds >= 30 ? 'disabled' : ''}>+</button>
        <button type="button" class="chip-toggle ${s.rounds ? '' : 'is-on'}" data-action="rounds-unlimited" aria-pressed="${!s.rounds}">No limit</button>
      </div>
    </section>
    <section class="field">
      <h3 class="field-label">Fix the score</h3>
      ${game.teams
        .map(
          (t, i) => `<div class="stepper adjust t${i}">
            <span class="adjust-name">${esc(t.name)}</span>
            <button type="button" data-action="adjust" data-team="${i}" data-delta="-1" aria-label="Take a point from ${esc(t.name)}">−</button>
            <output>${pts[i]}</output>
            <button type="button" data-action="adjust" data-team="${i}" data-delta="1" aria-label="Give ${esc(t.name)} a point">+</button>
          </div>`
        )
        .join('')}
    </section>
    <button class="btn btn-ghost" data-action="rules"><b>How to play</b></button>
    <button class="btn btn-danger" data-action="end-game"><b>${ui.confirm === 'end-game' ? 'Tap again to end the game' : 'End game and see results'}</b></button>
    <button class="link-btn center" data-action="quit">Go to home screen. The game is saved.</button>
  </div>`;
}

// ---------- Turn flow ----------

function startTicker() {
  stopTicker();
  lastSecond = null;
  ticker = setInterval(tick, 100);
  tick();
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function tick() {
  const turn = game?.turn;
  if (!turn || game.phase !== 'turn') return stopTicker();
  const left = G.timeLeft(turn, Date.now());
  const low = left <= 10000;
  const clock = document.getElementById('clock');
  if (clock) {
    clock.textContent = fmtTime(left);
    clock.classList.toggle('is-low', low);
  }
  const fill = document.getElementById('timefill');
  if (fill) {
    fill.style.transform = `scaleX(${left / turn.total})`;
    fill.parentElement.classList.toggle('is-low', low);
  }
  if (G.isPaused(turn)) return;
  const second = Math.ceil(left / 1000);
  if (second !== lastSecond) {
    lastSecond = second;
    if (second <= 10 && second > 0) sfx.tick(second <= 3);
  }
  if (left <= 0) timeUp();
}

function timeUp() {
  stopTicker();
  G.endTurn(game);
  sfx.time();
  buzz([250, 80, 250]);
  ui.timeUp = true;
  commit();
  setTimeout(() => {
    ui.timeUp = false;
    render();
  }, TIME_UP_MS);
}

function cancelCountdown() {
  clearTimeout(countdownTimer);
  ui.countdown = 0;
  render();
}

function startTurn() {
  if (ui.countdown || game.phase !== 'ready') return;
  unlockAudio();
  holdWake();
  ui.countdown = 3;
  sfx.count();
  render();
  const step = () => {
    ui.countdown -= 1;
    if (ui.countdown > 0) {
      sfx.count();
      render();
      countdownTimer = setTimeout(step, COUNTDOWN_STEP_MS);
      return;
    }
    G.startTurn(game, Date.now(), drawFromDeck);
    ui.shownCards = 0;
    sfx.go();
    buzz(40);
    commit();
    startTicker();
  };
  countdownTimer = setTimeout(step, COUNTDOWN_STEP_MS);
}

const SOUNDS = { bank: sfx.bank, one: sfx.one, three: sfx.three, no: sfx.no, skip: sfx.skip };

function press(kind) {
  const now = performance.now();
  if (now < lockUntil || ui.timeUp) return;
  const outcome = G.act(game, kind, drawFromDeck);
  if (!outcome) return;
  const cards = game.turn.cards;
  const result = outcome === 'banked' ? 'bank' : cards[cards.length - 2].result;
  // Block ghost double-taps; a new card gets a longer guard so nobody scores it by accident.
  lockUntil = now + (outcome === 'dealt' ? 320 : 120);
  ui.fx = result === 'bank' ? null : result;
  SOUNDS[result]();
  buzz(result === 'no' ? [70, 40, 140] : result === 'three' ? [30, 40, 30, 40, 30] : 25);
  commit();
}

// ---------- Actions ----------

function newDraft(fromGame) {
  const source = fromGame
    ? { teams: fromGame.teams, settings: { ...fromGame.settings, rounds: fromGame.baseRounds ?? fromGame.settings.rounds } }
    : load('setup', null);
  return {
    teams: [0, 1].map((i) => ({
      name: source?.teams?.[i]?.name ?? G.DEFAULT_TEAM_NAMES[i],
      players: [...(source?.teams?.[i]?.players ?? [])],
    })),
    settings: { ...G.DEFAULT_SETTINGS, ...(source?.settings ?? {}) },
  };
}

function addPlayer(t, { quiet = false } = {}) {
  const input = document.getElementById(`add-player-${t}`);
  const name = input?.value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  const team = ui.draft.teams[t];
  if (team.players.some((p) => p.toLowerCase() === name.toLowerCase())) {
    if (!quiet) showToast(`${name} is already on ${team.name || G.DEFAULT_TEAM_NAMES[t]}.`);
    input.value = '';
    return;
  }
  team.players.push(name);
  input.value = '';
}

const actions = {
  home() {
    ui.screen = 'home';
    ui.sheet = null;
    releaseWake();
    render();
  },
  continue() {
    ui.screen = 'game';
    holdWake();
    render();
  },
  'new-game'() {
    ui.draft = newDraft();
    ui.screen = 'setup';
    render();
  },
  'setup-again'() {
    ui.draft = newDraft(game);
    ui.screen = 'setup';
    render();
  },
  rules() {
    if (game?.phase === 'turn' && !G.isPaused(game.turn)) {
      G.pause(game, Date.now());
      save('game', game);
    }
    ui.sheet = 'rules';
    render();
  },
  menu() {
    ui.sheet = 'menu';
    render();
  },
  'close-sheet'() {
    ui.sheet = null;
    ui.confirm = null;
    render();
  },
  'reset-history'() {
    if (!confirmed('reset-history')) return;
    seen.clear();
    save('seen', []);
    showToast('Card history cleared. Every card is fresh again.');
    render();
  },

  // Setup
  'set-draft-seconds'(d) {
    ui.draft.settings.seconds = Number(d.value);
    render();
  },
  'set-draft-rounds'(d) {
    ui.draft.settings.rounds = Number(d.value);
    render();
  },
  'remove-player'(d) {
    ui.draft.teams[Number(d.team)].players.splice(Number(d.index), 1);
    render();
  },
  'start-game'() {
    [0, 1].forEach((t) => addPlayer(t, { quiet: true }));
    const [a, b] = ui.draft.teams.map((t, i) => (t.name.trim() || G.DEFAULT_TEAM_NAMES[i]).toLowerCase());
    if (a === b) {
      showToast('Give the two teams different names.');
      render();
      return;
    }
    save('setup', ui.draft);
    game = G.createGame({ teams: ui.draft.teams, settings: ui.draft.settings });
    ui.screen = 'game';
    ui.draft = null;
    unlockAudio();
    holdWake();
    commit();
  },

  // Between turns
  'pick-poet'(d) {
    G.choosePoet(game, Number(d.index));
    commit();
  },
  'start-turn': startTurn,
  'cancel-countdown': cancelCountdown,

  // During a turn
  one: () => press('one'),
  three: () => press('three'),
  no: () => press('no'),
  skip: () => press('skip'),
  undo() {
    if (!G.undo(game)) return;
    sfx.undo();
    commit();
  },
  pause() {
    G.pause(game, Date.now());
    commit();
  },
  resume() {
    unlockAudio();
    holdWake();
    G.resume(game, Date.now());
    ui.sheet = null;
    commit();
    startTicker();
  },
  'end-turn'() {
    if (!confirmed('end-turn')) return;
    stopTicker();
    G.endTurn(game);
    commit();
  },

  // Review
  'set-result'(d) {
    G.setResult(game, Number(d.index), d.value);
    commit();
  },
  'finish-turn'() {
    G.finishTurn(game);
    ui.tip += 1;
    if (game.phase === 'over') {
      sfx.win();
      releaseWake();
    }
    commit();
  },

  // Menu
  'set-seconds'(d) {
    game.settings.seconds = Number(d.value);
    commit();
  },
  'rounds-dec'() {
    game.settings.rounds = Math.max(G.currentRound(game), game.settings.rounds - 1);
    commit();
  },
  'rounds-inc'() {
    game.settings.rounds = Math.min(30, game.settings.rounds + 1);
    commit();
  },
  'rounds-unlimited'() {
    game.settings.rounds = game.settings.rounds ? 0 : Math.max(G.currentRound(game), game.baseRounds || G.DEFAULT_SETTINGS.rounds);
    commit();
  },
  adjust(d) {
    game.adjust[Number(d.team)] += Number(d.delta);
    commit();
  },
  'end-game'() {
    if (!confirmed('end-game')) return;
    G.endGame(game);
    ui.sheet = null;
    sfx.win();
    releaseWake();
    commit();
  },
  quit() {
    ui.sheet = null;
    actions.home();
  },

  // Game over
  rematch() {
    game = G.rematch(game);
    ui.screen = 'game';
    holdWake();
    commit();
  },
  'add-round'() {
    G.addRound(game);
    holdWake();
    commit();
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = actions[el.dataset.action];
  if (!action) return;
  e.preventDefault();
  action(el.dataset);
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.input === 'team-name' && ui.draft) ui.draft.teams[Number(el.dataset.team)].name = el.value;
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.change === 'skip-penalty' && ui.draft) {
    ui.draft.settings.skipPenalty = el.checked;
  } else if (el.dataset.change === 'sound') {
    prefs.sound = el.checked;
    setSoundEnabled(prefs.sound);
    save('prefs', prefs);
    if (prefs.sound) {
      unlockAudio();
      sfx.one();
    }
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.form !== 'add-player') return;
  const t = Number(form.dataset.team);
  addPlayer(t);
  render();
  document.getElementById(`add-player-${t}`)?.focus();
});

// Keyboard shortcuts, handy on a laptop: 1, 3, N (no), S (skip), U (undo), space (pause).
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape' && ui.sheet) return actions['close-sheet']();
  if (ui.screen !== 'game' || game?.phase !== 'turn' || ui.sheet) return;
  const paused = G.isPaused(game.turn);
  const key = e.key.toLowerCase();
  if (key === ' ') {
    e.preventDefault();
    return paused ? actions.resume() : actions.pause();
  }
  if (paused) return;
  const map = { 1: 'one', 3: 'three', n: 'no', s: 'skip', u: 'undo' };
  if (map[key]) actions[map[key]]();
});

// Leaving the app mid-turn (a call, a locked screen) pauses the clock.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (ui.countdown) cancelCountdown();
    if (game?.phase === 'turn' && !G.isPaused(game.turn) && !ui.timeUp) {
      G.pause(game, Date.now());
      commit();
    }
  } else if (ui.screen === 'game' && game && game.phase !== 'over') {
    holdWake();
  }
});

// ---------- Boot ----------

if (game) {
  if (game.phase === 'turn') {
    // Reloaded mid-turn: hold the clock until the poet is ready again.
    G.pause(game, Date.now());
    if (G.timeLeft(game.turn, Date.now()) <= 0) G.endTurn(game);
    save('game', game);
  }
  const recent = Date.now() - (game.updatedAt ?? 0) < STALE_MS;
  if (game.phase !== 'over' && recent) ui.screen = 'game';
}
render();
if (game?.phase === 'turn') startTicker();

// Display text is measured on render; measure again once the web font arrives
// (the fallback font is wider) and whenever the screen changes size.
document.fonts?.ready.then(fitText);
document.fonts?.addEventListener?.('loadingdone', fitText);
window.addEventListener('resize', fitText);
