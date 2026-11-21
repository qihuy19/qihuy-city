// The extra game modes, v7: two careers Riko can start from the title
// screen instead of the story — a Vigilante shift and a Taxi Career
// shift. Both run on their own clock, with their own objectives and
// scoring, and both end with a summary and a best score that persists
// in the save. Neither touches the story: starting a mode sets the
// story aside (missions done, free roam), and finishing one drops Riko
// back into free roam with his earnings.
//
// VIGILANTE: QCPD deputises Riko for one shift — five minutes, six
// suspects. Suspect cars are flagged on the street with a red marker
// overhead and a beacon on the minimap; they flee down the roads when
// he gets close. Ram one hard enough and it stops: busted, +$150 and
// +100 points, and the next suspect rolls out. The shift ends on the
// timer, and the score is suspects busted, cash earned and the best
// shift on record.
//
// TAXI CAREER: a four-minute shift of endless fares, built on the
// story taxi mission's own fare table. Pick a fare up, run the meter,
// drop them off smooth for the tip — a crash costs the tip, a wanted
// star costs the fare. The score is the shift's takings, and the
// reputation stars grow one per five fares, shift after shift.
import * as THREE from 'three';
import { CAR_NAMES, CITY, PLACES, TAXI_FARES, TUNE } from './config.js';
import { dist2, clock } from './util.js';
import { Car, makeCarMesh } from './vehicles.js';

/** The two modes: their shift length, their scoring, and their title
 * screen copy. The shift lengths are in TUNE so a retune lands in one
 * place. */
export const MODE_DEFS = {
  vigilante: {
    id: 'vigilante',
    title: '🚨 VIGILANTE SHIFT',
    blurb: 'Deputised for one shift: six suspects, five minutes, no backup. Ram them off the road.',
    suspects: 6,
  },
  taxi: {
    id: 'taxi',
    title: '🚕 TAXI CAREER',
    blurb: 'Four minutes of endless fares: pick them up, run the meter, drop them smooth for the tip.',
    fares: Infinity,
  },
};

/** A suspect car, as the mode sees it: the traffic car itself, a red
 * marker floating over its roof, and whether it has been busted yet.
 * Suspects are ordinary traffic cars with a flag — the traffic system
 * still drives them down the roads, and the mode only steers their
 * cruise speed and watches for the bust. */
export function makeSuspectMarker() {
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshBasicMaterial({ color: 0xff4040 }),
  );
  return marker;
}

export class GameModes {
  constructor(game) {
    this.game = game;
    // The active mode: null, or { id, ... } while a shift is running.
    this.active = null;
    // Best scores, per mode, across runs — the save file keeps them.
    this.best = { vigilante: 0, taxi: 0 };
    // Vigilante state.
    this.suspects = [];
    this.suspectsBusted = 0;
    this.suspectTimer = 0;
    // Taxi career state.
    this.fare = null;
    this.fareIndex = 0;
    this.fareAboard = false;
    this.meter = 0;
    this.fareCrashes = 0;
    this.faresDone = 0;
    this.takings = 0;
    // The mode's own clock and score, read by the HUD.
    this.timeLeft = 0;
    this.score = 0;
  }

  /** Is a mode running right now? The HUD and the E-key handler ask
   * this before the mission layer does. */
  get running() {
    return !!this.active;
  }

  /** The mode's title, for the mission panel while a shift runs. */
  get title() {
    if (!this.active) return null;
    return MODE_DEFS[this.active.id].title;
  }

  /** The mode's objective line, for the mission panel. */
  get objective() {
    if (!this.active) return null;
    if (this.active.id === 'vigilante') {
      const remaining = MODE_DEFS.vigilante.suspects - this.suspectsBusted;
      if (this.suspects.length === 0) return 'Vigilante: a suspect is rolling out — wait for the marker…';
      return `Vigilante: bust the marked suspect — ${remaining} left · ${this.score} pts · ${clock(this.timeLeft)} left`;
    }
    if (this.fareAboard && this.fare) {
      return `Taxi: fare aboard — meter ${'$' + Math.floor(this.meter)}. Drop them at ${PLACES[this.fare.to].label} · ${clock(this.timeLeft)} left`;
    }
    if (this.fare) {
      return `Taxi: pick up the fare at ${PLACES[this.fare.from].label} (press E) · ${this.faresDone} fares · ${clock(this.timeLeft)} left`;
    }
    return `Taxi Career: ${this.faresDone} fares · ${'$' + Math.floor(this.takings)} taken · ${clock(this.timeLeft)} left`;
  }

