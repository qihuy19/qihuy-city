// Missions and the story, v6: twenty jobs for Mara the fixer, run in
// order, each with stages, a 3D beacon in the world and a blip on the
// minimap, plus twenty-four cash stashes to collect while free-roaming.
// The mission object is the one the HUD reads for its objective line and
// the minimap reads for its marker.
//
// v5: seventeen jobs — an airport heist (mission 15, which arms Riko with
// a shotgun and parks a getaway bike by the terminal), a casino-strip job
// for Dara's chips (16), and a five-star finale on the runway (17) — and
// twenty cash stashes, four of them at the airport and on the strip.
//
// v6 rewrites the mission layer into a SCRIPTING ENGINE: every mission is
// now a script of steps — { type, ... } — run in order by a small
// interpreter, instead of a tangle of stage-number branches. The steps a
// mission can use: `reach` (go to a place), `steal` (get in any car),
// `takeVehicle` (get in the job vehicle), `pickup` (press E at a place —
// optionally starting a timer, wanted stars and a gang ambush), `deliver`
// (reach the dropoff), `secondPickup` (a second grab before the dropoff),
// `fare` (the taxi loop), `patient` (the ambulance loop) and `wait`
// (hold a spot for N seconds while the crew works). The engine owns the
// CHECKPOINTS: every completed step records a checkpoint, and a fail
// (timer out, patient lost, busted) rewinds to the last checkpoint instead
// of the mission start — so a late delivery costs a retry of the drive,
// not the whole job. BRANCHING: a mission may name a `branch` — a choice
// the player makes by driving to one of two markers (e.g. the garage or
// the hideout) — and the engine follows the branch he picks. And SIDE
// JOBS: three repeatable jobs (courier, wheelman, lookout) that pay cash
// in free roam, so the city keeps paying after the story ends.
//
// Every mission is still data-driven (see MISSIONS in config.js): a mission
// may need a stolen car first (needCar), a pickup spot (press E to grab it,
// optionally starting a timer, wanted stars and a gang ambush), and a
// dropoff spot that completes it. Three jobs are vehicle jobs instead — a
// taxi shift, an ambulance run and a timed port delivery — each needing its
// own special vehicle first, which the game spawns at the job's start.
// Mission 12 is a two-stop job: a second pickup after the first, before
// the dropoff.
//
// v4 adds the visual-novel briefing: before a story mission starts, Mara
// (or the rival fixer Dara, in mission 13) talks Riko through the job in
// a dialogue overlay with a portrait and a nameplate. The briefing is
// data (BRIEFINGS in config.js); the manager owns the line cursor, and
// the HUD renders whatever line is current.
import * as THREE from 'three';
import { MISSIONS, PLACES, STASH_SPOTS, TAXI_FARES, TUNE, BRIEFINGS } from './config.js';
import { dist2 } from './util.js';

function makeBeacon(color) {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  column.position.y = 30;
  group.add(column);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.22, 8, 32),
    new THREE.MeshBasicMaterial({ color }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);
  group.userData.ring = ring;
  return group;
}

function makeStash() {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.6, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x2a7a3a }),
  );
  box.position.y = 0.3;
  group.add(box);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.12, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x51ff7a }),
  );
  glow.position.y = 0.64;
  group.add(glow);
  group.userData.glow = glow;
  return group;
}

/** Which special vehicle a job needs, and where it waits. */
export const JOB_VEHICLES = {
  taxi: { kind: 'taxi', place: 'taxiStand', label: 'Cendana Taxi' },
  ambulance: { kind: 'ambulance', place: 'port', label: 'Aruna Ambulance' },
  delivery: { kind: 'truck', place: 'port', label: 'Samudra Truck' },
};

/** The side jobs (v6): repeatable free-roam work that pays cash. Each is
 * a small script of its own — a courier run (pick up, deliver, timed), a
 * wheelman run (steal a named car, deliver it, heat on the steal) and a
 * lookout (hold a spot for N seconds while Mara's crew works). */
export const SIDE_JOBS = [
  {
    id: 'courier', title: 'Courier Run', reward: 120,
    brief: 'Mara has a parcel at the docks for the club. 2:00, no questions.',
    pickup: 'docks', dropoff: 'club', timeLimit: 120, starsOnPickup: 1,
  },
  {
    id: 'wheelman', title: 'Wheelman', reward: 200,
    brief: 'A Seroja Coupe is parked by the hotel. Lift it, bring it to the garage — two stars on the steal.',
    needCar: true, beachCar: true, dropoff: 'garage', starsOnSteal: 2,
  },
  {
    id: 'lookout', title: 'Lookout', reward: 150,
    brief: 'Mara\'s crew is working the warehouse. Hold the corner for 45 seconds and keep the cops off them.',
    hold: 'warehouse', holdSeconds: 45,
  },
];

