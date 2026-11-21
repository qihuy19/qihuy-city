// People, v6: pedestrians strolling the sidewalks, foot police who chase
// and arrest the player, and the Rimba crew gunmen of the final mission.
// Every person is a small articulated group of boxes — cheap to render,
// easy to animate with a walk swing — and each one keeps its own little
// state machine.
//
// v3 adds two more crowds: dock workers in hard hats who walk the port and
// the boardwalk, and medics in white who wait outside City Hospital — plus
// waiting fares at the cab stand, who wave until a taxi pulls up.
//
// v4: foot cops run a small behaviour tree (CHASE while the player is seen,
// SEARCH the last-known spot when sight is lost, ARREST on contact), and
// two new crowds appear — market vendors in Old Town and anglers on the
// marina, so the new districts feel lived-in.
//
// v5: airport travelers and ground crew walk the terminal apron, and foot
// cops read the weather's sight factor like the patrol cars — fog trims
// their sight range too.
//
// v6 rewrites pedestrian AI around SCHEDULES and MOODS: every ped has a
// daily rhythm — a home block, a work block and a favourite spot — and
// walks between them on a slow clock instead of picking random wander
// points forever; moods (calm / nervous / panicked) spread from a scare
// like a rumour, so a gunshot on one street makes the next street nervous
// before anyone there saw it. Three new crowds join the city: joggers on
// the boardwalk at dawn and dusk, buskers with a guitar case by the plaza
// fountain who play for tips, and cyclists who ride the road grid in the
// bike lane and ring a bell when the player blocks the road. Crowd
// density follows the clock: the boardwalk and plaza fill at dusk, the
// port empties at night, and the ferry terminal fills when a ferry is in.
import * as THREE from 'three';
import { CITY, TUNE, PLACES } from './config.js';
import { makeRng, clamp, dist2, collideCircle } from './util.js';
import { FootCopBrain } from './police.js';

const SHIRT_COLORS = [0xe8e4da, 0xd94f3d, 0x3d7fd9, 0x7ac74f, 0xf2c230, 0x8a5fd0, 0x2bb3a3, 0xe07fb0];
const SKIN_COLORS = [0xe8b88a, 0xc98a5e, 0x8a5a3a, 0xf0c8a0];
const JOGGER_COLORS = [0xff5a7a, 0x2bd9c9, 0xffc94f, 0x51ff7a, 0xe8e4da];
const BUSKER_COLORS = [0x8a5fd0, 0x3a2a55, 0x5a3a6a];

/** A simple person: head, torso, legs that swing while walking, arms. */
export function makePersonMesh(shirt, skin, police) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: police ? 0x1c2f6e : 0x2e3440 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirtMat);
  torso.position.y = 1.12;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), skinMat);
  head.position.y = 1.72;
  group.add(head);
  const capMat = new THREE.MeshLambertMaterial({ color: police ? 0x1c2f6e : shirt });
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.42), capMat);
  cap.position.y = 1.94;
  group.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pantsMat);
  legL.position.set(-0.17, 0.39, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.17;
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), shirtMat);
  armL.position.set(-0.42, 1.15, 0);
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  group.add(armR);
  if (police) {
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd94f }));
    badge.position.set(-0.16, 1.3, 0.19);
    group.add(badge);
  }
  group.userData = { legL, legR, armL, armR, head };
  return group;
}

/** A hard hat for a dock worker: a yellow half-dome on the head. */
function addHardHat(mesh) {
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
  );
  hat.position.y = 1.9;
  mesh.add(hat);
}

/** A guitar for a busker: a brown body and a neck, held across the chest. */
function addGuitar(mesh) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 0.18, 10),
    new THREE.MeshLambertMaterial({ color: 0x8a5a2a }),
  );
  body.rotation.x = Math.PI / 2;
  body.position.set(0.1, 1.05, 0.3);
  mesh.add(body);
  const neck = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
  );
  neck.position.set(0.3, 1.25, 0.3);
  neck.rotation.z = 0.5;
  mesh.add(neck);
}