  /** The world position the compass and minimap should point at: the
   * live suspect, or the fare's pickup / dropoff. */
  get target() {
    if (!this.active) return null;
    if (this.active.id === 'vigilante') {
      const live = this.suspects.find((s) => !s.busted);
      return live ? { x: live.car.x, z: live.car.z } : null;
    }
    if (!this.fare) return null;
    return this.fareAboard ? PLACES[this.fare.to] : PLACES[this.fare.from];
  }

  // ----- starting and finishing ----------------------------------------------
  /** Start a shift: clear the other mode's state, set the clock, and
   * open with the first objective. The game has already reset the
   * world and set the story aside before calling this. */
  start(id) {
    const def = MODE_DEFS[id];
    if (!def) return false;
    this.active = { id, startedAt: this.game.time };
    this.timeLeft = id === 'vigilante' ? TUNE.vigilanteShiftSeconds : TUNE.taxiShiftSeconds;
    this.score = 0;
    if (id === 'vigilante') {
      this.suspects = [];
      this.suspectsBusted = 0;
      this.suspectTimer = 0;
      this.spawnSuspect();
      this.game.missions.say('🚨 Vigilante shift: QCPD deputised you. Bust the red-marked suspect — ram them off the road. Five minutes.', 7);
    } else {
      this.fare = null;
      this.fareIndex = 0;
      this.fareAboard = false;
      this.meter = 0;
      this.fareCrashes = 0;
      this.faresDone = 0;
      this.takings = 0;
      this.nextFare();
      this.game.missions.say('🚕 Taxi career shift: four minutes of fares. Pick them up, run the meter, drop them smooth.', 7);
    }
    return true;
  }

  /** End a shift: pay out what is owed, record the best score, clear
   * the mode's cars and markers, and drop Riko back into free roam
   * with a summary. The story stays done — the mode never reopens it. */
  finish(reason) {
    if (!this.active) return;
    const game = this.game;
    const id = this.active.id;
    let summary = '';
    if (id === 'vigilante') {
      const busted = this.suspectsBusted;
      const total = MODE_DEFS.vigilante.suspects;
      this.best.vigilante = Math.max(this.best.vigilante, this.score);
      summary = `🚨 Shift over (${reason}): ${busted}/${total} suspects busted, ${this.score} pts. Best shift: ${this.best.vigilante} pts.`;
      this.clearSuspects();
    } else {
      this.best.taxi = Math.max(this.best.taxi, Math.floor(this.takings));
      summary = `🚕 Shift over (${reason}): ${this.faresDone} fares, $${Math.floor(this.takings)} taken. Best shift: $${this.best.taxi}.`;
      if (this.fare) game.missions.hideBeacon();
      this.fare = null;
      this.fareAboard = false;
    }
    game.missions.say(summary, 8);
    game.audio.jingle();
    this.active = null;
    this.timeLeft = 0;
  }

  // ----- vigilante ------------------------------------------------------------
  /** Roll a suspect out: a traffic car spawned a block or two ahead of
   * Riko, flagged, with a red marker over its roof and a cruise speed
   * that says it is running. One suspect at a time — the shift is a
   * hunt, not a traffic jam. */
  spawnSuspect() {
    const game = this.game;
    const traffic = game.traffic;
    const { pitch, halfGrid, bound } = CITY;
    const player = game.player;
    // A road near the player, a spot along it ahead of him, a direction
    // away — the same placement the traffic director uses, anchored to
    // the hunt instead of the clock.
    const axis = traffic.rng.chance(0.5) ? 'x' : 'z';
    const road = Math.round((axis === 'x' ? player.z : player.x) / pitch) * pitch;
    const clampedRoad = Math.max(-halfGrid * pitch, Math.min(halfGrid * pitch, road));
    const dir = traffic.rng.chance(0.5) ? 1 : -1;
    const along = (axis === 'x' ? player.x : player.z) + dir * 55;
    const car = new Car(makeCarMesh(0x8a2a2a, 'sedan'), traffic.rng.pick(CAR_NAMES), 'traffic');
    car.bodyKind = 'sedan';
    car.suspect = true;
    car.axis = axis;
    car.dir = dir;
    car.lane = 3.5;
    car.cruiseSpeed = 16;
    if (axis === 'x') {
      car.x = Math.max(-bound, Math.min(bound, along));
      car.z = clampedRoad + dir * car.lane;
      car.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.z = Math.max(-bound, Math.min(bound, along));
      car.x = clampedRoad + dir * car.lane;
      car.yaw = dir > 0 ? 0 : Math.PI;
    }
    car.speed = car.cruiseSpeed;
    traffic.cars.push(car);
    game.scene.add(car.mesh);
    car.syncMesh();
    const marker = makeSuspectMarker();
    marker.position.set(car.x, 3.2, car.z);
    game.scene.add(marker);
    this.suspects.push({ car, marker, busted: false });
    game.missions.say('🚨 Suspect on the road — follow the red marker and ram them off it.', 5);
    game.audio.dispatch();
    return car;
  }