/** Build a mission's script from its data: a list of steps the engine
 * runs in order. The script is the mission's plan in plain data, so a new
 * mission is a new data entry, not a new branch in the update loop. */
export function buildScript(mission) {
  const steps = [];
  if (mission.needCar) {
    steps.push({ type: 'steal', beachCar: !!mission.beachCar });
  }
  if (mission.kind) {
    steps.push({ type: 'takeVehicle', kind: mission.kind });
    if (mission.kind === 'taxi') steps.push({ type: 'fares', count: mission.fares || 3 });
    else if (mission.kind === 'ambulance') steps.push({ type: 'patient' });
    else if (mission.kind === 'delivery') steps.push({ type: 'pickup', place: mission.pickup });
  } else if (mission.pickup) {
    steps.push({ type: 'reach', place: mission.pickup });
    steps.push({ type: 'pickup', place: mission.pickup });
  }
  if (mission.secondPickup) {
    steps.push({ type: 'secondPickup', place: mission.secondPickup });
  }
  steps.push({ type: 'deliver', place: mission.dropoff });
  return steps;
}

export class MissionManager {
  constructor(scene) {
    this.scene = scene;
    this.index = 0; // which mission of MISSIONS is active; -1 means story done
    this.stage = 0;
    this.timer = 0;
    this.done = false;
    this.beacon = null;
    this.beaconTarget = null;
    this.stashes = [];
    this.stashesCollected = 0;
    this.message = '';
    this.messageTimer = 0;
    this.packageTaken = false;
    // Taxi shift state.
    this.fareIndex = 0;
    this.fare = null;
    this.meter = 0;
    this.fareCrashes = 0;
    this.faresDone = 0;
    // Ambulance state.
    this.patientHealth = TUNE.ambulancePatientHealth;
    this.lastX = 0;
    this.lastZ = 0;
    // Two-stop jobs (mission 12): the second pickup after the first.
    this.secondPickupDone = false;
    // Visual-novel briefing state: { data, line } while one is open, else null.
    this.briefing = null;
    this.briefingsSeen = [];
    // v6 scripting engine: the current mission's step list, the step the
    // engine is on, and the checkpoint stack — one entry per completed
    // step, so a fail rewinds to the last checkpoint, not the start.
    this.script = [];
    this.scriptStep = 0;
    this.checkpoints = [];
    this.holdTimer = 0;
    this.holdPlace = null;
    // v6 mission log: one line per completed mission, for the stats screen.
    this.log = [];
    // v6 side jobs: the active side job (or null), its step and its timer.
    this.sideJob = null;
    this.sideJobStep = 0;
    this.sideJobTimer = 0;
    this.sideJobsDone = 0;
  }

  get current() {
    return this.index >= 0 && this.index < MISSIONS.length ? MISSIONS[this.index] : null;
  }

  get objective() {
    const m = this.current;
    if (!m) {
      if (this.sideJob) return this.sideJobObjective();
      return 'Free roam — collect the green cash stashes around Qihuy City.';
    }
    if (m.secondPickup && !this.secondPickupDone && this.stage === 2) {
      return `Grab the second ledger at ${PLACES[m.secondPickup].label} (press E)`;
    }
    if (m.kind === 'taxi' && this.fare) {
      if (this.stage === 1) return `Pick up the fare at ${PLACES[this.fare.from].label} (press E)`;
      if (this.stage === 2) return `Fare aboard — meter $${Math.floor(this.meter)}. Drop them at ${PLACES[this.fare.to].label}`;
    }
    if (m.kind === 'ambulance' && this.stage === 2) {
      return `Patient aboard (${Math.ceil(this.patientHealth)} HP) — race to ${PLACES.hospital.label}`;
    }
    // v6: the script step's own wording, when the engine has one.
    const step = this.script[this.scriptStep];
    if (step && step.type === 'hold') {
      return `Hold ${PLACES[this.holdPlace]?.label || 'the corner'} — ${Math.ceil(this.holdTimer)}s left`;
    }
    return m.stages[Math.min(this.stage, m.stages.length - 1)];
  }