/** A bicycle for a cyclist: two wheels, a frame and handlebars, ridden
 * by a person mesh standing on the pedals — the whole group moves as one. */
function makeBikeRiderMesh(shirt, skin) {
  const group = makePersonMesh(shirt, skin, false);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2b6cb0 });
  for (const z of [-0.7, 0.7]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 6, 14), wheelMat);
    wheel.position.set(0, 0.36, z);
    group.add(wheel);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.3), frameMat);
  frame.position.set(0, 0.75, 0);
  group.add(frame);
  const bars = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), frameMat);
  bars.position.set(0, 1.05, 0.68);
  group.add(bars);
  // The rider sits lower on a bike: drop the legs into a pedalling pose.
  group.userData.legL.position.y = 0.7;
  group.userData.legR.position.y = 0.7;
  group.userData.legL.rotation.x = 0.6;
  group.userData.legR.rotation.x = -0.6;
  return group;
}

/** A ped's daily schedule (v6): a home block, a work block and a favourite
 * spot, with the hours they move between them. The ped walks the legs of
 * the schedule in order; at night they head home and the streets empty. */
export function makeSchedule(rng, wanderPoints) {
  const home = rng.pick(wanderPoints);
  const work = rng.pick(wanderPoints);
  const favourite = rng.pick(wanderPoints);
  return {
    home, work, favourite,
    // Hours (game clock, 0..24) when the ped leaves for work and for home.
    leaveHomeAt: rng.range(7, 10),
    leaveWorkAt: rng.range(16, 19),
  };
}

export class Person {
  constructor(mesh, kind) {
    this.mesh = mesh;
    this.kind = kind; // 'ped' | 'cop' | 'gang' | 'worker' | 'medic' | 'fare' | 'jogger' | 'busker' | 'cyclist'
    this.x = 0; this.z = 0; this.yaw = 0;
    this.speed = 0;
    this.health = 100;
    this.dead = false;
    this.walkPhase = 0;
    // Pedestrian state: 'walk' | 'flee' | 'down' | 'wait' | 'play' | 'ride'
    this.state = 'walk';
    this.target = null;
    this.retarget = 0;
    this.fleeTimer = 0;
    this.shootTimer = 0;
    this.arrestTimer = 0;
    this.wavePhase = 0;
    // Foot-cop brain (v4): CHASE / SEARCH / PATROL with a last-known spot.
    this.brain = null;
    // v6 schedule + mood: a daily rhythm and a calm / nervous / panicked
    // mood that spreads from scares and decays with time.
    this.schedule = null;
    this.scheduleLeg = 0; // 0 home -> work, 1 work -> favourite, 2 favourite -> home
    this.mood = 'calm';
    this.moodTimer = 0;
    // Cyclist state: which road they ride and which way.
    this.axis = 'x';
    this.dir = 1;
    this.bellTimer = 0;
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.yaw;
    const swing = Math.sin(this.walkPhase) * 0.5 * clamp(this.speed / 3, 0, 1);
    if (this.kind === 'cyclist') {
      // A cyclist pedals: the legs pump in a circle, the torso leans.
      this.mesh.userData.legL.rotation.x = 0.6 + Math.sin(this.walkPhase) * 0.5;
      this.mesh.userData.legR.rotation.x = -0.6 + Math.cos(this.walkPhase) * 0.5;
      this.mesh.userData.armL.rotation.x = -0.9;
      this.mesh.userData.armR.rotation.x = -0.9;
      return;
    }
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
    if (this.state === 'wait') {
      // A waiting fare waves one arm to hail the cab.
      this.mesh.userData.armR.rotation.x = -2.4 + Math.sin(this.wavePhase * 6) * 0.4;
      this.mesh.userData.armL.rotation.x = 0;
    } else if (this.state === 'play') {
      // A busker strums: both arms work the guitar in a slow rhythm.
      this.mesh.userData.armR.rotation.x = -0.9 + Math.sin(this.wavePhase * 4) * 0.35;
      this.mesh.userData.armL.rotation.x = -0.7 + Math.cos(this.wavePhase * 4) * 0.2;
    } else {
      this.mesh.userData.armL.rotation.x = -swing * 0.8;
      this.mesh.userData.armR.rotation.x = swing * 0.8;
    }
  }
}

