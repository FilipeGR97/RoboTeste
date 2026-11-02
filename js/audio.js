// Áudio: trilha de órgão procedural, ambiência espacial, motor e efeitos
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Progressão em lá menor — acordes longos e abertos
const CHORDS = [
  [45, 52, 57, 59, 60], // Lá m(add9)
  [41, 48, 57, 60, 64], // Fá maj7
  [43, 52, 55, 60, 67], // Dó/Sol
  [40, 52, 55, 59, 64], // Mi m
  [38, 50, 53, 57, 64], // Ré m9
  [41, 53, 57, 60, 65], // Fá
  [45, 52, 57, 60, 64], // Lá m
  [40, 52, 56, 59, 64], // Mi
];
const ORGAN = [[0.5, 0.32], [1, 1], [2, 0.55], [3, 0.2], [4, 0.2], [6, 0.06], [8, 0.05]];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.7, sfx: 0.8, amb: 0.6 };
    this.custom = null;
    this.ticking = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(7, 2.4);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 1;
    this.reverb.connect(this.revGain).connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.vol.music;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = this.vol.amb;
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.vol.sfx;
    this.musicBus.connect(this.master); this.ambBus.connect(this.master); this.sfxBus.connect(this.master);
    this.organBus = ctx.createGain(); this.organBus.gain.value = 1;
    this.organBus.connect(this.musicBus);
    this.musicRev = ctx.createGain(); this.musicRev.gain.value = 0.9;
    this.organBus.connect(this.musicRev).connect(this.reverb);
    this.noiseBuf = this.makeNoise(4, 'brown');
    this.whiteBuf = this.makeNoise(2, 'white');
    this.startAmbience();
    this.startEngine();
    this.startMusic();
    this.tryFolderMusic();
  }

  impulse(sec, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  makeNoise(sec, kind) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  noiseSrc(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    return s;
  }

  // ---------------------------------------------------------------- trilha
  startMusic() {
    this.chordIdx = 0; this.pass = 0;
    this.nextChordAt = this.ctx.currentTime + 0.5;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 500);
  }

  scheduleMusic() {
    const ctx = this.ctx;
    if (this.custom) return;
    while (this.nextChordAt < ctx.currentTime + 2) {
      const t = this.nextChordAt, dur = 15;
      const chord = CHORDS[this.chordIdx];
      const section = this.pass % 4; // 0 calmo, 1 ostinato, 2 pleno, 3 rarefeito
      const vel = section === 2 ? 0.05 : section === 3 ? 0.026 : 0.036;
      chord.forEach((m, k) => {
        if (section === 3 && k === 2) return;
        this.organNote(m, t, dur, vel * (k === 0 ? 1.1 : 1), section === 2 ? 2600 : 1500);
      });
      if (section >= 1 && section <= 2) this.ostinato(chord, t, dur, section === 2 ? 0.03 : 0.018);
      if (section === 2) this.organNote(chord[0] - 12, t, dur, 0.06, 400);
      if (section === 3 && this.chordIdx % 2 === 0) this.organNote(chord[4] + 12, t + 3, 9, 0.012, 3000);
      this.nextChordAt += dur - 3; // sobreposição de 3 s
      this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
      if (this.chordIdx === 0) this.pass++;
    }
  }

  organNote(midi, t, dur, vel, cutoff) {
    const ctx = this.ctx, f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(vel, t, 1.6);
    g.gain.setTargetAtTime(0, t + dur - 3, 1.4);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = cutoff; filt.Q.value = 0.4;
    filt.connect(g).connect(this.organBus);
    for (const [mult, amp] of ORGAN) {
      const fr = f * mult;
      if (fr > 9000) continue;
      const dets = mult <= 2 ? [-3, 3] : [0];
      for (const det of dets) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = fr;
        o.detune.value = det + (Math.random() - 0.5) * 2;
        const og = ctx.createGain(); og.gain.value = amp / dets.length;
        o.connect(og).connect(filt);
        o.start(t); o.stop(t + dur + 6);
      }
    }
  }

  ostinato(chord, t, dur, vel) {
    const a = chord[3] + 12, b = chord[4] + 12, c = chord[2] + 12;
    const pat = [a, b, a, b, a, b, c, b];
    const step = 0.5;
    const n = Math.floor((dur - 3) / step);
    for (let i = 0; i < n; i++) {
      const env = Math.sin((i / n) * Math.PI);
      this.pluck(pat[i % pat.length], t + i * step, vel * (0.35 + 0.65 * env));
    }
  }

  pluck(midi, t, vel) {
    const ctx = this.ctx, f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.08, 0.35);
    g.connect(this.organBus);
    for (const [mult, amp] of [[1, 1], [2, 0.4], [4, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * mult;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 2.5);
    }
  }

  // ---------------------------------------------------------------- ambiência
  startAmbience() {
    const ctx = this.ctx;
    const rum = this.noiseSrc(this.noiseBuf);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
    const rg = ctx.createGain(); rg.gain.value = 0.32;
    rum.connect(lp).connect(rg).connect(this.ambBus);
    rum.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ctx.createGain(); lg.gain.value = 0.12;
    lfo.connect(lg).connect(rg.gain); lfo.start();
    // "vento cósmico"
    const wind = this.noiseSrc(this.whiteBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 7;
    const wg = ctx.createGain(); wg.gain.value = 0.018;
    wind.connect(bp).connect(wg);
    wg.connect(this.ambBus); wg.connect(this.reverb);
    wind.start();
    const l2 = ctx.createOscillator(); l2.frequency.value = 0.031;
    const l2g = ctx.createGain(); l2g.gain.value = 320;
    l2.connect(l2g).connect(bp.frequency); l2.start();
    // gemidos metálicos distantes, ocasionais
    const groan = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime + 0.1;
      const o = ctx.createOscillator(); o.type = 'triangle';
      const f0 = 50 + Math.random() * 60;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (0.6 + Math.random() * 0.3), t + 6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 2); g.gain.linearRampToValueAtTime(0, t + 7);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = f0 * 3; f.Q.value = 3;
      o.connect(f).connect(g); g.connect(this.reverb); g.connect(this.ambBus);
      o.start(t); o.stop(t + 8);
      setTimeout(groan, 35000 + Math.random() * 50000);
    };
    setTimeout(groan, 20000);
    // tique-taque opcional
    this.tickTimer = setInterval(() => {
      if (!this.ticking || !this.ctx) return;
      const t = ctx.currentTime + 0.02;
      const s = ctx.createBufferSource(); s.buffer = this.whiteBuf;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      s.connect(hp).connect(g).connect(this.musicBus);
      s.start(t, Math.random()); s.stop(t + 0.05);
    }, 1250);
  }

  // ---------------------------------------------------------------- motor
  startEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 36;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 2;
    o.connect(lp).connect(this.engGain);
    const n = this.noiseSrc(this.noiseBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 300;
    const ng = ctx.createGain(); ng.gain.value = 0.8;
    n.connect(bp).connect(ng).connect(this.engGain);
    const wh = ctx.createOscillator(); wh.type = 'sine'; wh.frequency.value = 220;
    const whg = ctx.createGain(); whg.gain.value = 0;
    wh.connect(whg).connect(this.sfxBus);
    this.engGain.connect(this.sfxBus);
    o.start(); n.start(); wh.start();
    this.eng = { o, lp, bp, wh, whg };
  }

  setEngine(throttle, speedNorm) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0.03 + throttle * 0.16, t, 0.3);
    this.eng.lp.frequency.setTargetAtTime(150 + throttle * 500, t, 0.3);
    this.eng.bp.frequency.setTargetAtTime(200 + throttle * 900, t, 0.3);
    this.eng.o.frequency.setTargetAtTime(32 + throttle * 18, t, 0.4);
    this.eng.wh.frequency.setTargetAtTime(180 + speedNorm * 700, t, 0.5);
    this.eng.whg.gain.setTargetAtTime(throttle * 0.008, t, 0.5);
  }

  // ---------------------------------------------------------------- efeitos
  tone(freq, dur, vol = 0.1, type = 'sine', when = 0, toReverb = true, endFreq = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    if (toReverb) { const rg = ctx.createGain(); rg.gain.value = 0.4; g.connect(rg).connect(this.reverb); }
    o.start(t); o.stop(t + dur + 0.05);
  }
  click() { this.tone(1400, 0.06, 0.05); }
  hover() { this.tone(2200, 0.03, 0.015, 'sine', 0, false); }
  message() { this.tone(880, 0.15, 0.04); this.tone(1320, 0.25, 0.035, 'sine', 0.09); }
  alert() { this.tone(520, 0.25, 0.07, 'square', 0, true); this.tone(420, 0.3, 0.07, 'square', 0.28, true); }
  scanStart() { for (let i = 0; i < 6; i++) this.tone(500 + i * 180, 0.35, 0.035, 'sine', i * 0.45, true, 1800 + i * 200); }
  scanDone() { this.tone(660, 0.6, 0.06); this.tone(990, 0.9, 0.05, 'sine', 0.12); this.tone(1320, 1.2, 0.04, 'sine', 0.24); }
  discovery() {
    [57, 64, 69, 72, 76].forEach((m, i) => this.tone(mtof(m), 3.5, 0.045, 'sine', i * 0.18));
  }

  warpCharge(dur) {
    if (!this.ctx) return () => {};
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(40, t); o.frequency.exponentialRampToValueAtTime(320, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(120, t); lp.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + dur);
    const trem = ctx.createOscillator(); trem.frequency.setValueAtTime(2, t); trem.frequency.linearRampToValueAtTime(18, t + dur);
    const tg = ctx.createGain(); tg.gain.value = 0.05;
    trem.connect(tg).connect(g.gain);
    o.connect(lp).connect(g).connect(this.sfxBus);
    const n = this.noiseSrc(this.whiteBuf);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(3000, t); hp.frequency.exponentialRampToValueAtTime(600, t + dur);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.05, t + dur);
    n.connect(hp).connect(ng).connect(this.sfxBus); ng.connect(this.reverb);
    o.start(t); trem.start(t); n.start(t);
    const stop = (fade = 0.2) => {
      const tt = ctx.currentTime;
      g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, fade);
      ng.gain.cancelScheduledValues(tt); ng.gain.setTargetAtTime(0, tt, fade);
      o.stop(tt + 2); trem.stop(tt + 2); n.stop(tt + 2);
    };
    return stop;
  }

  warpJump(dur) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(28, t + 2.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    o.connect(g).connect(this.sfxBus); g.connect(this.reverb);
    o.start(t); o.stop(t + 3.2);
    const n = this.noiseSrc(this.noiseBuf);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.4); ng.gain.setValueAtTime(0.5, t + dur - 1); ng.gain.linearRampToValueAtTime(0, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = 250;
    lfo.connect(lg).connect(lp.frequency);
    n.connect(lp).connect(ng).connect(this.sfxBus);
    n.start(t); n.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
    const w = this.noiseSrc(this.whiteBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 1.2);
    const wg = ctx.createGain(); wg.gain.setValueAtTime(0.2, t); wg.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    w.connect(bp).connect(wg).connect(this.sfxBus); wg.connect(this.reverb);
    w.start(t); w.stop(t + 1.8);
  }

  arrive() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const w = this.noiseSrc(this.whiteBuf);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1;
    bp.frequency.setValueAtTime(5000, t); bp.frequency.exponentialRampToValueAtTime(200, t + 1.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    w.connect(bp).connect(g).connect(this.sfxBus); g.connect(this.reverb);
    w.start(t); w.stop(t + 2.2);
    this.tone(55, 3, 0.3, 'sine', 0, true, 40);
  }

  // ---------------------------------------------------------------- atmosfera, impacto, destruição
  // vento de atmosfera: nível 0..1 (densidade × velocidade)
  setWind(level) {
    if (!this.ctx) return;
    if (!this.atmWind) {
      const ctx = this.ctx;
      const n = this.noiseSrc(this.whiteBuf);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(bp).connect(lp).connect(g).connect(this.sfxBus);
      n.start();
      this.atmWind = { bp, g };
    }
    const t = this.ctx.currentTime;
    this.atmWind.g.gain.setTargetAtTime(Math.min(level, 1) * 0.22, t, 0.4);
    this.atmWind.bp.frequency.setTargetAtTime(250 + level * 900, t, 0.5);
  }
  thud(strength = 1) {
    if (!this.ctx) return;
    this.tone(60, 0.6, 0.25 * strength, 'sine', 0, true, 30);
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(this.noiseBuf);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    n.connect(lp).connect(g).connect(this.sfxBus); n.start(t); n.stop(t + 0.8);
  }
  // batida de casco contra casco: baque grave + ressonância metálica (parciais inarmônicas)
  clang(strength = 1) {
    if (!this.ctx) return;
    this.thud(Math.min(strength, 1));
    const f0 = 140 + Math.random() * 60;
    for (const [k, v] of [[1, 0.05], [2.76, 0.03], [5.4, 0.018], [8.9, 0.01]]) this.tone(f0 * k, 0.5 + strength * 0.9, v * strength, 'sine', 0, true, f0 * k * 0.97);
  }
  // canto de pássaro (Nova Terra)
  chirp() {
    if (!this.ctx) return;
    const f0 = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) this.tone(f0 * (1 + k * 0.08), 0.09, 0.012, 'sine', k * 0.12, true, f0 * (1.25 + k * 0.05));
  }
  step() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.whiteBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 400; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    s.connect(bp).connect(g).connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + 0.15);
  }
  explosion() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(this.noiseBuf);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(60, t + 4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 5);
    n.connect(lp).connect(g).connect(this.sfxBus); g.connect(this.reverb);
    n.start(t); n.stop(t + 5.2);
    this.tone(45, 4, 0.5, 'sine', 0, true, 20);
    this.duck(true);
  }
  // ---------------------------------------------------------------- música própria
  async tryFolderMusic() {
    for (const f of ['musica/trilha.mp3', 'musica/trilha.ogg', 'musica/trilha.m4a', 'musica/trilha.wav']) {
      try {
        const r = await fetch(f);
        if (!r.ok) continue;
        const buf = await r.arrayBuffer();
        await this.useCustom(buf);
        return true;
      } catch (e) { /* sem arquivo */ }
    }
    return false;
  }

  async useCustom(arrayBuffer) {
    const audio = await this.ctx.decodeAudioData(arrayBuffer);
    if (this.custom) { try { this.custom.stop(); } catch (e) { } }
    const s = this.ctx.createBufferSource();
    s.buffer = audio; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    s.connect(g).connect(this.musicBus);
    s.start();
    this.custom = s;
    this.organBus.gain.setTargetAtTime(0, this.ctx.currentTime, 1);
  }

  useOrgan() {
    if (this.custom) { try { this.custom.stop(); } catch (e) { } this.custom = null; }
    this.organBus.gain.setTargetAtTime(1, this.ctx.currentTime, 1);
    this.nextChordAt = this.ctx.currentTime + 0.3;
  }

  setVolume(kind, v) {
    this.vol[kind] = v;
    if (!this.ctx) return;
    const bus = { music: this.musicBus, sfx: this.sfxBus, amb: this.ambBus }[kind];
    bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  duck(on) {
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? this.vol.music * 0.35 : this.vol.music, this.ctx.currentTime, 0.8);
  }
}