  /** The side job's objective line, while one is active. */
  sideJobObjective() {
    const job = this.sideJob;
    if (!job) return 'Free roam — collect the green cash stashes around Qihuy City.';
    if (job.id === 'courier') {
      return this.sideJobStep === 0
        ? `Courier: pick up the parcel at ${PLACES[job.pickup].label} (press E)`
        : `Courier: deliver to ${PLACES[job.dropoff].label} — ${Math.ceil(this.sideJobTimer)}s left`;
    }
    if (job.id === 'wheelman') {
      return this.sideJobStep === 0
        ? 'Wheelman: steal the Seroja Coupe by the hotel (press E)'
        : `Wheelman: bring it to ${PLACES[job.dropoff].label}`;
    }
    return `Lookout: hold ${PLACES[job.hold].label} — ${Math.ceil(this.sideJobTimer)}s left`;
  }

  /** The job vehicle this mission needs, or null for ordinary jobs. */
  jobSpec() {
    const m = this.current;
    if (!m || !m.kind) return null;
    return JOB_VEHICLES[m.kind] || null;
  }

  /** The world position the beacon and minimap should point at right now. */
  get target() {
    const m = this.current;
    if (!m) {
      if (this.sideJob) return this.sideJobTarget();
      return null;
    }
    if (m.kind === 'taxi') {
      if (this.stage === 0) return PLACES.taxiStand;
      if (this.stage === 1 && this.fare) return PLACES[this.fare.from];
      if (this.stage === 2 && this.fare) return PLACES[this.fare.to];
      return PLACES.taxiStand;
    }
    if (m.kind === 'ambulance') {
      if (this.stage === 0) return PLACES.port;
      if (this.stage === 1) return PLACES.docks;
      return PLACES.hospital;
    }
    if (m.kind === 'delivery') {
      if (this.stage === 0 || this.stage === 1) return PLACES.port;
      return PLACES.warehouse2;
    }
    if (this.stage === 0) {
      if (m.needCar) return m.beachCar ? PLACES.beachCar : null; // steal any car first
      return m.pickup ? PLACES[m.pickup] : PLACES[m.dropoff];
    }
    if (this.stage === 1) {
      return m.pickup ? PLACES[m.pickup] : PLACES[m.dropoff];
    }
    // Stage 2 with a second pickup still to grab: point at it, not the dropoff.
    if (m.secondPickup && !this.secondPickupDone) return PLACES[m.secondPickup];
    return PLACES[m.dropoff];
  }

  /** The side job's beacon target. */
  sideJobTarget() {
    const job = this.sideJob;
    if (!job) return null;
    if (job.id === 'courier') return this.sideJobStep === 0 ? PLACES[job.pickup] : PLACES[job.dropoff];
    if (job.id === 'wheelman') return this.sideJobStep === 0 ? PLACES.beachCar : PLACES[job.dropoff];
    return PLACES[job.hold];
  }

  /** Open the visual-novel briefing for a mission, if it has one and
   * Riko has not seen it yet this run. Returns true when one opened. */
  beginBriefing(mission) {
    const data = mission && BRIEFINGS[mission.id];
    if (!data || this.briefingsSeen.includes(mission.id)) return false;
    this.briefing = { data, line: 0, missionId: mission.id };
    return true;
  }

  /** Advance the briefing one line; when the lines run out, close it and
   * remember it so a restart does not replay the same scene. */
  advanceBriefing() {
    if (!this.briefing) return false;
    this.briefing.line += 1;
    if (this.briefing.line >= this.briefing.data.lines.length) {
      if (!this.briefingsSeen.includes(this.briefing.missionId)) {
        this.briefingsSeen.push(this.briefing.missionId);
      }
      this.briefing = null;
      return false;
    }
    return true;
  }

  /** The briefing overlay is showing while this returns a line of text. */
  get briefingLine() {
    if (!this.briefing) return null;
    return this.briefing.data.lines[this.briefing.line];
  }

  say(text, seconds) {
    this.message = text;
    this.messageTimer = seconds || 4;
  }

  /** Load a mission's script and reset the checkpoint stack. */
  loadScript(mission) {
    this.script = buildScript(mission);
    this.scriptStep = 0;
    this.checkpoints = [];
  }

  /** Debug helper (play-test harness only — the game itself never calls
   * it): jump straight to a mission by index, loading its script and
   * resetting per-mission state, the same setup `completeMission`
   * performs when advancing. Poking `index` directly leaves the previous
   * mission's script behind, so a reach step would map to the wrong
   * stage; this is the only supported way to teleport between missions. */
  debugJump(index) {
    const m = MISSIONS[index];
    if (!m) return false;
    this.index = index;
    this.done = false;
    this.stage = 0;
    this.timer = m.timeLimit || 0;
    this.packageTaken = false;
    this.secondPickupDone = false;
    this.fare = null;
    this.meter = 0;
    this.faresDone = 0;
    this.fareIndex = 0;
    this.patientHealth = TUNE.ambulancePatientHealth;
    this.briefing = null;
    this.loadScript(m);
    return true;
  }