/** Pedestrians, foot police and gang gunmen, updated by the game each frame. */
export class People {
  constructor(scene, colliders, wanderPoints, rng) {
    this.scene = scene;
    this.colliders = colliders;
    this.wanderPoints = wanderPoints;
    this.rng = rng;
    this.peds = [];
    this.cops = [];
    this.gang = [];
    this.workers = [];
    this.medics = [];
    this.fares = [];
    this.vendors = [];
    // v5: airport travelers and ground crew, walking the terminal apron.
    this.travelers = [];
    // v6: joggers, buskers and cyclists — the new street life.
    this.joggers = [];
    this.buskers = [];
    this.cyclists = [];
    // v6: the city clock (game hours, 0..24) the schedules read, and the
    // weather sight factor the foot cops read.
    this.cityHour = 18;
    this.weatherSight = 1;
  }

  /** Give a ped a schedule: home, work and favourite spots from the
   * wander points, so the same ped walks a daily route instead of
   * teleporting between random points. */
  giveSchedule(ped) {
    ped.schedule = makeSchedule(this.rng, this.wanderPoints);
    ped.scheduleLeg = 0;
    return ped;
  }

  /** The next schedule stop for a ped, given the city hour: work in the
   * morning, the favourite spot in the afternoon, home at night. */
  scheduleTarget(ped) {
    if (!ped.schedule) return null;
    const h = this.cityHour;
    if (h >= ped.schedule.leaveWorkAt || h < ped.schedule.leaveHomeAt) return ped.schedule.home;
    if (h >= 13) return ped.schedule.favourite;
    return ped.schedule.work;
  }

  spawnPeds(count) {
    for (let i = 0; i < count; i += 1) {
      const spot = this.rng.pick(this.wanderPoints);
      const ped = new Person(
        makePersonMesh(this.rng.pick(SHIRT_COLORS), this.rng.pick(SKIN_COLORS), false),
        'ped',
      );
      ped.x = spot.x + this.rng.range(-6, 6);
      ped.z = spot.z + this.rng.range(-6, 6);
      ped.yaw = this.rng.range(0, Math.PI * 2);
      ped.speed = this.rng.range(1.6, 2.8);
      this.giveSchedule(ped);
      this.peds.push(ped);
      this.scene.add(ped.mesh);
      ped.syncMesh();
    }
  }

  /** Dock workers: orange shirts, hard hats, walking the port and boardwalk. */
  spawnWorkers(count) {
    const spots = [
      { x: CITY.portX - 20, z: CITY.portZ + 10 },
      { x: CITY.portX + 20, z: CITY.portZ - 20 },
      { x: -120, z: CITY.boardwalkZ },
      { x: 60, z: CITY.boardwalkZ },
    ];
    for (let i = 0; i < count; i += 1) {
      const spot = this.rng.pick(spots);
      const mesh = makePersonMesh(0xe8730c, this.rng.pick(SKIN_COLORS), false);
      addHardHat(mesh);
      const worker = new Person(mesh, 'worker');
      worker.x = spot.x + this.rng.range(-8, 8);
      worker.z = spot.z + this.rng.range(-6, 6);
      worker.yaw = this.rng.range(0, Math.PI * 2);
      worker.speed = this.rng.range(1.4, 2.2);
      this.giveSchedule(worker);
      this.workers.push(worker);
      this.scene.add(worker.mesh);
      worker.syncMesh();
    }
  }

  /** Medics in white, waiting outside City Hospital. */
  spawnMedics(count) {
    for (let i = 0; i < count; i += 1) {
      const medic = new Person(
        makePersonMesh(0xf2f2f2, this.rng.pick(SKIN_COLORS), false),
        'medic',
      );
      medic.x = PLACES.hospital.x + this.rng.range(-10, 10);
      medic.z = PLACES.hospital.z + this.rng.range(-6, 6);
      medic.yaw = this.rng.range(0, Math.PI * 2);
      medic.speed = 0;
      medic.state = 'wait';
      this.medics.push(medic);
      this.scene.add(medic.mesh);
      medic.syncMesh();
    }
  }

