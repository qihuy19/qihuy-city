// Cars, v6: the mesh factory, the player's driving physics, the traffic
// that cruises the road grid, and the police cars that hunt the player when
// the wanted level rises. A car is a small group of boxes — body, cabin,
// wheels, lights — so it reads as a car from any camera angle and costs
// little.
//
// v3 adds: two new kinds (ambulance and truck, the vehicles of the new
// missions), a per-kind handling table so a truck feels heavy and a sport
// car feels sharp, wet-road grip from the weather system, a handbrake, and
// car damage — hard crashes dent the car, and at 100 damage it stalls until
// Mara's garage repairs it.
//
// v5 adds: the motorbike (fast, sharp, leans into turns, crashes hurt the
// rider), a second police helicopter at five stars, coordinated roadblocks
// (two units hold opposite sides of the same road), four patrol units at
// five stars, and weather-fed police sight — the brains get a sight factor
// each tick, so fog genuinely blinds the chase.
//
// v6 rewrites the driving model around VEHICLE_CLASSES (one handling table
// in config.js, keyed by class, so a class retune lands everywhere at
// once): drift — holding the handbrake through a fast turn slides the rear
// out and builds a drift score that banks on a clean straight and pays out
// as cash at the next full stop, wiped by a crash; per-part damage — body,
// engine and tyres tracked separately, so a dented car still drives but a
// cooked engine loses top speed and shredded tyres (spike strips, 4+
// stars) cap the speed until repaired; a PIT spin — a patrol unit
// alongside the player at 3+ stars may swing into his rear quarter and
// spin him, costing speed, not health; and a compact class, so the
// smallest traffic cars read as a different kind of car, not a small sedan.
import * as THREE from 'three';
import { CITY, CAR_COLORS, CAR_NAMES, BIKE_NAMES, BIKE_COLORS, POLICE_COLOR, AMBULANCE_COLOR, POLICE_CALLSIGNS, TUNE, VEHICLE_CLASSES } from './config.js';
import { makeRng, clamp, clamp01, lerp, angleDelta, angleLerp, dist2, collideCircle } from './util.js';
import { PoliceBrain } from './police.js';

const WHEEL_GEO = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 10);

/** How each kind drives: acceleration, top speed, turn rate, grip factor.
 * v6: the numbers live in VEHICLE_CLASSES in config.js — this table is a
 * thin view over it, so the mesh kinds and the tuning never drift apart. */
export const HANDLING = {
  sedan: VEHICLE_CLASSES.sedan,
  compact: VEHICLE_CLASSES.compact,
  van: VEHICLE_CLASSES.van,
  sport: VEHICLE_CLASSES.sport,
  taxi: VEHICLE_CLASSES.taxi,
  police: VEHICLE_CLASSES.police,
  ambulance: VEHICLE_CLASSES.ambulance,
  truck: VEHICLE_CLASSES.truck,
  // Motorbike (v5): the quickest thing off the line and the sharpest in a
  // turn, but it grips less in the wet and a crash hurts the rider.
  bike: VEHICLE_CLASSES.bike,
};

/** Which mesh kind a traffic roll maps to: compact cars are the small
 * hatchbacks, sedans the family cars, vans the workhorses. */
const TRAFFIC_KINDS = [
  { kind: 'compact', weight: 0.22 },
  { kind: 'sedan', weight: 0.44 },
  { kind: 'van', weight: 0.16 },
  { kind: 'taxi', weight: 0.12 },
  { kind: 'sport', weight: 0.06 },
];

function pickTrafficKind(rng) {
  let roll = rng.next();
  for (const entry of TRAFFIC_KINDS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }
  return 'sedan';
}

/** Body dimensions per mesh kind, so a compact reads small and a truck
 * reads long without a separate mesh builder per kind. */
const BODY_DIMS = {
  compact: { len: 3.6, cabinLen: 1.8, cabinZ: -0.1, wheelZ: [-1.15, 1.15] },
  sedan: { len: 4.4, cabinLen: 2.1, cabinZ: -0.2, wheelZ: [-1.45, 1.45] },
  sport: { len: 4.4, cabinLen: 2.0, cabinZ: -0.3, wheelZ: [-1.45, 1.45] },
  van: { len: 5.4, cabinLen: 3.4, cabinZ: -0.3, wheelZ: [-1.45, 1.45] },
  ambulance: { len: 5.4, cabinLen: 3.4, cabinZ: -0.3, wheelZ: [-1.45, 1.45] },
  taxi: { len: 4.4, cabinLen: 2.1, cabinZ: -0.2, wheelZ: [-1.45, 1.45] },
  police: { len: 4.4, cabinLen: 2.1, cabinZ: -0.2, wheelZ: [-1.45, 1.45] },
  truck: { len: 7.2, cabinLen: 2.1, cabinZ: 1.6, wheelZ: [-2.6, -0.6, 2.4] },
};

/** Build a car mesh. kind: 'sedan' | 'compact' | 'taxi' | 'police' | 'van' |
 *  'sport' | 'ambulance' | 'truck'. */