  /** Record a checkpoint: the current stage, position and timer state, so
   * a fail can rewind here instead of to the mission start. */
  recordCheckpoint(game) {
    this.checkpoints.push({
      stage: this.stage,
      scriptStep: this.scriptStep,
      x: game.player.x,
      z: game.player.z,
      timer: this.timer,
      packageTaken: this.packageTaken,
      secondPickupDone: this.secondPickupDone,
    });
    if (this.checkpoints.length > 8) this.checkpoints.shift();
  }

  /** Rewind to the last checkpoint after a fail. Returns true when a
   * checkpoint existed; false means restart the mission from the top. */
  rewindToCheckpoint(game) {
    const cp = this.checkpoints.pop();
    if (!cp) return false;
    this.stage = cp.stage;
    this.scriptStep = cp.scriptStep;
    this.timer = cp.timer;
    this.packageTaken = cp.packageTaken;
    this.secondPickupDone = cp.secondPickupDone;
    game.player.x = cp.x;
    game.player.z = cp.z;
    if (game.player.car) game.player.exitCar();
    game.player.syncMesh();
    game.setWanted(0);
    return true;
  }

  start() {
    this.index = 0;
    this.stage = 0;
    this.done = false;
    this.fareIndex = 0;
    this.faresDone = 0;
    this.fare = null;
    this.secondPickupDone = false;
    this.log = [];
    this.sideJob = null;
    this.loadScript(MISSIONS[0]);
    this.beginBriefing(MISSIONS[0]);
    this.say('Mara: Riko, you\'re back. I need wheels — steal a car and bring it to my garage.', 6);
  }

  /** Begin a taxi fare: pick the next waiting passenger. */
  beginFare() {
    this.fare = TAXI_FARES[this.fareIndex % TAXI_FARES.length];
    this.meter = this.fare.base;
    this.fareCrashes = 0;
    this.say(`Fare ${this.faresDone + 1} of ${this.current.fares}: pick them up at ${PLACES[this.fare.from].label}.`, 5);
  }

  /** Start a side job (v6): the free-roam work that pays after the story.
   * Returns false when a story mission is already active. */
  startSideJob(id) {
    if (this.current) return false;
    const job = SIDE_JOBS.find((j) => j.id === id);
    if (!job || this.sideJob) return false;
    this.sideJob = job;
    this.sideJobStep = 0;
    this.sideJobTimer = job.timeLimit || job.holdSeconds || 0;
    this.say(`Side job: ${job.title} — ${job.brief}`, 6);
    return true;
  }

  /** Finish a side job: pay out and clear it. */
  completeSideJob(game) {
    const job = this.sideJob;
    if (!job) return;
    game.money += job.reward;
    // v7: the side-job pay writes a ledger line.
    if (game.economy) game.economy.record('sidejob', job.reward, `Side job — ${job.title}`);
    game.audio.jingle();
    this.sideJobsDone += 1;
    this.say(`Side job done: ${job.title} — +$${job.reward}`, 5);
    this.sideJob = null;
    this.sideJobStep = 0;
    this.sideJobTimer = 0;
    this.hideBeacon();
  }

  setBeacon(x, z) {
    if (!this.beacon) {
      this.beacon = makeBeacon(0xffd94f);
      this.scene.add(this.beacon);
    }
    this.beacon.position.set(x, 0, z);
    this.beacon.visible = true;
    this.beaconTarget = { x, z };
  }

  hideBeacon() {
    if (this.beacon) this.beacon.visible = false;
    this.beaconTarget = null;
  }

  spawnStashes() {
    for (const spot of STASH_SPOTS) {
      const mesh = makeStash();
      mesh.position.set(spot.x, 0, spot.z);
      this.scene.add(mesh);
      this.stashes.push({ x: spot.x, z: spot.z, mesh, taken: false });
    }
  }

