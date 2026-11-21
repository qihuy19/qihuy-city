// Qihuy City sound: everything is synthesized with WebAudio — no audio files,
// no network. A detuned-saw pad loops as sunset music, the engine is a filtered
// oscillator, the siren is a two-tone wail, and every effect is a short burst
// of shaped noise or a pitched blip. Every call is safe before the first user
// gesture and when the context is suspended (headless screenshots).
//
// v3 adds: a third radio station (harbour talk + oldies), a rain loop made of
// filtered noise that follows the weather, a thunder clap for storms, a
// higher two-tone wail for the ambulance, and a cash-register ding when a
// taxi fare pays out.
//
// v4 adds: a fourth station (Palms FM — surf guitar), a tyre-skid noise
// for handbrake slides and police rams, and a short dispatch blip the
// police brain fires when a unit changes tactic.
//
// v5 adds: a fifth station (Runway FM — jet-age, for the airport), a
// higher-revving engine voice for the motorbike, a pump clack after every
// shotgun blast, and a purchase ka-ching for the safehouse garage.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.rainGain = null;
    this.rainSrc = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicStep = 0;
    // In-car radio: five synthesized stations, switched with R while driving.
    this.station = 0;
    this.radioOn = false;
    this.stations = [
      {
        name: 'Sunset FM — chill',
        track: 'Coral Light — The Palms',
        wave: 'sawtooth',
        barMs: 4600,
        bass: false,
        chords: [
          [220.0, 261.6, 329.6],
          [174.6, 220.0, 261.6],
          [196.0, 246.9, 293.7],
          [164.8, 196.0, 246.9],
        ],
      },
      {
        name: 'Neon Drive — synthwave',
        track: 'Midnight Overpass — Vector Hold',
        wave: 'square',
        barMs: 2400,
        bass: true,
        chords: [
          [110.0, 130.8, 164.8, 220.0],
          [98.0, 123.5, 146.8, 196.0],
          [87.3, 110.0, 130.8, 174.6],
          [103.8, 130.8, 155.6, 207.7],
        ],
      },
      {
        name: 'Harbour Oldies — 45s',
        track: 'Dockside Serenade — The Tenders',
        wave: 'triangle',
        barMs: 3200,
        bass: true,
        chords: [
          [130.8, 164.8, 196.0],
          [146.8, 185.0, 220.0],
          [123.5, 155.6, 185.0],
          [110.0, 138.6, 164.8],
        ],
      },
      {
        name: 'Palms FM — surf',
        track: 'Boardwalk Breeze — The Breakers',
        wave: 'sine',
        barMs: 2000,
        bass: true,
        chords: [
          [164.8, 207.7, 246.9, 329.6],
          [146.8, 185.0, 220.0, 293.7],
          [174.6, 220.0, 261.6, 349.2],
          [130.8, 164.8, 196.0, 261.6],
        ],
      },
      {
        name: 'Runway FM — jet-age',
        track: 'Holding Pattern — The Departures',
        wave: 'triangle',
        barMs: 2600,
        bass: true,
        chords: [
          [196.0, 246.9, 293.7, 392.0],
          [174.6, 220.0, 261.6, 349.2],
          [220.0, 277.2, 329.6, 440.0],
          [164.8, 207.7, 246.9, 329.6],
        ],
      },
      // v6: Ferry FM — a slow sea-shanty station for the ferry point and
      // the boardwalk at dusk, triangle waves with a low rolling bass.
      {
        name: 'Ferry FM — shanty',
        track: 'Tide and Tar — The Ferrymen',
        wave: 'triangle',
        barMs: 3400,
        bass: true,
        chords: [
          [146.8, 185.0, 220.0, 293.7],
          [130.8, 164.8, 196.0, 261.6],
          [164.8, 207.7, 246.9, 329.6],
          [110.0, 138.6, 164.8, 220.0],
        ],
      },
    ];
  }

  get stationName() { return this.stations[this.station].name; }

  get stationTrack() { return this.stations[this.station].track; }

  /** Switch to the next radio station; returns its name. */
  cycleStation() {
    this.station = (this.station + 1) % this.stations.length;
    this.musicStep = 0;
    if (this.ctx) {
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.startMusic();
    }
    return this.stationName;
  }

  /** Radio plays in the car; the chill pad plays on foot. */
  setRadio(on) {
    this.radioOn = on;
  }

  /** Create the context on the first user gesture (or the first shot frame). */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.startEngine();
      this.startMusic();
      this.startRain();
    } catch (err) {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  /** Engine pitch and loudness follow the driven car's speed (0..1).
   * v5: a motorbike revs higher and buzzier than a car — the pitch base
   * and filter open up further when `isBike` is true. */
  engine(speed01, driving, isBike) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const base = isBike ? 88 : 52;
    const span = isBike ? 190 : 130;
    this.engineOsc.frequency.setTargetAtTime(base + speed01 * span, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime((isBike ? 500 : 280) + speed01 * 900, t, 0.08);
    this.engineGain.gain.setTargetAtTime(driving ? 0.05 + speed01 * 0.06 : 0, t, 0.1);
  }

  /** Two-tone police wail; call with false to stop it. kind 'medic' is the
   *  higher, faster wail of the ambulance. */
  siren(on, kind) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      const ctx = this.ctx;
      const medic = kind === 'medic';
      this.sirenOsc = ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = medic ? 880 : 720;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = medic ? 0.9 : 0.55;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = medic ? 220 : 160;
      lfo.connect(lfoGain);
      lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = ctx.createGain();
      this.sirenGain.gain.value = 0.035;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      lfo.start();
      this.sirenOsc._lfo = lfo;
    } else if (!on && this.sirenOsc) {
      try { this.sirenOsc._lfo.stop(); this.sirenOsc.stop(); } catch (err) {}
      this.sirenOsc = null;
      this.sirenGain = null;
    }
  }

  /** Rain: a looped noise buffer through a highpass, level follows weather. */
  startRain() {
    try {
      const ctx = this.ctx;
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1200;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(filter);
      filter.connect(this.rainGain);
      this.rainGain.connect(this.master);
      src.start();
      this.rainSrc = src;
    } catch (err) {
      this.rainGain = null;
    }
  }

  /** Rain loudness 0..1, called every frame from the weather state. */
  rain(level) {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(level * 0.09, this.ctx.currentTime, 0.4);
  }

  /** A thunder clap: low noise that swells and rolls off. */
  thunder() {
    this.noiseBurst(1.4, 120, 0.5, 'lowpass', 160);
  }

  /** A short noise burst through a bandpass: the gunshot. */
  shot() {
    this.noiseBurst(0.14, 900, 0.5, 'highpass', 1200);
  }

  /** A low thud for a punch landing. */
  punch() {
    this.noiseBurst(0.09, 240, 0.55, 'lowpass', 300);
  }

  /** A two-note chime for a pickup or a stash. */
  chime() {
    this.blip(880, 0.09, 0.22);
    setTimeout(() => this.blip(1318, 0.14, 0.22), 80);
  }

  /** A cash-register ding when a taxi fare pays out. */
  fareDing() {
    this.blip(1046, 0.08, 0.25);
    setTimeout(() => this.blip(1568, 0.18, 0.25), 90);
  }

  /** A little rising arpeggio when a mission is completed. */
  jingle() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this.blip(f, 0.16, 0.25), i * 110);
    });
  }

  /** A dull knock for a car bumping into something. */
  thud() {
    this.noiseBurst(0.12, 160, 0.4, 'lowpass', 220);
  }

  /** A metallic scrape for a car taking damage. */
  scrape() {
    this.noiseBurst(0.25, 500, 0.35, 'bandpass', 900);
  }

  /** A tyre skid: high noise that falls away — handbrake slides, rams. */
  skid() {
    this.noiseBurst(0.35, 700, 0.3, 'bandpass', 1400);
  }

  /** A short two-tone dispatch blip when a police unit changes tactic. */
  dispatch() {
    this.blip(660, 0.07, 0.16);
    setTimeout(() => this.blip(520, 0.09, 0.16), 90);
  }

  /** v5: the shotgun's pump — a mechanical clack after the blast. */
  pump() {
    this.noiseBurst(0.07, 1200, 0.3, 'bandpass', 1800);
    setTimeout(() => this.noiseBurst(0.06, 900, 0.25, 'bandpass', 1400), 70);
  }

  /** v5: a cash-register ka-ching when the safehouse garage is bought. */
  purchase() {
    this.blip(1046, 0.1, 0.25);
    setTimeout(() => this.blip(1318, 0.12, 0.25), 90);
    setTimeout(() => this.blip(1568, 0.2, 0.25), 190);
  }

  // --- v6: roll, drift, bank, helicopter, splash, alarm -------------------

  /** A dodge roll: a short filtered whoosh, low to high. */
  roll() {
    this.noiseBurst(0.22, 500, 0.3, 'bandpass', 900);
  }

  /** A drift squeal: a thin high noise burst that follows a slide. The
   * game calls it once per slide start, not per frame. */
  driftSqueal() {
    this.noiseBurst(0.5, 1100, 0.22, 'bandpass', 1900);
  }

  /** Coins clinking when drift points bank into cash. */
  bank() {
    this.blip(1318, 0.07, 0.2);
    setTimeout(() => this.blip(1568, 0.07, 0.2), 60);
    setTimeout(() => this.blip(2093, 0.12, 0.2), 120);
  }

  /** The police helicopter's rotor: a low pulsing loop while the heli is
   * overhead at night. Call with false to stop it. */
  heli(on) {
    if (!this.ctx) return;
    if (on && !this.heliOsc) {
      const ctx = this.ctx;
      this.heliOsc = ctx.createOscillator();
      this.heliOsc.type = 'sawtooth';
      this.heliOsc.frequency.value = 42;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 18;
      lfo.connect(lfoGain);
      lfoGain.connect(this.heliOsc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      this.heliGain = ctx.createGain();
      this.heliGain.gain.value = 0.045;
      this.heliOsc.connect(filter);
      filter.connect(this.heliGain);
      this.heliGain.connect(this.master);
      this.heliOsc.start();
      lfo.start();
      this.heliOsc._lfo = lfo;
    } else if (!on && this.heliOsc) {
      try { this.heliOsc._lfo.stop(); this.heliOsc.stop(); } catch (err) {}
      this.heliOsc = null;
      this.heliGain = null;
    }
  }

  /** A water splash at the ferry point or the beach — a short noise burst
   * through a lowpass, like a wave hitting the pier. */
  splash() {
    this.noiseBurst(0.4, 300, 0.35, 'lowpass', 500);
  }

  /** A car alarm: three fast two-tone chirps when a stolen car is reported
   * and the owner comes running. */
  alarm() {
    [0, 160, 320].forEach((delay) => {
      setTimeout(() => this.blip(880, 0.09, 0.18), delay);
      setTimeout(() => this.blip(660, 0.09, 0.18), delay + 80);
    });
  }

  /** A spike-strip clatter: a burst of short metallic clicks when tyres
   * shred on a strip. */
  stripClatter() {
    [0, 50, 110, 170].forEach((delay) => {
      setTimeout(() => this.noiseBurst(0.04, 2000, 0.25, 'bandpass', 2600), delay);
    });
  }

  blip(freq, duration, volume) {
    if (!this.ctx) return;
    try {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
    } catch (err) {}
  }

  noiseBurst(duration, freq, volume, type, filterFreq) {
    if (!this.ctx) return;
    try {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start();
    } catch (err) {}
  }

  /** The radio: the current station's chords, one bar at a time, forever.
   * Station 0 is a slow sunset pad; station 1 is a faster synthwave loop
   * with a pulsing bass note under each chord; station 2 is a mellow
   * triangle-wave oldies set, also with a bass under each chord; station 3
   * is surf guitar, station 4 (v5) is bright jet-age triangle chords for
   * the airport run. */
  startMusic() {
    const station = this.stations[this.station];
    const chords = station.chords;
    const playChord = () => {
      if (!this.ctx) return;
      const chord = chords[this.musicStep % chords.length];
      this.musicStep += 1;
      const t = this.ctx.currentTime;
      chord.forEach((freq) => {
        try {
          const osc = this.ctx.createOscillator();
          osc.type = station.wave;
          osc.frequency.value = freq;
          osc.detune.value = 4;
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = station.bass ? 1400 : 700;
          const gain = this.ctx.createGain();
          const bar = station.barMs / 1000;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.03, t + 0.5);
          gain.gain.setValueAtTime(0.03, t + bar * 0.7);
          gain.gain.linearRampToValueAtTime(0.0001, t + bar * 0.95);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(this.master);
          osc.start(t);
          osc.stop(t + bar);
        } catch (err) {}
      });
      if (station.bass) {
        // A pulsing bass note on the chord root, twice a bar.
        try {
          const osc = this.ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = chord[0] / 2;
          const gain = this.ctx.createGain();
          const bar = station.barMs / 1000;
          gain.gain.setValueAtTime(0.06, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + bar * 0.45);
          osc.connect(gain);
          gain.connect(this.master);
          osc.start(t);
          osc.stop(t + bar * 0.5);
        } catch (err) {}
      }
    };
    playChord();
    this.musicTimer = setInterval(playChord, station.barMs);
  }
}