export function makeCarMesh(color, kind) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const dims = BODY_DIMS[kind] || BODY_DIMS.sedan;
  const bodyLen = dims.len;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.72, bodyLen), bodyMat);
  body.position.y = 0.62;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.62, dims.cabinLen),
    kind === 'van' || kind === 'ambulance' ? bodyMat : glassMat,
  );
  cabin.position.set(0, 1.28, dims.cabinZ);
  group.add(cabin);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const wheels = [];
  for (const z of dims.wheelZ) {
    for (const x of [-1.0, 1.0]) {
      const wheel = new THREE.Mesh(WHEEL_GEO, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.42, z);
      group.add(wheel);
      wheels.push(wheel);
    }
  }
  // Headlights and taillights so a car reads at dusk.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const x of [-0.7, 0.7]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
    head.position.set(x, 0.62, bodyLen / 2 + 0.02);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), tailMat);
    tail.position.set(x, 0.62, -bodyLen / 2 - 0.02);
    group.add(tail);
  }
  group.userData.tailMat = tailMat; // brake lights brighten when the car stops
  if (kind === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.5), darkMat);
    bar.position.set(0, 1.66, -0.2);
    group.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(-0.28, 1.66, -0.2);
    group.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    blue.position.set(0.28, 1.66, -0.2);
    group.add(blue);
    group.userData.flashRed = red;
    group.userData.flashBlue = blue;
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe95e }));
    sign.position.set(0, 1.68, -0.2);
    group.add(sign);
    // Checker stripe along the doors.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 3.4), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
    stripe.position.set(0, 0.72, 0);
    group.add(stripe);
  }
  if (kind === 'ambulance') {
    // Red cross on the roof and both flanks, plus a red light bar.
    const crossMat = new THREE.MeshBasicMaterial({ color: 0xd21f1f });
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.3), crossMat);
    crossH.position.set(0, 1.98, -0.3);
    group.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 1.1), crossMat);
    crossV.position.set(0, 1.98, -0.3);
    group.add(crossV);
    for (const x of [-1.01, 1.01]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.7), crossMat);
      side.position.set(x, 1.25, -0.3);
      group.add(side);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.5), darkMat);
    bar.position.set(0, 1.66, 1.4);
    group.add(bar);
    const red = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 0.44), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(0, 1.66, 1.4);
    group.add(red);
    group.userData.flashRed = red;
    group.userData.flashBlue = null;
  }
  if (kind === 'truck') {
    // Flatbed with a container on the back.
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.18, 4.4),
      new THREE.MeshLambertMaterial({ color: 0x4a4a55 }),
    );
    bed.position.set(0, 1.0, -1.2);
    group.add(bed);
    const container = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.8, 3.6),
      new THREE.MeshLambertMaterial({ color: 0xc65a3a }),
    );
    container.position.set(0, 1.95, -1.2);
    group.add(container);
    group.userData.container = container;
  }
  if (kind === 'sport') {
    // A rear spoiler and a lower stance read as fast from behind.
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.4), darkMat);
    spoiler.position.set(0, 1.25, -2.1);
    group.add(spoiler);
    for (const x of [-0.8, 0.8]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.1), darkMat);
      strut.position.set(x, 1.05, -2.1);
      group.add(strut);
    }
  }
  if (kind === 'compact') {
    // A roof rack and a short hatch read as the city's smallest car.
    const rack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 1.6), darkMat);
    rack.position.set(0, 1.62, -0.1);
    group.add(rack);
  }
  group.userData.wheels = wheels;
  group.userData.bodyLen = bodyLen;
  // v5: the paint colour, so the safehouse garage can store and restore
  // a stolen car exactly as it was.
  group.userData.bodyColor = color;
  return group;
}

/** Build a motorbike mesh (v5): two wheels, a low frame, a tank, a seat
 * and handlebars — narrow, so it reads as a bike from any camera angle. */
export function makeBikeMesh(color) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const chromeMat = new THREE.MeshLambertMaterial({ color: 0xc9cdd6 });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const wheels = [];
  for (const z of [-0.85, 0.85]) {
    const wheel = new THREE.Mesh(WHEEL_GEO, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.42, z);
    group.add(wheel);
    wheels.push(wheel);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 1.7), darkMat);
  frame.position.y = 0.72;
  group.add(frame);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.7), bodyMat);
  tank.position.set(0, 0.95, 0.25);
  group.add(tank);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.7), darkMat);
  seat.position.set(0, 0.92, -0.55);
  group.add(seat);
  const bars = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), chromeMat);
  bars.position.set(0, 1.12, 0.78);
  group.add(bars);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  head.position.set(0, 0.85, 1.02);
  group.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  tail.position.set(0, 0.85, -1.02);
  group.add(tail);
  group.userData.wheels = wheels;
  group.userData.bodyLen = 2.1;
  group.userData.tailMat = null;
  group.userData.bodyColor = color;
  return group;
}

/** A spike strip (v6): a low black bar with steel teeth across the road.
 * Driving over one shreds the tyres — the car keeps rolling, but its top
 * speed is capped until Mara's garage repairs it. */
export function makeSpikeStripMesh() {
  const group = new THREE.Group();
  // Both materials are transparent so the strip can fade out as it ages
  // (the traffic update lowers opacity over the strip's lifetime).
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.14, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x14161a, transparent: true }),
  );
  base.position.y = 0.07;
  group.add(base);
  const toothMat = new THREE.MeshLambertMaterial({ color: 0xc9cdd6, transparent: true });
  for (let i = 0; i < 9; i += 1) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 4), toothMat);
    tooth.position.set(-2.8 + i * 0.7, 0.3, 0);
    group.add(tooth);
  }
  return group;
}

/** A police helicopter: body, tail boom, spinning main rotor and a
 * searchlight cone that sweeps the street below at night. */
export function makeHeliMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: POLICE_COLOR });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 4.6), bodyMat);
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.2), glassMat);
  nose.position.set(0, 0.1, 2.6);
  group.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.4), bodyMat);
  tail.position.set(0, 0.4, -4.2);
  group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.9), bodyMat);
  fin.position.set(0, 1.0, -6.0);
  group.add(fin);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 6),
    new THREE.MeshLambertMaterial({ color: 0x22242a }));
  mast.position.y = 1.1;
  group.add(mast);
  const rotor = new THREE.Group();
  rotor.position.y = 1.5;
  for (const a of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.08, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x22242a }));
    blade.rotation.y = a;
    rotor.add(blade);
  }
  group.add(rotor);
  // Red belly beacon + white searchlight housing under the nose.
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  beacon.position.set(0, -0.9, 0.5);
  group.add(beacon);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  lamp.position.set(0, -0.85, 2.2);
  group.add(lamp);
  // Searchlight beam: a translucent cone from the heli to the street.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(7, 38, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.set(0, -19, 2.2); // apex up at the lamp, base on the street
  group.add(beam);
  group.userData.rotor = rotor;
  group.userData.beam = beam;
  group.userData.beacon = beacon;
  return group;
}