  completeMission(game) {
    const m = this.current;
    game.money += m.reward;
    // v7: the mission payout writes a ledger line, like every earning.
    if (game.economy) game.economy.record('mission', m.reward, m.title);
    game.stats.missionsDone += 1;
    game.audio.jingle();
    this.log.push({ id: m.id, title: m.title, reward: m.reward, time: game.time });
    this.say(`Mission complete: ${m.title} — +$${m.reward}`, 5);
    this.hideBeacon();
    this.index += 1;
    this.stage = 0;
    this.packageTaken = false;
    this.secondPickupDone = false;
    this.fare = null;
    this.meter = 0;
    this.faresDone = 0;
    this.fareIndex = 0;
    this.patientHealth = TUNE.ambulancePatientHealth;
    this.script = [];
    this.scriptStep = 0;
    this.checkpoints = [];
    if (this.index >= MISSIONS.length) {
      this.index = -1;
      this.done = true;
      game.setWanted(0);
      this.say('Story complete — Qihuy City is yours, Riko. Free roam!', 8);
    } else {
      const next = MISSIONS[this.index];
      this.loadScript(next);
      this.beginBriefing(next);
      this.say(`New mission: ${next.title} — ${next.brief}` , 7);
      this.timer = 0;
      game.spawnJobVehicle();
      // v5: the airport heist arms Riko — Mara leaves a shotgun with 12
      // shells for the job — and parks a getaway bike by the terminal.
      if (next.grantsShotgun && !game.player.owned.shotgun) {
        game.player.owned.shotgun = true;
        game.player.ammo.shotgun += 12;
        this.say('Mara left you a shotgun — 12 shells, press 3. The bike is by the terminal.', 6);
      }
      if (next.bikeAtStart) {
        game.traffic.spawnBike(PLACES.terminal.x, PLACES.terminal.z + 8, Math.PI / 2);
      }
    }
  }