  /** Waiting fares at the cab stand and the plaza, waving for a taxi. */
  spawnFares(count) {
    const spots = [PLACES.taxiStand, PLACES.plaza, PLACES.hotel];
    for (let i = 0; i < count; i += 1) {
      const spot = this.rng.pick(spots);
      const fare = new Person(
        makePersonMesh(this.rng.pick(SHIRT_COLORS), this.rng.pick(SKIN_COLORS), false),
        'fare',
      );
      fare.x = spot.x + this.rng.range(-5, 5);
      fare.z = spot.z + this.rng.range(-5, 5);
      fare.yaw = this.rng.range(0, Math.PI * 2);
      fare.speed = 0;
      fare.state = 'wait';
      this.fares.push(fare);
      this.scene.add(fare.mesh);
      fare.syncMesh();
    }
  }

  /** Market vendors in Old Town and anglers on the marina pier: they stand
   * at their stalls and wave at passers-by, like the waiting fares. */
  spawnVendors(count) {
    const spots = [
      { x: PLACES.oldtown.x - 8, z: PLACES.oldtown.z + 6 },
      { x: PLACES.oldtown.x + 10, z: PLACES.oldtown.z - 4 },
      { x: PLACES.market.x - 6, z: PLACES.market.z + 8 },
      { x: PLACES.marina.x + 6, z: PLACES.marina.z - 10 },
      { x: PLACES.marina.x - 12, z: PLACES.marina.z + 4 },
    ];
    for (let i = 0; i < count; i += 1) {
      const spot = spots[i % spots.length];
      const vendor = new Person(
        makePersonMesh(this.rng.pick([0xff5a9e, 0x2bd9c9, 0xffc94f, 0x8a5fd0]), this.rng.pick(SKIN_COLORS), false),
        'vendor',
      );
      vendor.x = spot.x + this.rng.range(-3, 3);
      vendor.z = spot.z + this.rng.range(-3, 3);
      vendor.yaw = this.rng.range(0, Math.PI * 2);
      vendor.speed = 0;
      vendor.state = 'wait';
      this.vendors.push(vendor);
      this.scene.add(vendor.mesh);
      vendor.syncMesh();
    }
  }

  /** Airport travelers (v5): suitcases in hand, walking between the
   * terminal, the hangars and the runway apron — plus ground crew in
   * hi-vis orange who work the planes. */
  spawnTravelers(count) {
    const spots = [
      { x: -222, z: -186 },
      { x: -240, z: -196 },
      { x: -206, z: -240 },
      { x: -196, z: -232 },
    ];
    for (let i = 0; i < count; i += 1) {
      const spot = this.rng.pick(spots);
      const crew = i % 3 === 0;
      const mesh = makePersonMesh(
        crew ? 0xe8730c : this.rng.pick(SHIRT_COLORS),
        this.rng.pick(SKIN_COLORS), false,
      );
      if (crew) addHardHat(mesh);
      const traveler = new Person(mesh, crew ? 'worker' : 'ped');
      traveler.x = spot.x + this.rng.range(-8, 8);
      traveler.z = spot.z + this.rng.range(-6, 6);
      traveler.yaw = this.rng.range(0, Math.PI * 2);
      traveler.speed = this.rng.range(1.4, 2.6);
      this.giveSchedule(traveler);
      this.travelers.push(traveler);
      this.scene.add(traveler.mesh);
      traveler.syncMesh();
    }
  }