/** One car in the world, whether traffic, police or the player's ride. */
export class Car {
  constructor(mesh, name, kind) {
    this.mesh = mesh;
    this.name = name;
    this.kind = kind; // 'traffic' | 'police' | 'player'
    this.bodyKind = 'sedan'; // the mesh kind: sedan | compact | van | sport | taxi | police | ambulance | truck
    this.jobKind = null; // 'taxi' | 'ambulance' | 'truck' for mission vehicles
    this.x = 0; this.z = 0; this.yaw = 0;
    this.speed = 0;
    this.steer = 0;
    this.stolen = false;
    this.dead = false;
    this.damage = 0; // 0..100; at 100 the car stalls until repaired
    // v6 per-part damage: body (cosmetic dents), engine (top speed) and
    // tyres (grip + top speed). `damage` stays the headline number — the
    // parts explain *how* it drives while hurt.
    this.parts = { body: 0, engine: 0, tyres: 0 };
    // v6 drift: points built by handbrake slides, banked on a clean
    // straight, paid out as cash at the next full stop.
    this.driftScore = 0;
    this.driftBanked = 0;
    this.driftStraightTimer = 0;
    this.drifting = false;
    // v6 PIT spin: seconds left of the spin a patrol unit inflicted.
    this.spinTimer = 0;
    // Traffic state: which road it cruises and which way.
    this.axis = 'x';
    this.dir = 1;
    this.lane = 3.5;
    this.cruiseSpeed = TUNE.trafficSpeed;
    this.flashPhase = 0;
    // Police brain (v4): one behaviour tree + utility scorer per patrol
    // unit, plus the drive target the tree's leaves write each tick.
    this.brain = null;
    this.callsign = null;
    this.driveTarget = null;
    this.driveSpeed = 0;
    this.ramming = false;
    this.pitting = false;
  }

  get pos() { return { x: this.x, z: this.z }; }

  get handling() { return HANDLING[this.bodyKind] || HANDLING.sedan; }

  get stalled() { return this.damage >= TUNE.carMaxDamage; }

  /** A motorbike has no steel cage: a crash hurts the rider, not just the bike. */
  get isBike() { return this.bodyKind === 'bike'; }

  /** Engine damage costs top speed; shredded tyres cost more. */
  get topSpeedFactor() {
    return (1 - this.parts.engine * 0.004) * (1 - this.parts.tyres * 0.006);
  }

  /** A car with shredded tyres (spike strip) is capped hard, whatever
   * its engine says — the game reads this in drivePlayer. v7: run-flat
   * tyres (the parts shop's Mk III) laugh at spike strips, so the cap
   * never bites on a car that has them fitted. */
  get speedCap() {
    if (this.parts.tyres >= 100 && !this.spikeProof) return TUNE.spikeStripSpeedCap;
    return Infinity;
  }

  /** Apply crash damage across the parts: body takes the dent, the engine
   * takes a share past a hard hit, the tyres take a share on a slide.
   * v7: fitted armour shrugs off a fraction of every hit — the factor
   * comes from the economy, via the car's armorFactor field. */
  applyCrashDamage(amount, slide) {
    amount *= (this.armorFactor ?? 1);
    this.parts.body = Math.min(100, this.parts.body + amount);
    if (amount > 12) this.parts.engine = Math.min(100, this.parts.engine + (amount - 12) * 0.5);
    if (slide) this.parts.tyres = Math.min(100, this.parts.tyres + amount * 0.3);
    this.damage = Math.min(TUNE.carMaxDamage, Math.max(this.parts.body, this.damage + amount * 0.6));
  }

  /** Full repair: headline damage and every part back to zero. */
  repairAll() {
    this.damage = 0;
    this.parts.body = 0;
    this.parts.engine = 0;
    this.parts.tyres = 0;
  }

  /** Bank the drift score: called when the car has driven straight and
   * clean for driftBankSeconds — the points move to the banked pile. */
  bankDrift() {
    if (this.driftScore <= 0) return 0;
    const banked = Math.min(TUNE.driftMaxBank, this.driftScore);
    this.driftBanked += banked;
    this.driftScore = 0;
    return banked;
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.yaw;
    const spin = this.speed * 0.016;
    for (const w of this.mesh.userData.wheels) w.rotation.x += spin;
  }
}

/** Traffic + police, owned by the game. */
export class Traffic {
  constructor(scene, colliders, rng) {
    this.scene = scene;
    this.colliders = colliders;
    this.rng = rng;
    this.cars = [];
    this.police = [];
    this.policeTimer = 0;
    this.heli = null; // police helicopter, joins at 3+ wanted stars
    this.heli2 = null; // v5: a second helicopter joins at 5 stars
    this.heliTimer = 0;
    this.jobVehicle = null; // the current mission's special vehicle
    // v5: the weather's police-sight factor (1.0 clear, 0.55 fog), set by
    // the game each frame — the brains read it through update().
    this.weatherSight = 1;
    // v6: spike strips dropped by patrol units at 4+ stars. Each is
    // { mesh, x, z, yaw, life } — they fade after 25 s so the road clears.
    this.spikeStrips = [];
    this.spikeTimer = 0;
    // v6: the helicopter spotlight pin — true while a chopper's beam is
    // on the player at night, so the game can pause wanted decay.
    this.spotlightOnPlayer = false;
  }

