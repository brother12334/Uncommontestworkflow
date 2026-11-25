// Synthesized forest bed: wind, birds by day, crickets by night. Never autoplays.
export function createAudio() {
  let ctx = null, master, dayGain, nightGain, birdTimer = 0, on = false, night = 0;

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    dayGain = ctx.createGain(); dayGain.connect(master);
    nightGain = ctx.createGain(); nightGain.gain.value = 0; nightGain.connect(master);

    // pink-ish noise wind
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2) * 0.35;
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const wind = ctx.createGain(); wind.gain.value = 0.04; // ≈ -28 dB
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.02;
    lfo.connect(lfoAmt); lfoAmt.connect(wind.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = 260;
    lfo2.connect(lfo2Amt); lfo2Amt.connect(lp.frequency);
    src.connect(lp); lp.connect(wind); wind.connect(master);
    src.start(); lfo.start(); lfo2.start();

    // crickets: pulsed high tone
    const cr = ctx.createOscillator(); cr.type = 'triangle'; cr.frequency.value = 4300;
    const crAm = ctx.createGain(); crAm.gain.value = 0;
    const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 22;
    const pulseAmt = ctx.createGain(); pulseAmt.gain.value = 0.012;
    const slow = ctx.createOscillator(); slow.type = 'square'; slow.frequency.value = 1.6;
    const slowAmt = ctx.createGain(); slowAmt.gain.value = 0.5;
    pulse.connect(pulseAmt); pulseAmt.connect(crAm.gain);
    slow.connect(slowAmt);
    const crGate = ctx.createGain(); crGate.gain.value = 0.5;
    slowAmt.connect(crGate.gain);
    cr.connect(crAm); crAm.connect(crGate); crGate.connect(nightGain);
    cr.start(); pulse.start(); slow.start();
    return true;
  }

  function chirp() {
    if (!on || !ctx) return;
    const t = ctx.currentTime;
    const base = 2200 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let n = 0; n < notes; n++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const s = t + n * 0.16;
      o.frequency.setValueAtTime(base * (n % 2 ? 1.18 : 1), s);
      o.frequency.exponentialRampToValueAtTime(base * (n % 2 ? 0.9 : 1.35), s + 0.11);
      g.gain.linearRampToValueAtTime(0.025, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
      o.connect(g);
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(dayGain); } else g.connect(dayGain);
      o.start(s); o.stop(s + 0.15);
    }
    birdTimer = setTimeout(chirp, 3000 + Math.random() * 6000);
  }

  return {
    get on() { return on; },
    toggle() {
      if (!ctx && !init()) return false;
      on = !on;
      if (on) ctx.resume();
      master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.4);
      clearTimeout(birdTimer);
      if (on) birdTimer = setTimeout(chirp, 800);
      return on;
    },
    setNight(n) {
      if (!ctx || Math.abs(n - night) < 0.01) return;
      night = n;
      dayGain.gain.setTargetAtTime(1 - n, ctx.currentTime, 0.3);
      nightGain.gain.setTargetAtTime(n, ctx.currentTime, 0.3);
    },
    suspend() { if (ctx && on) ctx.suspend(); },
    resume() { if (ctx && on) ctx.resume(); },
  };
}