  /** Joggers (v6): bright shirts, fast on the boardwalk and the plaza —
   * they run a loop and never stop for the player. */
  spawnJoggers(count) {
    const spots = [
      { x: -120, z: CITY.boardwalkZ }, { x: 60, z: CITY.boardwalkZ },
      { x: -31, z: -31 }, { x: 124, z: CITY.boardwalkZ },
    ];
    for (let i = 0; i < count; i += 1) {
      const spot = this.rng.pick(spots);
      const jogger = new Person(
        makePersonMesh(this.rng.pick(JOGGER_COLORS), this.rng.pick(SKIN_COLORS), false),
        'jogger',
      );
      jogger.x = spot.x + this.rng.range(-10, 10);
      jogger.z = spot.z + this.rng.range(-4, 4);
      jogger.yaw = this.rng.range(0, Math.PI * 2);
      jogger.speed = this.rng.range(4.2, 5.4);
      jogger.target = this.rng.pick(this.wanderPoints);
      this.joggers.push(jogger);
      this.scene.add(jogger.mesh);
      jogger.syncMesh();
    }
  }

  /** Buskers (v6): a guitar, a case on the ground, playing by the plaza
   * fountain and the boardwalk stalls. They stand and play; peds nearby
   * slow down to listen. */
  spawnBuskers(count) {
    const spots = [
      { x: -31 + 12, z: -31 }, { x: -120, z: CITY.boardwalkZ + 3 },
      { x: 186, z: 124 }, { x: -248, z: 217 },
    ];
    for (let i = 0; i < count; i += 1) {
      const spot = spots[i % spots.length];
      const mesh = makePersonMesh(this.rng.pick(BUSKER_COLORS), this.rng.pick(SKIN_COLORS), false);
      addGuitar(mesh);
      const busker = new Person(mesh, 'busker');
      busker.x = spot.x + this.rng.range(-2, 2);
      busker.z = spot.z + this.rng.range(-2, 2);
      busker.yaw = this.rng.range(0, Math.PI * 2);
      busker.speed = 0;
      busker.state = 'play';
      this.buskers.push(busker);
      this.scene.add(busker.mesh);
      busker.syncMesh();
    }
  }

  /** Cyclists (v6): riders on the road grid in the bike lane, ringing a
   * bell when the player blocks the road. They follow the roads like
   * traffic, slower than cars and quicker than peds. */
  spawnCyclists(count) {
    const { pitch, halfGrid } = CITY;
    for (let i = 0; i < count; i += 1) {
      const mesh = makeBikeRiderMesh(this.rng.pick(JOGGER_COLORS), this.rng.pick(SKIN_COLORS));
      const cyclist = new Person(mesh, 'cyclist');
      cyclist.state = 'ride';
      cyclist.axis = this.rng.chance(0.5) ? 'x' : 'z';
      cyclist.dir = this.rng.chance(0.5) ? 1 : -1;
      const road = this.rng.int(-halfGrid, halfGrid) * pitch;
      const along = this.rng.range(-CITY.bound, CITY.bound);
      if (cyclist.axis === 'x') {
        cyclist.x = along; cyclist.z = road + cyclist.dir * 3.5;
        cyclist.yaw = cyclist.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        cyclist.z = along; cyclist.x = road + cyclist.dir * 3.5;
        cyclist.yaw = cyclist.dir > 0 ? 0 : Math.PI;
      }
      cyclist.speed = this.rng.range(6, 8);
      this.cyclists.push(cyclist);
      this.scene.add(cyclist.mesh);
      cyclist.syncMesh();
    }
  }

  spawnCop(x, z) {
    const cop = new Person(makePersonMesh(0x1c2f6e, this.rng.pick(SKIN_COLORS), true), 'cop');
    cop.x = x; cop.z = z;
    cop.speed = 5.2;
    cop.brain = new FootCopBrain();
    this.cops.push(cop);
    this.scene.add(cop.mesh);
    cop.syncMesh();
    return cop;
  }

  removeCops() {
    for (const cop of this.cops) this.scene.remove(cop.mesh);
    this.cops = [];
  }

  spawnGang(x, z) {
    const gunman = new Person(makePersonMesh(0x3a2a2a, this.rng.pick(SKIN_COLORS), false), 'gang');
    gunman.x = x; gunman.z = z;
    gunman.health = 80;
    gunman.speed = 3.4;
    gunman.shootTimer = this.rng.range(0.5, 1.5);
    // Flank side (v4): each gunman circles to his own side of the player
    // instead of stacking on the same spot, so the ambush surrounds Riko.
    gunman.flank = this.rng.chance(0.5) ? 1 : -1;
    this.gang.push(gunman);
    this.scene.add(gunman.mesh);
    gunman.syncMesh();
    return gunman;
  }