  /** Remove every suspect car and marker — the shift is over, and the
   * street goes back to ordinary traffic. */
  clearSuspects() {
    const game = this.game;
    for (const suspect of this.suspects) {
      if (suspect.marker) game.scene.remove(suspect.marker);
      if (suspect.car && !suspect.busted) {
        // An unbusted suspect just becomes ordinary traffic again.
        suspect.car.suspect = false;
      }
    }
    this.suspects = [];
  }

  /** A hard crash while a fare is aboard costs the taxi tip — the
   * same rule as the story taxi mission, in the career shift. */
  onCrash() {
    if (!this.active || this.active.id !== 'taxi') return;
    if (this.fareAboard) {
      this.fareCrashes += 1;
      this.game.missions.say('That crash cost you the tip — drive smooth!', 3);
    }
  }

  // ----- taxi career ----------------------------------------------------------
  /** The next fare: the next entry in the fare table, with the meter
   * starting at its base. The beacon points at the pickup. */
  nextFare() {
    const game = this.game;
    this.fare = TAXI_FARES[this.fareIndex % TAXI_FARES.length];
    this.fareIndex += 1;
    this.fareAboard = false;
    this.meter = this.fare.base;
    this.fareCrashes = 0;
    game.missions.setBeacon(PLACES[this.fare.from].x, PLACES[this.fare.from].z);
    game.missions.say(`Fare ${this.faresDone + 1}: pick them up at ${PLACES[this.fare.from].label}.`, 4);
  }

  /** The E key during a mode: taxi fare pickup. The vigilante shift
   * needs no E — ramming is the whole interaction. Returns true when
   * the keypress was spent. */
  tryInteract(game) {
    if (!this.active || this.active.id !== 'taxi') return false;
    if (!this.fare || this.fareAboard) return false;
    const dest = PLACES[this.fare.from];
    if (dist2(game.player.x, game.player.z, dest.x, dest.z) >= 36) return false;
    this.fareAboard = true;
    game.missions.setBeacon(PLACES[this.fare.to].x, PLACES[this.fare.to].z);
    game.audio.chime();
    game.missions.say(`Fare aboard — meter running from $${this.fare.base}. Smooth ride earns a tip.`, 4);
    return true;
  }

  // ----- the frame --------------------------------------------------------------
  /** The mode's tick: the clock, the suspect hunt, the fare meter, and
   * the shift end. Called every frame while the game is in play. */
  update(dt, game) {
    if (!this.active) return;
    this.timeLeft -= dt;
    // The HUD's mission timer reads missions.timer, so the mode keeps
    // it pointed at the shift clock — the timer never ticks on its own
    // while no story mission is active.
    game.missions.timer = Math.max(0, this.timeLeft);
    if (this.timeLeft <= 0) {
      this.finish('time');
      return;
    }
    if (this.active.id === 'vigilante') this.updateVigilante(dt, game);
    else this.updateTaxi(dt, game);
  }

