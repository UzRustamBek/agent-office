// Soft notification chimes generated with WebAudio (no audio files).

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, vol, type = 'sine') {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = a.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  done() {
    tone(660, 0, 0.18, 0.08);
    tone(880, 0.1, 0.28, 0.08);
  },
  attention() {
    tone(520, 0, 0.16, 0.09, 'triangle');
    tone(520, 0.22, 0.2, 0.09, 'triangle');
  },
  error() {
    tone(220, 0, 0.28, 0.07, 'sawtooth');
  },
};