  removeGang() {
    for (const g of this.gang) this.scene.remove(g.mesh);
    this.gang = [];
  }

  /** A loud noise or a car nearby sends every ped in range running — and
   * v6: the mood spreads. A ped who sees a fleeing ped goes nervous, and
   * a nervous ped who hears a second scare goes panicked, so a gunshot on
   * one street makes the next street nervous before anyone there saw it. */
  scare(x, z, radius) {
    for (const ped of [...this.peds, ...this.workers, ...this.travelers, ...this.joggers]) {
      if (ped.dead) continue;
      if (dist2(x, z, ped.x, ped.z) < radius * radius) {
        ped.state = 'flee';
        ped.fleeTimer = 4;
        ped.mood = 'panicked';
        ped.moodTimer = 12;
      }
    }
    // The rumour: calm peds just outside the scare radius go nervous.
    for (const ped of this.peds) {
      if (ped.dead || ped.mood !== 'calm') continue;
      const d2 = dist2(x, z, ped.x, ped.z);
      if (d2 < (radius + 30) * (radius + 30) && d2 >= radius * radius) {
        ped.mood = 'nervous';
        ped.moodTimer = 8;
      }
    }
  }

  /** How crowded a spot is right now: the boardwalk and plaza fill at
   * dusk, the port empties at night, the ferry terminal fills when the
   * city hour is near the ferry's dusk departure. */
  crowdAt(x, z) {
    const h = this.cityHour;
    const dusk = h >= 17 && h <= 20 ? 1 : 0;
    if (z >= CITY.beachZ) return 0.6 + dusk * 0.4;
    if (Math.abs(x + 31) < 45 && Math.abs(z + 31) < 45) return 0.5 + dusk * 0.4;
    if (x >= CITY.portX - 60) return h >= 22 || h < 6 ? 0.1 : 0.5;
    if (x >= 186 && z >= 217) return h >= 17 && h <= 19 ? 0.9 : 0.3;
    return 0.4;
  }