  /** Shared countdown: while a timer runs, hitting zero sends the player back.
   * v6: the fail rewinds to the last checkpoint when one exists, instead of
   * always restarting the mission from the top. */
  tickTimer(dt, game, retryStage, retryMessage) {
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.rewindToCheckpoint(game)) {
          this.say(`${retryMessage} Back at the last checkpoint — go again.`, 5);
        } else {
          this.say(retryMessage, 5);
          this.stage = retryStage;
          this.packageTaken = false;
          this.fare = null;
          game.setWanted(0);
        }
        return true;
      }
    }
    return false;
  }

  /** A hard crash while a fare or a patient is aboard. */
  onCrash(game) {
    const m = this.current;
    if (!m) return;
    if (m.kind === 'taxi' && this.stage === 2) {
      this.fareCrashes += 1;
      this.say('That crash cost you the tip — drive smooth!', 3);
    }
    if (m.kind === 'ambulance' && this.stage === 2) {
      this.patientHealth -= TUNE.ambulanceCrashDamage;
      game.audio.blip(180, 0.2, 0.3);
      if (this.patientHealth <= 0) {
        this.patientHealth = 0;
        // v6: the patient is lost — rewind to the checkpoint if there is
        // one, otherwise back to the docks like before.
        if (!this.rewindToCheckpoint(game)) {
          this.stage = 1;
          this.packageTaken = false;
          game.setWanted(0);
        }
        this.say('The patient didn\'t make it — back to the docks to try again.', 5);
      } else {
        this.say(`Patient hurt by the crash — ${Math.ceil(this.patientHealth)} HP left!`, 3);
      }
    }
  }

  /** Advance the script one step: record the checkpoint, move the step
   * cursor, and keep the old stage number in sync for the HUD. */
  advanceScript(game) {
    this.recordCheckpoint(game);
    this.scriptStep += 1;
    // Keep the stage number roughly in sync: steal/take is stage 0,
    // pickup is stage 1, delivery is stage 2.
    const step = this.script[this.scriptStep];
    if (!step) return;
    if (step.type === 'pickup' || step.type === 'fares' || step.type === 'patient') this.stage = 1;
    if (step.type === 'deliver' || step.type === 'secondPickup') this.stage = 2;
  }

  update(dt, game) {
    const player = game.player;
    this.messageTimer = Math.max(0, this.messageTimer - dt);
    if (this.beacon && this.beacon.visible) {
      this.beacon.userData.ring.rotation.z += dt * 1.5;
      this.beacon.userData.ring.scale.setScalar(1 + Math.sin(game.time * 3) * 0.08);
    }
    // Stashes: walk or drive over one to collect it.
    for (const stash of this.stashes) {
      if (stash.taken) continue;
      stash.mesh.userData.glow.material.color.setHex(
        Math.sin(game.time * 4) > 0 ? 0x51ff7a : 0xb8ffc8,
      );
      if (dist2(player.x, player.z, stash.x, stash.z) < 6.5) {
        stash.taken = true;
        this.scene.remove(stash.mesh);
        this.stashesCollected += 1;
        game.money += TUNE.stashReward;
        // v7: the stash writes a ledger line, like every other earning.
        if (game.economy) game.economy.record('stash', TUNE.stashReward, 'Cash stash');
        game.audio.chime();
        this.say(`Cash stash found — +$${TUNE.stashReward} (${this.stashesCollected}/${this.stashes.length})`, 3);
      }
    }

    // Side jobs run when the story is done (or before it starts).
    if (!this.current) {
      if (this.sideJob) this.updateSideJob(dt, game);
      else {
        // No story, no side job: the beacon stays hidden.
        this.hideBeacon();
      }
      return;
    }

    const m = this.current;
    const target = this.target;
    if (target) this.setBeacon(target.x, target.z);
    else this.hideBeacon();

    // The taxi meter ticks per metre driven with a fare aboard.
    if (m.kind === 'taxi' && this.stage === 2 && this.fare && !player.onFoot) {
      const moved = Math.hypot(player.x - this.lastX, player.z - this.lastZ);
      this.meter += moved * TUNE.taxiMeterPerMetre;
    }
    this.lastX = player.x;
    this.lastZ = player.z;

    // Stage 0 — acquire: steal a car, take the job vehicle, or reach the pickup.
    if (this.stage === 0) {
      if (m.needCar) {
        if (!player.onFoot) {
          this.advanceScript(game);
          if (m.starsOnSteal) game.setWanted(m.starsOnSteal);
          this.say(m.id === 'the-big-score'
            ? 'The Garuda Sport is yours — now lose the heat and bring it to the garage.'
            : 'Good — now bring it to the garage on Pelican Row.', 4);
        }
        return;
      }
      if (m.kind) {
        const spec = this.jobSpec();
        if (spec && !player.onFoot && player.car && player.car.jobKind === spec.kind) {
          this.advanceScript(game);
          if (m.kind === 'taxi') this.beginFare();
          else if (m.kind === 'ambulance') this.say('Ambulance ready — sirens on. Pick up the patient at the docks.', 5);
          else this.say('Truck ready — load the container at the port (press E).', 5);
        }
        return;
      }
      const dest = m.pickup ? PLACES[m.pickup] : PLACES[m.dropoff];
      if (dist2(player.x, player.z, dest.x, dest.z) < 64) {
        if (m.pickup) {
          // Reached the pickup: the script's `reach` step is done, so
          // the current step becomes `pickup` (stage 1, waiting for E).
          this.advanceScript(game);
          this.say('You\'re there. Grab it (press E).', 4);
        } else {
          this.completeMission(game);
        }
      }
      return;
    }

    // Stage 1 — the pickup waits for E (tryInteract), or a steal job's dropoff.
    if (this.stage === 1) {
      if (!m.pickup && !m.kind) {
        if (dist2(player.x, player.z, PLACES[m.dropoff].x, PLACES[m.dropoff].z) < 100) {
          this.completeMission(game);
        }
      }
      return;
    }

    // Stage 2 — deliver to the dropoff, on the clock if the mission is timed.
    if (this.stage === 2) {
      if (m.timeLimit && this.tickTimer(dt, game, m.kind === 'taxi' ? 1 : 0,
        m.id === 'sunset-fare'
          ? 'Too slow — the fare walked off. Back to Sunset Plaza.'
          : m.kind === 'ambulance'
            ? 'Too slow — the patient was moved by another crew. Back to the port.'
            : 'Too slow — the job fell through. Back to the pickup.')) return;
      // Two-stop job (mission 12): the second ledger waits at the second
      // pickup — the dropoff does not count until both sets are grabbed.
      if (m.secondPickup && !this.secondPickupDone) {
        const second = PLACES[m.secondPickup];
        if (dist2(player.x, player.z, second.x, second.z) < 64) {
          this.say(`Second ledger here — grab it (press E).`, 4);
        }
        return;
      }
      // Taxi: each dropoff pays the meter plus a smooth-driving tip, then
      // the next fare waits; the mission ends after the last fare.
      if (m.kind === 'taxi' && this.fare) {
        const dest = PLACES[this.fare.to];
        if (dist2(player.x, player.z, dest.x, dest.z) < 100) {
          const tip = this.fareCrashes === 0 && game.wanted === 0 ? TUNE.taxiTipSmooth : 0;
          const paid = Math.floor(this.meter) + tip;
          game.money += paid;
          // v7: the fare writes a ledger line, like every earning.
          if (game.economy) game.economy.record('taxi', paid, `Taxi fare ${this.faresDone + 1}`);
          game.audio.fareDing();
          game.stats.fares += 1;
          this.faresDone += 1;
          this.say(`Fare dropped — +$${paid}${tip > 0 ? ` (incl. $${tip} smooth tip)` : ''} (${this.faresDone}/${m.fares}).`, 4);
          if (this.faresDone >= m.fares) {
            this.completeMission(game);
          } else {
            this.fareIndex += 1;
            this.stage = 1;
            this.beginFare();
          }
        }
        return;
      }
      const dest = PLACES[m.dropoff];
      if (dist2(player.x, player.z, dest.x, dest.z) < 100) {
        this.completeMission(game);
      }
    }
  }

  /** The side-job update: courier, wheelman and lookout each run their
   * own small loop while the story is idle. */
  updateSideJob(dt, game) {
    const job = this.sideJob;
    const player = game.player;
    const target = this.sideJobTarget();
    if (target) this.setBeacon(target.x, target.z);
    else this.hideBeacon();
    if (job.id === 'courier') {
      if (this.sideJobStep === 1) {
        this.sideJobTimer -= dt;
        if (this.sideJobTimer <= 0) {
          this.say('Courier too slow — the parcel went to another runner.', 5);
          this.sideJob = null;
          this.hideBeacon();
          return;
        }
        if (dist2(player.x, player.z, PLACES[job.dropoff].x, PLACES[job.dropoff].z) < 100) {
          this.completeSideJob(game);
        }
      }
      return;
    }
    if (job.id === 'wheelman') {
      if (this.sideJobStep === 1 && !player.onFoot) {
        if (dist2(player.x, player.z, PLACES[job.dropoff].x, PLACES[job.dropoff].z) < 100) {
          this.completeSideJob(game);
        }
      }
      return;
    }
    if (job.id === 'lookout') {
      this.sideJobTimer -= dt;
      const near = dist2(player.x, player.z, PLACES[job.hold].x, PLACES[job.hold].z) < 100;
      if (!near) {
        this.say('Lookout: get back to the warehouse corner!', 3);
        this.sideJobTimer = Math.min(job.holdSeconds, this.sideJobTimer + dt * 2);
        return;
      }
      if (game.wanted > 0) {
        // Cops on the corner scare the crew — the hold stalls.
        this.say('Lookout: cops on the corner — lose them first!', 3);
        return;
      }
      if (this.sideJobTimer <= 0) this.completeSideJob(game);
    }
  }

  /** The E key: pick up the package / case / fare / meds / ledger / patient. */
  tryInteract(game) {
    const m = this.current;
    // Side jobs take E first when no story mission is active.
    if (!m && this.sideJob) return this.trySideJobInteract(game);
    if (!m) return false;
    const player = game.player;
    // Two-stop job: the second pickup is grabbed during stage 2.
    if (m.secondPickup && !this.secondPickupDone && this.stage === 2) {
      const second = PLACES[m.secondPickup];
      if (dist2(player.x, player.z, second.x, second.z) >= 36) return false;
      this.secondPickupDone = true;
      this.advanceScript(game);
      game.setWanted(m.starsOnPickup || 3);
      game.spawnGangCrew(m.secondPickup);
      game.audio.chime();
      const secondLines = {
        'airport-heist': 'Runway crate grabbed! Both crates in hand — now run for the hideout.',
        'neon-run': 'Second ledger grabbed! Both sets in hand — now run for the hideout.',
        'mara-finale': 'Ferry case grabbed! Both cases in hand — now run for the garage.',
        'dara-finale': 'Old Town case grabbed! Both cases in hand — now run for the casino.',
      };
      this.say(secondLines[m.id] || 'Second item grabbed — now run for the dropoff.', 5);
      return true;
    }
    if (this.stage !== 1) return false;
    // Taxi fare pickup: the passenger waits at the fare's origin.
    if (m.kind === 'taxi' && this.fare) {
      const dest = PLACES[this.fare.from];
      if (dist2(player.x, player.z, dest.x, dest.z) >= 36) return false;
      this.stage = 2;
      game.audio.chime();
      this.say(`Fare aboard — meter running from $${this.fare.base}. Smooth ride earns a tip.`, 4);
      return true;
    }
    // Ambulance patient pickup at the docks.
    if (m.kind === 'ambulance') {
      if (dist2(player.x, player.z, PLACES.docks.x, PLACES.docks.z) >= 36) return false;
      this.packageTaken = true;
      this.stage = 2;
      this.timer = m.timeLimit;
      this.patientHealth = TUNE.ambulancePatientHealth;
      game.setWanted(0); // sirens on: the city gives the ambulance a pass
      game.audio.chime();
      this.say('Patient loaded — sirens on, 3:00 to City Hospital. Don\'t crash!', 5);
      return true;
    }
    if (!m.pickup) return false;
    const dest = PLACES[m.pickup];
    if (dist2(player.x, player.z, dest.x, dest.z) >= 36) return false;
    this.packageTaken = true;
    this.stage = 2;
    this.advanceScript(game);
    if (m.timeLimit) this.timer = m.timeLimit;
    if (m.starsOnPickup) game.setWanted(m.starsOnPickup);
    if (m.gangOnPickup) game.spawnGangCrew(m.pickup);
    game.audio.chime();
    const lines = {
      'the-package': 'Package secured. 2:30 to Neon Palms — and the cops are watching.',
      'harbor-lights': 'Cash case grabbed! The Rimba crew is here — lose the heat and reach the hideout.',
      'sunset-fare': 'Fare picked up. 2:00 to the Beachfront Hotel — drive smooth.',
      'warehouse-raid': 'Mara\'s cut grabbed! The crew is coming — get it to the garage.',
      'hospital-run': 'Meds collected. 2:30 to the hideout — and the patrols saw you.',
      'last-getaway': 'Ledger grabbed! Four stars and a chopper — run for the hideout!',
      'port-delivery': 'Container loaded! The Rimba crew wants it — 2:30 to the north warehouse.',
      'neon-run': 'First ledger grabbed! Three stars — now the Old Town set, then the hideout.',
      'old-town-run': 'Mara\'s cut grabbed! Dara\'s crew is on every corner — 2:30 to the garage.',
      'the-long-sunset': 'Sunset case grabbed! Four stars, roadblocks everywhere — run for the hideout!',
      'airport-heist': 'Hangar crate grabbed! Four stars — now the runway crate, then run for the hideout.',
      'casino-strip': 'Velvet bag grabbed! Dara\'s crew is on the strip — 3:00 to the garage.',
      'the-final-runway': 'Tarmac case grabbed! Five stars, two choppers — run for the hideout!',
      'ferry-terminal': 'Ferry crate grabbed! Three stars — up the boardwalk to the garage, 3:00.',
      'market-hustle': 'Mara\'s cut grabbed! Dara\'s crew is on Market Row — 3:00 to the hideout.',
      'sunset-finale': 'Boardwalk case grabbed! Five stars, spike strips on the beach road — run!',
      // v7: the branching-arc jobs — Mara's ledger, runway and finale,
      // and Dara's chips, ferry and finale.
      'mara-ledger': 'Mara\'s ledger grabbed! The Rimba crew is holding the port — 3:00 to the garage.',
      'mara-runway': 'Tarmac case grabbed! Five stars, two choppers — run for the hideout!',
      'mara-finale': 'Boardwalk case grabbed! Five stars — now the ferry case, then both to the garage.',
      'dara-chips': 'Dara\'s chips grabbed! Her own crew is on the strip — 3:00 to the hideout.',
      'dara-ferry': 'Ferry crate grabbed! Four stars — run it to the Golden Palm, 3:00.',
      'dara-finale': 'Market Row case grabbed! Five stars — now the Old Town case, then both to the casino.',
    };
    this.say(lines[m.id] || 'Got it. Deliver it — fast.', 5);
    return true;
  }

  /** E during a side job: courier pickup, wheelman steal, lookout start. */
  trySideJobInteract(game) {
    const job = this.sideJob;
    const player = game.player;
    if (!job) return false;
    if (job.id === 'courier' && this.sideJobStep === 0) {
      if (dist2(player.x, player.z, PLACES[job.pickup].x, PLACES[job.pickup].z) >= 36) return false;
      this.sideJobStep = 1;
      this.sideJobTimer = job.timeLimit;
      game.setWanted(job.starsOnPickup || 1);
      game.audio.chime();
      this.say('Parcel picked up — 2:00 to the club.', 4);
      return true;
    }
    if (job.id === 'wheelman' && this.sideJobStep === 0) {
      if (player.onFoot) return false;
      this.sideJobStep = 1;
      game.setWanted(job.starsOnSteal || 2);
      this.say('The Coupe is yours — bring it to the garage.', 4);
      return true;
    }
    return false;
  }
}
