// The AI traffic director, v7: the city stops running on a fixed
// number of cars and starts breathing. A director watches the clock,
// the player and the road, and keeps the traffic density where the time
// of day says it should be — rush hour thick, deep night thin —
// spawning cars onto the roads near Riko and despawning the ones that
// drifted far behind him, so the streets always feel alive around the
// player without ever simulating the whole city at once.
//
// On top of the density loop, the director stages events: roadworks
// that narrow a road to a crawl with cones and a slow zone, and
// convoys — three trucks in line, rolling together down one road —
// that turn an ordinary drive into a moving obstacle. And it watches
// the pavements: when Riko comes down a road fast, the pedestrians
// ahead of him jaywalk across it, nervous, and scatter if he gets too
// close — the street reacts to the player instead of ignoring him.
//
// The director only ever touches traffic cars (kind 'traffic', not
// parked, not the job vehicle, not a police unit, not the player's
// car). It never despawns a car Riko is looking at, and it never
// spawns one on top of him.
import * as THREE from 'three';
import { CITY, CAR_COLORS, CAR_NAMES, TUNE } from './config.js';
import { dist2 } from './util.js';
import { Car, makeCarMesh } from './vehicles.js';

/** Rush hours, in game-clock hours (the 4-minute day starts at 18:00).
 * The morning and evening peaks are when the city is thickest; the
 * small hours are when it empties out. */
export const RUSH_HOURS = [
  { from: 7, to: 10 },
  { from: 17, to: 20 },
];

