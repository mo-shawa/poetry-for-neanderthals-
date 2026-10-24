// Synthesized sound effects (no audio files). Browsers only allow audio after a
// tap, so call unlockAudio() from a click handler before the first sound.
let ctx = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone({ freq, to = freq, type = 'sine', dur = 0.12, vol = 0.2, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.3, delay = 0, freq = 800, to = freq, q = 1, type = 'lowpass' }) {
  const t = ctx.currentTime + delay;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function play(fn) {
  if (!enabled || !ctx) return;
  try {
    fn();
  } catch {
    // A failed sound should never break the game.
  }
}

export const sfx = {
  // Wood-block tick for the last ten seconds; higher and louder for the last three.
  tick: (urgent) =>
    play(() => tone({ freq: urgent ? 1400 : 1000, type: 'triangle', dur: 0.05, vol: urgent ? 0.35 : 0.2 })),
  count: () => play(() => tone({ freq: 520, type: 'triangle', dur: 0.12, vol: 0.25 })),
  go: () =>
    play(() => {
      tone({ freq: 520, type: 'triangle', dur: 0.1, vol: 0.25 });
      tone({ freq: 780, type: 'triangle', dur: 0.22, vol: 0.3, delay: 0.09 });
    }),
  bank: () => play(() => tone({ freq: 660, type: 'sine', dur: 0.12, vol: 0.25 })),
  one: () =>
    play(() => {
      tone({ freq: 660, type: 'sine', dur: 0.1, vol: 0.25 });
      tone({ freq: 990, type: 'sine', dur: 0.18, vol: 0.25, delay: 0.08 });
    }),
  three: () =>
    play(() => {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.25, delay: i * 0.07 }));
    }),
  // The NO! stick: a hollow thud with a rubbery pitch drop.
  no: () =>
    play(() => {
      noise({ dur: 0.18, vol: 0.6, freq: 900, to: 120 });
      tone({ freq: 220, to: 55, type: 'sine', dur: 0.35, vol: 0.6 });
      tone({ freq: 140, to: 70, type: 'square', dur: 0.12, vol: 0.08 });
    }),
  skip: () => play(() => noise({ dur: 0.25, vol: 0.25, freq: 400, to: 2400, q: 2, type: 'bandpass' })),
  undo: () => play(() => tone({ freq: 700, to: 440, type: 'sine', dur: 0.12, vol: 0.18 })),
  time: () =>
    play(() => {
      [0, 0.28, 0.56].forEach((d) => tone({ freq: 196, type: 'sawtooth', dur: 0.24, vol: 0.22, delay: d }));
    }),
  win: () =>
    play(() => {
      [392, 523, 659, 784, 659, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.22, delay: i * 0.11 }));
    }),
};

export function buzz(pattern) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported (iOS) or blocked in a frame.
  }
}