  spawnTraffic(count) {
    const { pitch, halfGrid } = CITY;
    for (let i = 0; i < count; i += 1) {
      const kind = pickTrafficKind(this.rng);
      const color = kind === 'taxi' ? 0xf2c230 : this.rng.pick(CAR_COLORS);
      const car = new Car(makeCarMesh(color, kind), this.rng.pick(CAR_NAMES), 'traffic');
      car.bodyKind = kind;
      const axis = this.rng.chance(0.5) ? 'x' : 'z';
      const road = this.rng.int(-halfGrid, halfGrid) * pitch;
      const along = this.rng.range(-CITY.bound, CITY.bound);
      car.axis = axis;
      car.dir = this.rng.chance(0.5) ? 1 : -1;
      car.lane = 3.5;
      car.cruiseSpeed = this.rng.range(7, 12);
      if (axis === 'x') { car.x = along; car.z = road + car.dir * car.lane; car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { car.z = along; car.x = road + car.dir * car.lane; car.yaw = car.dir > 0 ? 0 : Math.PI; }
      car.speed = car.cruiseSpeed;
      this.cars.push(car);
      this.scene.add(car.mesh);
      car.syncMesh();
    }
  }

  /** Parked cars the player can steal: a few sit along the plaza roads. */
  spawnParked(spots) {
    for (const spot of spots) {
      const kind = this.rng.chance(0.2) ? 'sport' : this.rng.chance(0.25) ? 'compact' : 'sedan';
      const car = new Car(makeCarMesh(this.rng.pick(CAR_COLORS), kind), this.rng.pick(CAR_NAMES), 'traffic');
      car.bodyKind = kind;
      car.x = spot.x; car.z = spot.z; car.yaw = spot.yaw;
      car.parked = true;
      car.speed = 0;
      this.cars.push(car);
      this.scene.add(car.mesh);
      car.syncMesh();
    }
  }

  /** Parked motorbikes the player can steal (v5): one by the airport
   * terminal, one at Sunset Plaza, one on the boardwalk. */
  spawnBikes(spots) {
    for (const spot of spots) {
      const bike = new Car(makeBikeMesh(this.rng.pick(BIKE_COLORS)), this.rng.pick(BIKE_NAMES), 'traffic');
      bike.bodyKind = 'bike';
      bike.x = spot.x; bike.z = spot.z; bike.yaw = spot.yaw;
      bike.parked = true;
      bike.speed = 0;
      this.cars.push(bike);
      this.scene.add(bike.mesh);
      bike.syncMesh();
    }
  }

  /** One motorbike at a spot, e.g. the heist getaway bike at the terminal. */
  spawnBike(x, z, yaw) {
    const bike = new Car(makeBikeMesh(this.rng.pick(BIKE_COLORS)), this.rng.pick(BIKE_NAMES), 'traffic');
    bike.bodyKind = 'bike';
    bike.x = x; bike.z = z; bike.yaw = yaw ?? 0;
    bike.parked = true;
    bike.speed = 0;
    this.cars.push(bike);
    this.scene.add(bike.mesh);
    bike.syncMesh();
    return bike;
  }

  /** Restore a car from the safehouse garage (v5): rebuild its mesh from
   * the stored name, kind, colour and damage, parked by the safehouse. */
  spawnStoredCar(stored, x, z, yaw) {
    const mesh = stored.bodyKind === 'bike'
      ? makeBikeMesh(stored.color)
      : makeCarMesh(stored.color, stored.bodyKind);
    const car = new Car(mesh, stored.name, 'traffic');
    car.bodyKind = stored.bodyKind;
    car.stolen = true;
    car.damage = stored.damage || 0;
    car.parts.body = stored.damage || 0;
    car.x = x; car.z = z; car.yaw = yaw ?? 0;
    car.parked = true;
    car.speed = 0;
    this.cars.push(car);
    this.scene.add(car.mesh);
    car.syncMesh();
    return car;
  }

  /** The current mission's special vehicle (taxi / ambulance / truck). */
  spawnJobVehicle(kind, x, z, yaw) {
    if (this.jobVehicle) {
      this.scene.remove(this.jobVehicle.mesh);
      this.cars = this.cars.filter((c) => c !== this.jobVehicle);
    }
    const color = kind === 'ambulance' ? AMBULANCE_COLOR : kind === 'truck' ? 0x3f6fb0 : 0xf2c230;
    const names = { taxi: 'Cendana Taxi', ambulance: 'Aruna Ambulance', truck: 'Samudra Truck' };
    const car = new Car(makeCarMesh(color, kind), names[kind] || kind, 'traffic');
    car.bodyKind = kind;
    car.jobKind = kind;
    car.x = x; car.z = z; car.yaw = yaw ?? 0;
    car.parked = true;
    car.speed = 0;
    this.jobVehicle = car;
    this.cars.push(car);
    this.scene.add(car.mesh);
    car.syncMesh();
    return car;
  }

  removeJobVehicle() {
    if (!this.jobVehicle) return;
    this.scene.remove(this.jobVehicle.mesh);
    this.cars = this.cars.filter((c) => c !== this.jobVehicle);
    this.jobVehicle = null;
  }

  /** Drop a spike strip across the road ahead of the player (v6): the
   * strip lies perpendicular to his heading, so he has to swerve or eat it. */
  spawnSpikeStrip(x, z, yaw) {
    const mesh = makeSpikeStripMesh();
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const strip = { mesh, x, z, yaw, life: 25 };
    this.spikeStrips.push(strip);
    return strip;
  }

  removeSpikeStrips() {
    for (const strip of this.spikeStrips) this.scene.remove(strip.mesh);
    this.spikeStrips = [];
  }

  nearestCar(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const car of this.cars) {
      if (car.dead) continue;
      const d = dist2(x, z, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  spawnPolice(x, z) {
    const sign = POLICE_CALLSIGNS[this.police.length % POLICE_CALLSIGNS.length];
    const car = new Car(makeCarMesh(POLICE_COLOR, 'police'), `${sign.unit} ${sign.name}`, 'police');
    car.bodyKind = 'police';
    car.callsign = sign;
    car.brain = new PoliceBrain(sign.unit, sign.name);
    car.x = x; car.z = z; car.yaw = 0;
    car.speed = 0;
    // Each patrol car holds its own side of the road while chasing, so the
    // pursuit reads from the player's camera instead of hiding behind him.
    car.lane = this.police.length % 2 === 0 ? 6 : -6;
    this.police.push(car);
    this.scene.add(car.mesh);
    car.syncMesh();
    return car;
  }

  removePolice() {
    for (const car of this.police) {
      if (car.brain) car.brain.reset();
      this.scene.remove(car.mesh);
    }
    this.police = [];
    this.removeSpikeStrips();
  }

  /** The helicopter: spawns above the player at 3+ stars, leaves when the
   * heat drops. It hovers high, circles slowly and keeps its nose on him. */
  spawnHeli(x, z) {
    const mesh = makeHeliMesh();
    mesh.position.set(x, 38, z);
    this.heli = { mesh, x, z, y: 38, yaw: 0, angle: 0 };
    this.scene.add(mesh);
    return this.heli;
  }

  removeHeli() {
    if (!this.heli) return;
    this.scene.remove(this.heli.mesh);
    this.heli = null;
  }

  /** v5: the second helicopter for a five-star chase — same mesh, opposite
   * side of the circle, so the two choppers bracket the player. */
  spawnHeli2(x, z) {
    const mesh = makeHeliMesh();
    mesh.position.set(x, 38, z);
    this.heli2 = { mesh, x, z, y: 38, yaw: 0, angle: Math.PI };
    this.scene.add(mesh);
    return this.heli2;
  }

  removeHeli2() {
    if (!this.heli2) return;
    this.scene.remove(this.heli2.mesh);
    this.heli2 = null;
  }

  /** Step one helicopter: rotor, beacon, beam, and the circle around the
   * player (or the staged fixed track for a screenshot pose). */
  stepHeli(heli, dt, player, isNight) {
    heli.mesh.userData.rotor.rotation.y += dt * 22;
    heli.mesh.userData.beacon.visible = Math.sin(this.heliTimer * 6) > 0;
    heli.mesh.userData.beam.visible = isNight;
    if (heli.fixed) {
      const yaw = player.car ? player.car.yaw : player.yaw;
      const tx = player.x + Math.sin(yaw) * 34 - Math.cos(yaw) * 12;
      const tz = player.z + Math.cos(yaw) * 34 + Math.sin(yaw) * 12;
      heli.x = lerp(heli.x, tx, clamp(dt * 3, 0, 1));
      heli.z = lerp(heli.z, tz, clamp(dt * 3, 0, 1));
      heli.yaw = Math.atan2(player.x - heli.x, player.z - heli.z);
      heli.mesh.position.set(heli.x, heli.y, heli.z);
      heli.mesh.rotation.y = heli.yaw;
      return;
    }
    heli.angle += dt * 0.25;
    const tx = player.x + Math.cos(heli.angle) * 26;
    const tz = player.z + Math.sin(heli.angle) * 26;
    heli.x = lerp(heli.x, tx, clamp(dt * 0.8, 0, 1));
    heli.z = lerp(heli.z, tz, clamp(dt * 0.8, 0, 1));
    heli.y = 38 + Math.sin(this.heliTimer * 0.7) * 2;
    heli.yaw = Math.atan2(player.x - heli.x, player.z - heli.z);
    heli.mesh.position.set(heli.x, heli.y, heli.z);
    heli.mesh.rotation.y = heli.yaw;
    const dx = player.x - heli.x, dz = player.z - heli.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    heli.mesh.userData.beam.rotation.z = clamp(-dx / d, -0.5, 0.5) * 0.5;
    heli.mesh.userData.beam.rotation.x = clamp(dz / d, -0.5, 0.5) * 0.5;
    // v6 spotlight pin: at night the beam tracks the player closely — if
    // the chopper is near-overhead, the beam is on him and the wanted
    // level stops decaying while it holds.
    if (isNight && d < TUNE.heliSpotlightRadius + 18) {
      heli.spotOnPlayer = d < TUNE.heliSpotlightRadius + 6;
    } else {
      heli.spotOnPlayer = false;
    }
  }

  updateHeli(dt, player, wanted, isNight) {
    if (wanted >= 3 && !this.heli) this.spawnHeli(player.x + 20, player.z - 20);
    if (wanted < 3 && this.heli) this.removeHeli();
    if (wanted >= TUNE.policeSecondHeliStars && !this.heli2) {
      this.spawnHeli2(player.x - 20, player.z + 20);
    }
    if (wanted < TUNE.policeSecondHeliStars && this.heli2) this.removeHeli2();
    this.heliTimer += dt;
    if (this.heli) this.stepHeli(this.heli, dt, player, isNight);
    if (this.heli2) this.stepHeli(this.heli2, dt, player, isNight);
    this.spotlightOnPlayer = Boolean(
      (this.heli && this.heli.spotOnPlayer) || (this.heli2 && this.heli2.spotOnPlayer),
    );
  }

  /**
   * Drive the player's car: arcade physics, building collision, car bumps.
   * `grip` (0..1, from the weather) scales acceleration and steering; the
   * handbrake (Space) locks the rear wheels for a sharp slide. Returns
   * { speed, crashed, damage, drifted, driftBanked } — crashed is true when
   * this frame's impact was hard enough to dent the car, drifted is true
   * while a handbrake slide is building points, driftBanked is the cash
   * value banked this frame (0 when nothing banked). `fx` (optional) gets
   * a skid mark on every hard handbrake slide.
   *
   * v6: per-part damage (engine damage costs top speed, tyre damage costs
   * grip), drift scoring (slide fast through a turn to build points, bank
   * them by driving straight, lose them in a crash), spike strips (tyres
   * shredded on contact, speed capped until repaired) and the PIT spin
   * (spinTimer from a patrol unit's PIT move — the car spins and loses
   * speed for a beat).
   */
  drivePlayer(car, input, dt, grip, fx) {
    const h = car.handling;
    const wet = grip ?? 1;
    const fwd = input.forward ? 1 : 0;
    const back = input.back ? 1 : 0;
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const stalled = car.stalled;
    // v6 PIT spin: while spinning, the car keeps its yaw turning and no
    // input reaches the wheels — the player rides it out.
    if (car.spinTimer > 0) {
      car.spinTimer -= dt;
      car.yaw += dt * 5.5;
      car.speed = lerp(car.speed, 0, clamp(dt * 3, 0, 1));
      const nx = car.x + Math.sin(car.yaw) * car.speed * dt;
      const nz = car.z + Math.cos(car.yaw) * car.speed * dt;
      const solved = collideCircle(nx, nz, 1.9, this.colliders);
      car.x = clamp(solved.x, -CITY.bound - 20, CITY.bound + 20);
      car.z = clamp(solved.z, -CITY.bound - 20, CITY.beachZ + 26);
      car.syncMesh();
      return { speed: Math.abs(car.speed), crashed: false, damage: car.damage, drifted: false, driftBanked: 0, spinning: true };
    }
    if (!stalled) {
      // v7: a fitted engine (tuneAccel, from the parts shop) multiplies
      // the class acceleration — a stock car never sees the factor.
      if (fwd) car.speed += h.accel * wet * car.topSpeedFactor * (car.tuneAccel || 1) * dt;
      if (back) {
        if (car.speed > 0.5) car.speed -= TUNE.carBrake * dt;
        else car.speed -= TUNE.carReverse * dt;
      }
    }
    if (!fwd && !back) car.speed -= Math.sign(car.speed) * 8 * dt;
    let drifted = false;
    if (input.handbrake && Math.abs(car.speed) > 2) {
      // Handbrake: hard decel, wide slide — steering bites twice as hard —
      // and the rear wheels leave skid marks on the asphalt.
      car.speed -= Math.sign(car.speed) * 18 * dt;
      car.yaw += steerInput * h.turn * 1.4 * dt * Math.sign(car.speed);
      // v6 drift: a fast handbrake slide through a turn builds points per
      // metre — the slide has to be fast and turning, not just sliding.
      if (Math.abs(car.speed) > TUNE.driftMinSpeed && steerInput !== 0) {
        drifted = true;
        car.drifting = true;
        car.driftScore += Math.abs(car.speed) * dt * TUNE.driftPointsPerMetre;
        car.driftStraightTimer = 0;
      }
      if (fx && Math.abs(car.speed) > 10) {
        fx.skidMark(
          car.x - Math.sin(car.yaw) * 1.6, car.z - Math.cos(car.yaw) * 1.6, car.yaw,
        );
      }
    } else if (car.drifting) {
      // The slide ended: a clean straight banks the points after a beat.
      car.driftStraightTimer += dt;
      if (car.driftStraightTimer > TUNE.driftBankSeconds) {
        car.drifting = false;
        car.driftStraightTimer = 0;
        // The points move to the banked pile — the caller pays them out
        // as cash when the car next comes to a full stop.
        car.bankDrift();
      }
    }
    if (Math.abs(car.speed) < 0.15 && !fwd && !back) car.speed = 0;
    // Top speed: the class top speed, wet-road scaling, engine damage and
    // the spike-strip cap — the lowest of them wins. v7: a fitted engine
    // and tyres (tuneTop, from the parts shop) raise the class top speed.
    const top = Math.min(
      h.maxSpeed * (0.75 + 0.25 * wet) * car.topSpeedFactor * (car.tuneTop || 1),
      car.speedCap,
    );
    car.speed = clamp(car.speed, -TUNE.carMaxReverse, top);
    const steerTarget = steerInput * (car.speed >= 0 ? 1 : -1);
    car.steer = angleLerp(car.steer, steerTarget, dt * 6);
    // Tyre damage dulls the steering: shredded tyres slide wide.
    const steerGrip = 1 - car.parts.tyres * 0.004;
    car.yaw += car.steer * h.turn * h.grip * wet * steerGrip * clamp(Math.abs(car.speed) / 10, 0, 1) * dt * (car.speed >= 0 ? 1 : -1);
    const impactSpeed = Math.abs(car.speed);
    const nx = car.x + Math.sin(car.yaw) * car.speed * dt;
    const nz = car.z + Math.cos(car.yaw) * car.speed * dt;
    const solved = collideCircle(nx, nz, 1.9, this.colliders);
    let crashed = false;
    if (Math.abs(solved.x - nx) > 0.01 || Math.abs(solved.z - nz) > 0.01) {
      if (impactSpeed > TUNE.carDamageSpeed) {
        // A bike crash dents the bike harder and hurts the rider — no cage.
        const mult = car.isBike ? 1.5 : 1;
        const amount = (impactSpeed - TUNE.carDamageSpeed) * 1.6 * mult;
        car.applyCrashDamage(amount, input.handbrake);
        crashed = true;
        // A crash wipes the unbanked drift score — no points for wrecking.
        car.driftScore = 0;
        car.drifting = false;
      }
      if (impactSpeed > 6) car.speed *= 0.4;
    }
    car.x = clamp(solved.x, -CITY.bound - 20, CITY.bound + 20);
    car.z = clamp(solved.z, -CITY.bound - 20, CITY.beachZ + 26);
    // Spike strips: driving over one shreds the tyres instantly.
    for (const strip of this.spikeStrips) {
      if (dist2(car.x, car.z, strip.x, strip.z) < 9 && car.parts.tyres < 100) {
        car.parts.tyres = 100;
        car.damage = Math.min(TUNE.carMaxDamage, car.damage + 10);
        if (fx) fx.burst(car.x, 0.6, car.z, 0xffc94f, 10, 3);
      }
    }
    // Bank the drift: a full stop with banked points pays them out — the
    // caller reads driftBanked and converts it to cash.
    let driftBanked = 0;
    if (car.driftBanked > 0 && Math.abs(car.speed) < 0.5) {
      driftBanked = car.driftBanked;
      car.driftBanked = 0;
    }
    // A bike leans into its turns — the mesh rolls with the steering, so
    // a fast corner reads as a lean instead of a flat slide.
    if (car.isBike) car.mesh.rotation.z = -car.steer * 0.32;
    else car.mesh.rotation.z = 0;
    // Bump other cars aside.
    for (const other of this.cars) {
      if (other === car || other.dead) continue;
      const d2 = dist2(car.x, car.z, other.x, other.z);
      if (d2 < 16 && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (4 - d) * 0.5;
        other.x += ((other.x - car.x) / d) * push;
        other.z += ((other.z - car.z) / d) * push;
        if (other.parked) other.parked = false;
        other.syncMesh();
      }
    }
    car.syncMesh();
    return { speed: Math.abs(car.speed), crashed, damage: car.damage, drifted, driftBanked, spinning: false };
  }

  update(dt, player, wanted, time, onRam) {
    const { pitch, halfGrid, bound } = CITY;
    // Spike strips age out: a strip fades after 25 s so the road clears.
    // The strip mesh is a Group (base + teeth), so the fade touches every
    // child material — a Group has no material of its own.
    for (let i = this.spikeStrips.length - 1; i >= 0; i -= 1) {
      const strip = this.spikeStrips[i];
      strip.life -= dt;
      const fade = clamp(strip.life / 5, 0, 1);
      for (const child of strip.mesh.children) {
        if (child.material) child.material.opacity = fade;
      }
      if (strip.life <= 0) {
        this.scene.remove(strip.mesh);
        this.spikeStrips.splice(i, 1);
      }
    }
    this.spikeTimer -= dt;
    // Traffic cruises its road; at an intersection it may turn.
    for (const car of this.cars) {
      if (car.dead || car.parked || car.kind !== 'traffic') continue;
      const along = car.axis === 'x' ? car.x : car.z;
      const m = ((along % pitch) + pitch) % pitch;
      const nearIntersection = Math.min(m, pitch - m) < 2.2;
      if (nearIntersection && this.rng.chance(dt * 0.9)) {
        // Turn onto the crossing road (or keep going).
        if (this.rng.chance(0.55)) {
          const cross = Math.round(along / pitch) * pitch;
          const newAxis = car.axis === 'x' ? 'z' : 'x';
          const newDir = this.rng.chance(0.5) ? 1 : -1;
          if (newAxis === 'x') {
            car.z = cross + newDir * car.lane;
            car.yaw = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
          } else {
            car.x = cross + newDir * car.lane;
            car.yaw = newDir > 0 ? 0 : Math.PI;
          }
          car.axis = newAxis;
          car.dir = newDir;
        }
      }
      // Slow down if a car is right ahead on the same lane.
      let targetSpeed = car.cruiseSpeed;
      for (const other of this.cars) {
        if (other === car || other.dead || other.axis !== car.axis) continue;
        const ahead = car.axis === 'x'
          ? (other.x - car.x) * car.dir : (other.z - car.z) * car.dir;
        const lateral = car.axis === 'x' ? Math.abs(other.z - car.z) : Math.abs(other.x - car.x);
        if (ahead > 0 && ahead < 9 && lateral < 3) { targetSpeed = 0; break; }
      }
      // And slow for the player standing in the road.
      if (player.onFoot) {
        const ahead = car.axis === 'x'
          ? (player.x - car.x) * car.dir : (player.z - car.z) * car.dir;
        const lateral = car.axis === 'x' ? Math.abs(player.z - car.z) : Math.abs(player.x - car.x);
        if (ahead > 0 && ahead < 10 && lateral < 3) targetSpeed = 0;
      }
      // And slow for a spike strip across its lane — traffic swerves
      // around the strips, it does not drive over them.
      for (const strip of this.spikeStrips) {
        const ahead = car.axis === 'x'
          ? (strip.x - car.x) * car.dir : (strip.z - car.z) * car.dir;
        const lateral = car.axis === 'x' ? Math.abs(strip.z - car.z) : Math.abs(strip.x - car.x);
        if (ahead > 0 && ahead < 12 && lateral < 4) { targetSpeed = Math.min(targetSpeed, 4); break; }
      }
      car.speed = lerp(car.speed, targetSpeed, clamp(dt * 2, 0, 1));
      // Brake lights: bright while the car is stopped for traffic or a
      // pedestrian, dim while it cruises.
      if (car.mesh.userData.tailMat) {
        car.mesh.userData.tailMat.color.setHex(targetSpeed === 0 ? 0xff7070 : 0xff2a2a);
      }
      if (car.axis === 'x') car.x += car.dir * car.speed * dt;
      else car.z += car.dir * car.speed * dt;
      if (Math.abs(car.x) > bound + 30 || Math.abs(car.z) > bound + 30) {
        // Wrap around to the far side so traffic never runs out.
        if (car.axis === 'x') car.x = -car.dir * (bound + 28);
        else car.z = -car.dir * (bound + 28);
      }
      car.syncMesh();
    }

    // Police: spawn up to the wanted level, chase the player, flash lights.
    // v5: four units at five stars — the full QCPD response.
    const wantCount = wanted >= 5 ? TUNE.policeMaxUnits : wanted >= 4 ? 3 : wanted >= 2 ? 2 : wanted >= 1 ? 1 : 0;
    this.policeTimer -= dt;
    if (this.police.length < wantCount && this.policeTimer <= 0) {
      this.policeTimer = 2.5;
      const a = this.rng.range(0, Math.PI * 2);
      const px = player.x + Math.cos(a) * 70;
      const pz = player.z + Math.sin(a) * 70;
      this.spawnPolice(clamp(px, -bound, bound), clamp(pz, -bound, bound));
    }
    if (wanted === 0 && this.police.length > 0) this.removePolice();
    // Police, driven by each unit's own brain: the behaviour tree picks a
    // tactic (utility-scored PURSUIT / RAMMING / ROADBLOCK / SEARCH /
    // PATROL / SPIKE / PIT) and the leaves below write the unit's drive
    // target; the movement code underneath is shared, so a ram and a
    // roadblock both steer, collide and flash the same way. `onRam` fires
    // when a ramming unit actually makes contact with the player's car.
    for (const cop of this.police) {
      const d = Math.sqrt(dist2(cop.x, cop.z, player.x, player.z));
      // Where the player is heading, for the roadblock intercept point.
      const heading = player.car ? player.car.yaw : player.yaw;
      const api = {
        pursue: (bb) => {
          // Aim at a point beside the player, not through him: the patrol
          // car pulls up alongside instead of hiding behind his car.
          const dx = player.x - cop.x, dz = player.z - cop.z;
          const len = Math.max(0.1, Math.hypot(dx, dz));
          cop.driveTarget = {
            x: player.x + (-dz / len) * (cop.lane || 0),
            z: player.z + (dx / len) * (cop.lane || 0),
          };
          cop.driveSpeed = d > 6 ? TUNE.policeSpeed : 0;
          cop.ramming = false;
          cop.pitting = false;
          return 'running';
        },
        ram: (bb) => {
          // Straight at the player's car, a touch faster than pursuit.
          cop.driveTarget = { x: player.x, z: player.z };
          cop.driveSpeed = TUNE.policeSpeed + 5;
          cop.ramming = true;
          cop.pitting = false;
          return 'running';
        },
        roadblock: (bb) => {
          // Intercept: a point ahead of the player along his heading, so
          // the unit is waiting across the road when he arrives. Close
          // in, then hold position with the lights flashing.
          const ahead = clamp(d * 0.55, 18, 60);
          let ix = player.x + Math.sin(heading) * ahead;
          let iz = player.z + Math.cos(heading) * ahead;
          // v5 coordination: when another unit is already holding a
          // roadblock, this one takes the far side of the same road —
          // the two units form a line across it instead of stacking on
          // one spot the player can drive around.
          const partner = this.police.find(
            (c) => c !== cop && c.brain && c.brain.tactic === 'ROADBLOCK',
          );
          if (partner) {
            const side = (this.police.indexOf(cop) % 2 === 0 ? 1 : -1) * 13;
            ix += Math.cos(heading) * side;
            iz -= Math.sin(heading) * side;
          }
          const id = Math.sqrt(dist2(cop.x, cop.z, ix, iz));
          cop.driveTarget = { x: ix, z: iz };
          cop.driveSpeed = id > 9 ? TUNE.policeSpeed : 0;
          cop.ramming = false;
          cop.pitting = false;
          return 'running';
        },
        search: (bb) => {
          // Sweep around the last-known spot: orbit it slowly, widening.
          const lk = bb.lastKnown || { x: player.x, z: player.z };
          cop.searchSweep = (cop.searchSweep || 0) + dt * 0.5;
          const r = 12 + Math.min(24, bb.sinceSeen * 1.5);
          cop.driveTarget = {
            x: lk.x + Math.cos(cop.searchSweep) * r,
            z: lk.z + Math.sin(cop.searchSweep) * r,
          };
          cop.driveSpeed = 16;
          cop.ramming = false;
          cop.pitting = false;
          return 'running';
        },
        patrol: () => {
          // No heat: cruise slowly toward the city centre, lights off.
          cop.driveTarget = { x: 0, z: 0 };
          cop.driveSpeed = 7;
          cop.ramming = false;
          cop.pitting = false;
          return 'running';
        },
        // v6 SPIKE leaf: drive to a point ahead of the player, drop the
        // strip across his road, then fall back to pursuit.
        spike: (bb) => {
          const ahead = clamp(d * 0.5, 22, 55);
          const ix = player.x + Math.sin(heading) * ahead;
          const iz = player.z + Math.cos(heading) * ahead;
          const id = Math.sqrt(dist2(cop.x, cop.z, ix, iz));
          if (id < 8 && this.spikeTimer <= 0) {
            this.spawnSpikeStrip(ix, iz, heading + Math.PI / 2);
            this.spikeTimer = TUNE.spikeStripCooldownSeconds;
            if (cop.brain) cop.brain.blackboard.spikeCooldownUntil = time + TUNE.spikeStripCooldownSeconds;
          }
          cop.driveTarget = { x: ix, z: iz };
          cop.driveSpeed = id > 8 ? TUNE.policeSpeed : 0;
          cop.ramming = false;
          cop.pitting = false;
          return 'running';
        },
        // v6 PIT leaf: pull alongside the player's rear quarter, then
        // swing in — the contact below spins him.
        pit: (bb) => {
          const dx = player.x - cop.x, dz = player.z - cop.z;
          const len = Math.max(0.1, Math.hypot(dx, dz));
          const side = cop.lane >= 0 ? 1 : -1;
          cop.driveTarget = {
            x: player.x + (-dz / len) * 4 * side - Math.sin(heading) * 3,
            z: player.z + (dx / len) * 4 * side - Math.cos(heading) * 3,
          };
          cop.driveSpeed = TUNE.policeSpeed + 3;
          cop.ramming = false;
          cop.pitting = true;
          return 'running';
        },
      };
      if (cop.brain) cop.brain.tick(cop, player, time, dt, api, wanted, this.weatherSight);
      else api.pursue(cop.brain ? cop.brain.blackboard : null);
      const target = cop.driveTarget || { x: player.x, z: player.z };
      const targetYaw = Math.atan2(target.x - cop.x, target.z - cop.z);
      cop.yaw += angleDelta(cop.yaw, targetYaw) * clamp(dt * 2.2, 0, 1);
      cop.speed = lerp(cop.speed, cop.driveSpeed || 0, clamp(dt * 1.5, 0, 1));
      const nx = cop.x + Math.sin(cop.yaw) * cop.speed * dt;
      const nz = cop.z + Math.cos(cop.yaw) * cop.speed * dt;
      const solved = collideCircle(nx, nz, 1.9, this.colliders);
      cop.x = solved.x; cop.z = solved.z;
      cop.flashPhase += dt * 6;
      const on = Math.sin(cop.flashPhase) > 0;
      if (cop.mesh.userData.flashRed) {
        cop.mesh.userData.flashRed.visible = on;
        if (cop.mesh.userData.flashBlue) cop.mesh.userData.flashBlue.visible = !on;
      }
      // A ramming unit that makes contact dents the player's car and
      // shakes the camera; the game handles the feedback.
      if (cop.ramming && player.car && d < 4.6 && Math.abs(cop.speed) > 6) {
        if (onRam) onRam(cop, player.car);
        cop.speed *= 0.4;
      }
      // v6 PIT contact: the unit swings into the rear quarter and spins
      // the player's car — speed lost, no health lost.
      if (cop.pitting && player.car && d < TUNE.pitMaxDist && Math.abs(cop.speed) > 8
        && player.car.spinTimer <= 0) {
        player.car.spinTimer = TUNE.pitSpinSeconds;
        cop.speed *= 0.5;
        if (onRam) onRam(cop, player.car);
      }
      // A police car ramming the player on foot knocks them down hard.
      if (player.onFoot && d < 2.6 && cop.speed > 4) {
        player.knockback(cop.x, cop.z, 14);
      }
      cop.syncMesh();
    }
  }
}