export class TrafficDirector {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    // The live density: how many cruising traffic cars are on the road
    // right now, and what the clock says it should be.
    this.targetDensity = 20;
    this.spawnTimer = 0;
    this.despawnTimer = 0;
    // The current staged event: null, or { kind: 'roadworks'|'convoy',
    // timeLeft, ... } with the event's own state.
    this.event = null;
    this.eventTimer = 45;
    // Roadworks state: the cones, and the slow zone they guard.
    this.cones = [];
    this.slowZone = null;
    // Convoy state: the three trucks, so the director can protect them
    // from despawning while the event runs.
    this.convoy = [];
    // Jaywalking: a short cooldown between crossings, so the pavements
    // do not empty themselves onto every road at once.
    this.jaywalkTimer = 0;
    // Lifetime stats, for the stats screen and the play-test.
    this.stats = { spawned: 0, despawned: 0, jaywalks: 0, convoys: 0, roadworks: 0 };
  }

  // ----- density ------------------------------------------------------------
  /** What the density should be right now, from the game clock: rush
   * hour thick, night thin, the rest of the day in between. */
  densityTargetFor(hour) {
    for (const rush of RUSH_HOURS) {
      if (hour >= rush.from && hour < rush.to) return TUNE.trafficRushTarget;
    }
    if (hour >= 23 || hour < 6) return TUNE.trafficNightTarget;
    return TUNE.trafficDayTarget;
  }

  /** The cruising traffic cars the director is allowed to manage: on
   * the road, not parked, not a job vehicle, not police, not the
   * player's car, and not a convoy truck while its event runs. */
  managedCars() {
    const traffic = this.game.traffic;
    return traffic.cars.filter((car) => (
      car.kind === 'traffic'
      && !car.dead && !car.parked && !car.jobKind
      && car !== this.game.player.car
      && !this.convoy.includes(car)
    ));
  }

  /** Spawn one traffic car onto a road near the player: pick a road
   * line within a couple of blocks, a spot along it 40–110 units away,
   * and a direction — the same placement the base game uses, just
   * anchored to the player instead of the whole map. */
  spawnNearPlayer() {
    const game = this.game;
    const traffic = game.traffic;
    const { pitch, halfGrid, bound } = CITY;
    const player = game.player;
    const kind = traffic.rng.chance(0.12) ? 'taxi' : traffic.rng.chance(0.2) ? 'van' : 'sedan';
    const color = kind === 'taxi' ? 0xf2c230 : traffic.rng.pick(CAR_COLORS);
    const car = new Car(makeCarMesh(color, kind), traffic.rng.pick(CAR_NAMES), 'traffic');
    car.bodyKind = kind;
    const axis = traffic.rng.chance(0.5) ? 'x' : 'z';
    // A road line near the player: the nearest grid line, plus or minus
    // up to two blocks, so the car appears on a road Riko can actually
    // reach instead of the far side of the city.
    const base = axis === 'x' ? player.z : player.x;
    const nearestLine = Math.round(base / pitch) * pitch;
    const road = nearestLine + traffic.rng.int(-2, 2) * pitch;
    const clampedRoad = Math.max(-halfGrid * pitch, Math.min(halfGrid * pitch, road));
    const along = (axis === 'x' ? player.x : player.z)
      + traffic.rng.range(40, 110) * (traffic.rng.chance(0.5) ? 1 : -1);
    car.axis = axis;
    car.dir = traffic.rng.chance(0.5) ? 1 : -1;
    car.lane = 3.5;
    car.cruiseSpeed = traffic.rng.range(7, 12);
    if (axis === 'x') {
      car.x = Math.max(-bound, Math.min(bound, along));
      car.z = clampedRoad + car.dir * car.lane;
      car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.z = Math.max(-bound, Math.min(bound, along));
      car.x = clampedRoad + car.dir * car.lane;
      car.yaw = car.dir > 0 ? 0 : Math.PI;
    }
    car.speed = car.cruiseSpeed;
    traffic.cars.push(car);
    this.scene.add(car.mesh);
    car.syncMesh();
    this.stats.spawned += 1;
    return car;
  }

  /** Despawn one managed car that has drifted far behind the player:
   * the farthest one past the despawn distance, so the removal is
   * never visible — it is always a car Riko cannot see. */
  despawnFar() {
    const game = this.game;
    const player = game.player;
    let farthest = null;
    let farthestD = TUNE.trafficDespawnDist * TUNE.trafficDespawnDist;
    for (const car of this.managedCars()) {
      const d = dist2(car.x, car.z, player.x, player.z);
      if (d > farthestD) {
        farthestD = d;
        farthest = car;
      }
    }
    if (!farthest) return null;
    game.traffic.cars = game.traffic.cars.filter((c) => c !== farthest);
    this.scene.remove(farthest.mesh);
    this.stats.despawned += 1;
    return farthest;
  }

  // ----- events ---------------------------------------------------------------
  /** Pick the next staged event, alternating roadworks and convoys so
   * neither repeats twice in a row. */
  pickEvent() {
    const last = this.event ? this.event.kind : null;
    const kind = last === 'roadworks' ? 'convoy' : last === 'convoy' ? 'roadworks' : 'roadworks';
    if (kind === 'roadworks') this.startRoadworks();
    else this.startConvoy();
  }

  /** Roadworks: a stretch of the road ahead of the player gets five
   * cones across the lane and a slow zone that holds traffic to a
   * crawl. The cones are real meshes; the slow zone is a rule the
   * director enforces on every car inside it, each frame. */
  startRoadworks() {
    const game = this.game;
    const player = game.player;
    const { pitch, halfGrid } = CITY;
    // The road Riko is on (or the nearest grid line to him), and a
    // stretch 30 units ahead of him along it.
    const driving = !player.onFoot && player.car;
    const heading = driving ? player.car.yaw : player.yaw;
    const axis = Math.abs(Math.sin(heading)) > Math.abs(Math.cos(heading)) ? 'x' : 'z';
    const roadCoord = axis === 'x'
      ? Math.round(player.z / pitch) * pitch
      : Math.round(player.x / pitch) * pitch;
    const along = axis === 'x' ? player.x : player.z;
    const dir = axis === 'x' ? Math.sign(Math.sin(heading)) || 1 : Math.sign(Math.cos(heading)) || 1;
    const start = along + dir * 25;
    const end = start + dir * 30;
    this.clearRoadworks();
    const coneMat = new THREE.MeshLambertMaterial({ color: 0xff8c42 });
    const coneGeo = new THREE.ConeGeometry(0.7, 1.6, 10);
    const baseMat = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const pos = start + (end - start) * t;
      const cone = new THREE.Group();
      const body = new THREE.Mesh(coneGeo, coneMat);
      body.position.y = 0.8;
      cone.add(body);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 1.1), baseMat);
      base.position.y = 0.08;
      cone.add(base);
      if (axis === 'x') cone.position.set(pos, 0, roadCoord + 2.5 - i * 1.2);
      else cone.position.set(roadCoord + 2.5 - i * 1.2, 0, pos);
      this.scene.add(cone);
      this.cones.push(cone);
    }
    this.slowZone = {
      axis, coord: roadCoord,
      from: Math.min(start, end) - 5, to: Math.max(start, end) + 5,
    };
    this.event = { kind: 'roadworks', timeLeft: 50 };
    this.stats.roadworks += 1;
    game.missions.say('🚧 Roadworks ahead — the lane narrows to a crawl. Mind the cones.', 5);
    game.audio.blip(440, 0.12, 0.2);
  }

  /** Clear the roadworks: cones out of the scene, the slow zone lifted,
   * and every car that was crawling gets its cruise speed back. */
  clearRoadworks() {
    for (const cone of this.cones) this.scene.remove(cone);
    this.cones = [];
    if (this.slowZone) {
      for (const car of this.game.traffic.cars) {
        if (car._slowCrawl) {
          car.cruiseSpeed = car._slowCrawl;
          car._slowCrawl = null;
        }
      }
    }
    this.slowZone = null;
  }

  /** A convoy: three trucks in line on a road near the player, rolling
   * together at a steady 9. They are protected from despawning while
   * the event runs, and they read as one moving obstacle — overtake
   * them, or sit behind them and wait. */
  startConvoy() {
    const game = this.game;
    const traffic = game.traffic;
    const { pitch, halfGrid, bound } = CITY;
    const player = game.player;
    const axis = traffic.rng.chance(0.5) ? 'x' : 'z';
    const road = Math.round((axis === 'x' ? player.z : player.x) / pitch) * pitch;
    const clampedRoad = Math.max(-halfGrid * pitch, Math.min(halfGrid * pitch, road));
    const dir = traffic.rng.chance(0.5) ? 1 : -1;
    const head = (axis === 'x' ? player.x : player.z) + dir * 60;
    this.convoy = [];
    for (let i = 0; i < 3; i += 1) {
      const truck = new Car(makeCarMesh(0x3f6fb0, 'truck'), 'Samudra Truck', 'traffic');
      truck.bodyKind = 'truck';
      truck.axis = axis;
      truck.dir = dir;
      truck.lane = 3.5;
      truck.cruiseSpeed = 9;
      const along = head - dir * i * 14;
      if (axis === 'x') {
        truck.x = Math.max(-bound, Math.min(bound, along));
        truck.z = clampedRoad + dir * truck.lane;
        truck.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        truck.z = Math.max(-bound, Math.min(bound, along));
        truck.x = clampedRoad + dir * truck.lane;
        truck.yaw = dir > 0 ? 0 : Math.PI;
      }
      truck.speed = 9;
      traffic.cars.push(truck);
      this.scene.add(truck.mesh);
      truck.syncMesh();
      this.convoy.push(truck);
      this.stats.spawned += 1;
    }
    this.event = { kind: 'convoy', timeLeft: 45 };
    this.stats.convoys += 1;
    game.missions.say('🚚 A convoy of three trucks is rolling down the road — overtake it, or sit behind it.', 5);
    game.audio.blip(330, 0.12, 0.2);
  }

  /** The convoy is done: the trucks go back to being ordinary traffic —
   * the director may despawn them again, and they keep their road. */
  clearConvoy() {
    this.convoy = [];
  }

  // ----- jaywalkers -----------------------------------------------------------
  /** When Riko comes down a road fast, the pedestrians ahead of him
   * stop waiting for the crossing and run across it instead — nervous,
   * quick, and right in his way. A ped that gets too close to a fast
   * car panics and flees instead. */
  updateJaywalkers(dt, game) {
    this.jaywalkTimer -= dt;
    const player = game.player;
    const speed = player.car ? Math.abs(player.car.speed) : 0;
    if (speed < 14 || this.jaywalkTimer > 0) return;
    const { pitch } = CITY;
    // The road Riko is on: the nearest grid line, and which way he is
    // driving along it.
    const heading = player.car.yaw;
    const axis = Math.abs(Math.sin(heading)) > Math.abs(Math.cos(heading)) ? 'x' : 'z';
    for (const ped of game.people.peds) {
      if (ped.dead || ped.state === 'flee') continue;
      const ahead = axis === 'x'
        ? (ped.x - player.x) * Math.sin(heading)
        : (ped.z - player.z) * Math.cos(heading);
      const lateral = axis === 'x'
        ? Math.abs(ped.z - player.z) : Math.abs(ped.x - player.x);
      if (ahead <= 0 || ahead > 26 || lateral > 12) continue;
      // Cross the road: a target on the far sidewalk, straight across
      // from where the ped stands, held for eight seconds so the
      // schedule does not pull them back mid-crossing.
      const roadCoord = Math.round((axis === 'x' ? ped.z : ped.x) / pitch) * pitch;
      const cross = axis === 'x'
        ? { x: ped.x, z: roadCoord + (ped.z > roadCoord ? 11 : -11) }
        : { x: roadCoord + (ped.x > roadCoord ? 11 : -11), z: ped.z };
      ped.target = cross;
      ped.retarget = 8;
      ped.mood = 'nervous';
      ped.moodTimer = 8;
      this.stats.jaywalks += 1;
      this.jaywalkTimer = 3;
      game.missions.say('A pedestrian darts across the road ahead of you!', 3);
      break; // one crossing at a time — the street is busy enough
    }
  }

  // ----- the frame ------------------------------------------------------------
  /** The director's tick: density, events, the slow zone, the
   * jaywalkers. Called every frame while the game is in play. */
  update(dt, game) {
    // Density: the clock sets the target; the director spawns toward
    // it and despawns away from it, one car per half-second at most, so
    // the street fills and empties gradually instead of popping.
    const hour = (game.dayNight.clockMinutes / 60) % 24;
    this.targetDensity = this.densityTargetFor(hour);
    this.spawnTimer -= dt;
    this.despawnTimer -= dt;
    const managed = this.managedCars();
    if (managed.length < this.targetDensity && this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      this.spawnNearPlayer();
    } else if (managed.length > this.targetDensity && this.despawnTimer <= 0) {
      this.despawnTimer = 0.5;
      this.despawnFar();
    }

    // Events: a new one every 45–75 seconds, alternating kinds; the
    // running one counts down and clears itself when its time is up.
    this.eventTimer -= dt;
    if (!this.event && this.eventTimer <= 0) {
      this.eventTimer = game.traffic.rng.range(45, 75);
      this.pickEvent();
    }
    if (this.event) {
      this.event.timeLeft -= dt;
      if (this.event.timeLeft <= 0) {
        if (this.event.kind === 'roadworks') this.clearRoadworks();
        if (this.event.kind === 'convoy') this.clearConvoy();
        this.event = null;
      }
    }

    // The slow zone: every car inside it crawls at 4 until it leaves,
    // then gets its cruise speed back. The original speed is stashed
    // on the car so the restore is exact.
    if (this.slowZone) {
      const zone = this.slowZone;
      for (const car of game.traffic.cars) {
        if (car.dead || car.parked || car.kind !== 'traffic') continue;
        const coord = zone.axis === 'x' ? car.z : car.x;
        const along = zone.axis === 'x' ? car.x : car.z;
        const insideZone = Math.abs(coord - zone.coord) < 8 && along >= zone.from && along <= zone.to;
        if (insideZone && !car._slowCrawl) {
          car._slowCrawl = car.cruiseSpeed;
          car.cruiseSpeed = 4;
        } else if (!insideZone && car._slowCrawl) {
          car.cruiseSpeed = car._slowCrawl;
          car._slowCrawl = null;
        }
      }
    }

    this.updateJaywalkers(dt, game);
  }

  /** The HUD's traffic line: the density the director is holding, and
   * the event running right now, if any. Empty when nothing is worth
   * saying — the line hides itself. */
  get hudLine() {
    const parts = [`TRAFFIC ${this.managedCars().length}/${this.targetDensity}`];
    if (this.event) {
      const label = this.event.kind === 'roadworks' ? '🚧 ROADWORKS' : '🚚 CONVOY';
      parts.push(`${label} ${Math.ceil(this.event.timeLeft)}s`);
    }
    return parts.join(' · ');
  }

  reset() {
    this.clearRoadworks();
    this.clearConvoy();
    this.event = null;
    this.eventTimer = 45;
    this.jaywalkTimer = 0;
    this.stats = { spawned: 0, despawned: 0, jaywalks: 0, convoys: 0, roadworks: 0 };
  }
}