  /** The vigilante hunt: keep one live suspect on the road, make it
   * flee, and watch for the bust — Riko's car hard into the suspect's
   * side at speed. A busted suspect stops dead, pays out, and the next
   * one rolls out after a beat. */
  updateVigilante(dt, game) {
    const player = game.player;
    // Keep one live suspect: if none is on the road, roll the next one
    // out after a short beat (or end the shift early when all six are done).
    if (!this.suspects.some((s) => !s.busted)) {
      if (this.suspectsBusted >= MODE_DEFS.vigilante.suspects) {
        this.finish('all suspects busted');
        return;
      }
      this.suspectTimer -= dt;
      if (this.suspectTimer <= 0) {
        this.suspectTimer = 2;
        this.spawnSuspect();
      }
      return;
    }
    const suspect = this.suspects.find((s) => !s.busted);
    if (!suspect) return;
    const car = suspect.car;
    // The marker rides over the suspect's roof, bobbing so it reads at
    // a glance even in traffic.
    if (suspect.marker) {
      suspect.marker.position.set(car.x, 3.2 + Math.sin(game.time * 4) * 0.25, car.z);
      suspect.marker.rotation.y += dt * 3;
    }
    // Flee: the suspect runs from Riko — a fast cruise speed, and a
    // turn onto the crossing road when Riko closes in behind it.
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    car.cruiseSpeed = d < 40 ? 20 : 13;
    // The bust: Riko's car into the suspect at speed, close in. The
    // suspect stops dead, the marker comes down, and the bounty pays.
    if (!player.onFoot && player.car && d < 5.5 && Math.abs(player.car.speed) > 8) {
      suspect.busted = true;
      car.parked = true;
      car.speed = 0;
      car.suspect = false;
      if (suspect.marker) game.scene.remove(suspect.marker);
      this.suspectsBusted += 1;
      this.score += 100;
      game.economy.earn('vigilante', TUNE.vigilanteBustReward, 'Vigilante bounty');
      game.audio.jingle();
      game.fx.burst(car.x, 1.5, car.z, 0xff4040, 14, 4);
      game.fx.confetti(car.x, 2, car.z);
      game.missions.say(`🚨 Suspect busted! +$${TUNE.vigilanteBustReward} bounty, +100 pts (${this.suspectsBusted}/${MODE_DEFS.vigilante.suspects}).`, 5);
    }
  }

  /** The taxi shift: the meter ticks per metre with a fare aboard, and
   * the dropoff pays the meter plus a smooth-driving tip — or nothing
   * extra when the ride was rough or the law was watching. */
  updateTaxi(dt, game) {
    const player = game.player;
    if (!this.fare) return;
    if (this.fareAboard) {
      // The meter ticks per metre driven with the fare aboard.
      if (!player.onFoot && player.car) {
        const moved = Math.hypot(player.x - (this._lx || player.x), player.z - (this._lz || player.z));
        this.meter += moved * TUNE.taxiMeterPerMetre;
      }
      const dest = PLACES[this.fare.to];
      if (dist2(player.x, player.z, dest.x, dest.z) < 100) {
        const tip = this.fareCrashes === 0 && game.wanted === 0 ? TUNE.taxiTipSmooth : 0;
        const paid = Math.floor(this.meter) + tip;
        game.economy.earn('taxi', paid, `Taxi fare ${this.faresDone + 1}`);
        this.takings += paid;
        this.score = Math.floor(this.takings);
        this.faresDone += 1;
        game.stats.fares = (game.stats.fares || 0) + 1;
        game.stats.faresCompleted = (game.stats.faresCompleted || 0) + 1;
        game.stats.tipsEarned = (game.stats.tipsEarned || 0) + tip;
        game.audio.fareDing();
        game.missions.say(`Fare dropped — +$${paid}${tip > 0 ? ` (incl. $${tip} smooth tip)` : ''} (${this.faresDone} fares, $${Math.floor(this.takings)} taken).`, 4);
        this.nextFare();
      }
    }
    this._lx = player.x;
    this._lz = player.z;
  }

  // ----- save / load ------------------------------------------------------------
  serialize() {
    return {
      best: { ...this.best },
    };
  }

  restore(data) {
    if (!data) return;
    if (data.best) {
      this.best = {
        vigilante: data.best.vigilante || 0,
        taxi: data.best.taxi || 0,
      };
    }
  }

  reset() {
    this.clearSuspects();
    this.active = null;
    this.fare = null;
    this.fareAboard = false;
    this.meter = 0;
    this.fareCrashes = 0;
    this.faresDone = 0;
    this.takings = 0;
    this.timeLeft = 0;
    this.score = 0;
    this.suspectsBusted = 0;
    this.suspectTimer = 0;
  }
}
