window.AMI = window.AMI || {};

// Sintese WebAudio com ondas quadradas e ruido, evocando o TIA do Atari 2600.
// O cartucho original nao tinha musica: so passos, bipes e alarmes curtos.
window.AMI.audio = (function () {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let stepAlt = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        ctx = new AC();
      }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      // Ruido "de registrador", em degraus, como o polinomio do TIA.
      let v = 0;
      for (let i = 0; i < data.length; i++) {
        if (i % 24 === 0) v = Math.random() < 0.5 ? -1 : 1;
        data[i] = v;
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, opts) {
    if (muted || !ensure()) return;
    opts = opts || {};
    const t0 = ctx.currentTime + (opts.delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    const vol = opts.vol || 0.12;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, opts) {
    if (muted || !ensure()) return;
    opts = opts || {};
    const t0 = ctx.currentTime + (opts.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.setValueAtTime(opts.rate || 1, t0);
    if (opts.rateTo) src.playbackRate.exponentialRampToValueAtTime(opts.rateTo, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.vol || 0.08, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(gain).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },
    // Passo do gorila: tique-taque grave; mais agudo quando esta pintando.
    step(painting) {
      stepAlt = !stepAlt;
      const base = painting ? (stepAlt ? 330 : 294) : (stepAlt ? 110 : 98);
      tone(base, 0.035, { vol: painting ? 0.09 : 0.07 });
    },
    segment() {
      tone(784, 0.05, { vol: 0.12 });
    },
    box() {
      const seq = [392, 523, 659, 784, 1047];
      for (let i = 0; i < seq.length; i++) tone(seq[i], 0.05, { delay: i * 0.04, vol: 0.13 });
    },
    jump() {
      tone(180, 0.28, { slideTo: 720, vol: 0.12 });
      noise(0.12, { rate: 2, rateTo: 0.6, vol: 0.05 });
    },
    noJump() {
      tone(70, 0.12, { vol: 0.12 });
    },
    chickens() {
      for (let i = 0; i < 6; i++) tone(i % 2 ? 880 : 660, 0.06, { delay: i * 0.07, vol: 0.13 });
    },
    warble() {
      tone(520, 0.08, { slideTo: 700, vol: 0.05, type: 'triangle' });
    },
    warn() {
      for (let i = 0; i < 4; i++) tone(1200, 0.05, { delay: i * 0.12, vol: 0.12 });
    },
    chickenCaught() {
      for (let i = 0; i < 4; i++) tone(440 + i * 220, 0.06, { delay: i * 0.05, vol: 0.15 });
    },
    death() {
      tone(600, 1.1, { slideTo: 45, vol: 0.2 });
      noise(1.2, { rate: 1.4, rateTo: 0.2, vol: 0.09 });
    },
    roundClear() {
      const seq = [262, 330, 392, 523, 392, 523, 659, 784];
      for (let i = 0; i < seq.length; i++) tone(seq[i], 0.08, { delay: i * 0.08, vol: 0.14 });
    },
    start() {
      tone(220, 0.08, { vol: 0.12 });
      tone(440, 0.1, { delay: 0.09, vol: 0.12 });
    },
    click() {
      noise(0.03, { rate: 3, vol: 0.06 });
    },
  };
})();