  update(dt, player, wanted, onShotFired, time) {
    this._now = time || 0;
    // The city clock: the game's 4-minute day maps to 24 hours, starting
    // at 18:00 — the schedules read it, the crowds read it.
    this.cityHour = (18 + (this._now / 240) * 24) % 24;
    // Pedestrians, dock workers and airport travelers wander between
    // sidewalk points, or flee. Travelers use the airport wander points
    // the city builder registered, like everyone else. v6: a ped with a
    // schedule walks toward its current schedule stop; a nervous ped
    // walks faster, a panicked one runs.
    for (const ped of [...this.peds, ...this.workers, ...this.travelers]) {
      if (ped.dead) continue;
      ped.retarget -= dt;
      if (ped.moodTimer > 0) {
        ped.moodTimer -= dt;
        if (ped.moodTimer <= 0) ped.mood = 'calm';
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const away = Math.atan2(ped.x - player.x, ped.z - player.z);
        ped.yaw = away;
        ped.speed = 6;
        if (ped.fleeTimer <= 0) ped.state = 'walk';
      } else {
        const scheduled = this.scheduleTarget(ped);
        if (scheduled && (!ped.target || ped.retarget <= 0)) {
          ped.target = scheduled;
          ped.retarget = this.rng.range(10, 20);
        }
        if (!ped.target || ped.retarget <= 0 || dist2(ped.x, ped.z, ped.target.x, ped.target.z) < 4) {
          ped.target = this.rng.pick(this.wanderPoints);
          ped.retarget = this.rng.range(6, 14);
        }
        const base = ped.kind === 'worker' ? this.rng.range(1.4, 2.2) : this.rng.range(1.6, 2.8);
        ped.speed = ped.mood === 'nervous' ? base * 1.5 : base;
        ped.yaw = Math.atan2(ped.target.x - ped.x, ped.target.z - ped.z);
      }
      const nx = ped.x + Math.sin(ped.yaw) * ped.speed * dt;
      const nz = ped.z + Math.cos(ped.yaw) * ped.speed * dt;
      const solved = collideCircle(nx, nz, 0.5, this.colliders);
      ped.x = solved.x; ped.z = solved.z;
      ped.walkPhase += dt * ped.speed * 2.4;
      ped.syncMesh();
    }

    // Joggers: fast, on a loop between wander points, never stopping.
    for (const jogger of this.joggers) {
      if (jogger.dead) continue;
      if (!jogger.target || dist2(jogger.x, jogger.z, jogger.target.x, jogger.target.z) < 6) {
        jogger.target = this.rng.pick(this.wanderPoints);
      }
      jogger.yaw = Math.atan2(jogger.target.x - jogger.x, jogger.target.z - jogger.z);
      const nx = jogger.x + Math.sin(jogger.yaw) * jogger.speed * dt;
      const nz = jogger.z + Math.cos(jogger.yaw) * jogger.speed * dt;
      const solved = collideCircle(nx, nz, 0.5, this.colliders);
      jogger.x = solved.x; jogger.z = solved.z;
      jogger.walkPhase += dt * jogger.speed * 2.4;
      jogger.syncMesh();
    }

    // Cyclists: ride their road; at an intersection they may turn, and
    // they ring a bell (a wave of the arm) when the player blocks the road.
    for (const cyclist of this.cyclists) {
      if (cyclist.dead) continue;
      const { pitch, halfGrid, bound } = CITY;
      const along = cyclist.axis === 'x' ? cyclist.x : cyclist.z;
      const m = ((along % pitch) + pitch) % pitch;
      if (Math.min(m, pitch - m) < 2.2 && this.rng.chance(dt * 0.5)) {
        if (this.rng.chance(0.4)) {
          const cross = Math.round(along / pitch) * pitch;
          const newAxis = cyclist.axis === 'x' ? 'z' : 'x';
          const newDir = this.rng.chance(0.5) ? 1 : -1;
          if (newAxis === 'x') {
            cyclist.z = cross + newDir * 3.5;
            cyclist.yaw = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            cyclist.x = cross + newDir * 3.5;
            cyclist.yaw = newDir > 0 ? 0 : Math.PI;
          }
          cyclist.axis = newAxis;
          cyclist.dir = newDir;
        }
      }
      // Bell: the player standing in the lane ahead gets a wave.
      const ahead = cyclist.axis === 'x'
        ? (player.x - cyclist.x) * cyclist.dir : (player.z - cyclist.z) * cyclist.dir;
      const lateral = cyclist.axis === 'x' ? Math.abs(player.z - cyclist.z) : Math.abs(player.x - cyclist.x);
      cyclist.bellTimer -= dt;
      if (player.onFoot && ahead > 0 && ahead < 8 && lateral < 3 && cyclist.bellTimer <= 0) {
        cyclist.bellTimer = 2;
        cyclist.wavePhase += dt * 10;
      }
      if (cyclist.axis === 'x') cyclist.x += cyclist.dir * cyclist.speed * dt;
      else cyclist.z += cyclist.dir * cyclist.speed * dt;
      if (Math.abs(cyclist.x) > bound + 20 || Math.abs(cyclist.z) > bound + 20) {
        if (cyclist.axis === 'x') cyclist.x = -cyclist.dir * (bound + 18);
        else cyclist.z = -cyclist.dir * (bound + 18);
      }
      cyclist.walkPhase += dt * cyclist.speed * 2.2;
      cyclist.syncMesh();
    }

    // Waiting fares, medics, vendors and buskers stand still; buskers play.
    for (const waiter of [...this.fares, ...this.medics, ...this.vendors, ...this.buskers]) {
      if (waiter.dead) continue;
      waiter.wavePhase += dt;
      waiter.syncMesh();
    }

    // Foot police: spawn with the wanted level. Each cop runs its own
    // little brain — CHASE while the player is seen, SEARCH the
    // last-known spot when sight is lost, PATROL otherwise — and holds the
    // player to bust him only on contact.
    const wantCops = wanted >= 3 ? 2 : wanted >= 1 ? 1 : 0;
    if (this.cops.length < wantCops && player.onFoot) {
      const a = this.rng.range(0, Math.PI * 2);
      this.spawnCop(
        clamp(player.x + Math.cos(a) * 26, -CITY.bound, CITY.bound),
        clamp(player.z + Math.sin(a) * 26, -CITY.bound, CITY.bound),
      );
    }
    if (wanted === 0) this.removeCops();
    for (const cop of this.cops) {
      if (cop.dead) continue;
      const d = Math.sqrt(dist2(cop.x, cop.z, player.x, player.z));
      const state = cop.brain
        ? cop.brain.perceive(cop, player, this._now || 0, wanted, this.weatherSight ?? 1)
        : 'CHASE';
      // SEARCH: walk to the last-known spot and look around it — v6, the
      // sweep widens every time the cop loses the player.
      let target = { x: player.x, z: player.z };
      if (state === 'SEARCH' && cop.brain.lastKnown) {
        const lk = cop.brain.lastKnown;
        const r = cop.brain.searchRadius || 12;
        cop.brain.searchSweep = (cop.brain.searchSweep || 0) + dt * 0.6;
        target = {
          x: lk.x + Math.cos(cop.brain.searchSweep) * r,
          z: lk.z + Math.sin(cop.brain.searchSweep) * r,
        };
      }
      cop.yaw = Math.atan2(target.x - cop.x, target.z - cop.z);
      const arriveAt = state === 'CHASE' ? 1.6 : 2.5;
      const td = Math.sqrt(dist2(cop.x, cop.z, target.x, target.z));
      if (td > arriveAt) {
        const step = Math.min(cop.speed * dt, td - 1.2);
        const nx = cop.x + Math.sin(cop.yaw) * step;
        const nz = cop.z + Math.cos(cop.yaw) * step;
        const solved = collideCircle(nx, nz, 0.5, this.colliders);
        cop.x = solved.x; cop.z = solved.z;
        cop.walkPhase += dt * cop.speed * 2.4;
        cop.arrestTimer = 0;
      } else if (player.onFoot && d <= 1.6) {
        cop.arrestTimer += dt;
        if (cop.arrestTimer >= TUNE.bustedHoldSeconds) {
          player.busted = true;
        }
      }
      cop.syncMesh();
    }

    // Gang gunmen: close in, then stand off on their own flank and shoot.
    for (const g of this.gang) {
      if (g.dead) continue;
      const d = Math.sqrt(dist2(g.x, g.z, player.x, player.z));
      g.yaw = Math.atan2(player.x - g.x, player.z - g.z);
      if (d > 16) {
        const nx = g.x + Math.sin(g.yaw) * g.speed * dt;
        const nz = g.z + Math.cos(g.yaw) * g.speed * dt;
        const solved = collideCircle(nx, nz, 0.5, this.colliders);
        g.x = solved.x; g.z = solved.z;
        g.walkPhase += dt * g.speed * 2.4;
      } else {
        // Flank: sidestep to a point 10 m to the player's side, so the
        // gunmen spread around him instead of queuing behind each other.
        const fx = Math.cos(g.yaw) * (g.flank || 1) * 10;
        const fz = -Math.sin(g.yaw) * (g.flank || 1) * 10;
        const tx = player.x + fx, tz = player.z + fz;
        const td = Math.sqrt(dist2(g.x, g.z, tx, tz));
        if (td > 2) {
          const a = Math.atan2(tx - g.x, tz - g.z);
          const nx = g.x + Math.sin(a) * g.speed * 0.7 * dt;
          const nz = g.z + Math.cos(a) * g.speed * 0.7 * dt;
          const solved = collideCircle(nx, nz, 0.5, this.colliders);
          g.x = solved.x; g.z = solved.z;
          g.walkPhase += dt * g.speed * 1.6;
        }
        g.shootTimer -= dt;
        if (g.shootTimer <= 0 && d < 42) {
          g.shootTimer = this.rng.range(1.1, 1.9);
          onShotFired(g, d);
        }
      }
      g.syncMesh();
    }
  }
}
