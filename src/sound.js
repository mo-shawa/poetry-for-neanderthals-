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

// Sawtooth through a low-pass filter: a cheap, buzzy trombone.
function brass({ freq, to = freq, dur, vol = 0.2, delay = 0, vibrato = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.linearRampToValueAtTime(to, t + dur);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1100;
  filter.Q.value = 3;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  gain.gain.setValueAtTime(vol, t + dur * 0.75);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
  }
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
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
  // Top word: a quick bright ding.
  one: () =>
    play(() => {
      tone({ freq: 880, type: 'sine', dur: 0.09, vol: 0.25 });
      tone({ freq: 1320, type: 'sine', dur: 0.22, vol: 0.22, delay: 0.07 });
    }),
  // Bottom word: a drum thump, a rising fanfare and a sparkle on top.
  three: () =>
    play(() => {
      tone({ freq: 120, to: 50, type: 'sine', dur: 0.3, vol: 0.55 });
      noise({ dur: 0.08, vol: 0.35, freq: 1800, to: 400 });
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.22, delay: 0.06 + i * 0.07 }));
      tone({ freq: 2093, type: 'sine', dur: 0.4, vol: 0.1, delay: 0.36 });
    }),
  // Skip: a short sad trombone, wah wah wah waaah.
  skip: () =>
    play(() => {
      brass({ freq: 294, dur: 0.17 });
      brass({ freq: 277, dur: 0.17, delay: 0.19 });
      brass({ freq: 262, dur: 0.17, delay: 0.38 });
      brass({ freq: 247, to: 238, dur: 0.5, delay: 0.57, vibrato: 6 });
    }),
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
