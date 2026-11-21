// Boats and water gameplay, v8: the sea south of the beach stops being
// scenery and becomes drivable. Three docks — the Marina, the Pier and
// Ferry Point — moor boats Riko can steal or buy; the water itself gets
// physics (buoyancy on a wave field, pitch and roll from the swell,
// drag and drift that feel nothing like a car), a fuel gauge that has
// to be topped up at a dock, and smuggling runs: pick up a crate at one
// dock, run it to another against a timer, and get paid through the
// economy ledger. The police helicopter follows him over the water —
// the beam still finds him out there — but the patrol cars cannot.
//
// The water: the sea plane starts at CITY.waterZ (318) and runs south
// to the horizon. Boats live where z > SHORE_Z (306, just past the
// sand); the beach itself is walkable, the water is not — stepping off
// a boat in deep water is refused, and a boat that runs aground takes
// damage and bounces back off the sand.
//
// The boats:
//   DINGHY — a small open boat, free to steal at the Marina. Slow,
//     light, tipsy in a swell, but it is the way onto the water.
//   SPEEDBOAT — the fast boat, $800 at the Marina dock. Bought boats
//     are owned: they stay bought across saves and respawn at the
//     Marina after a sinking.
//   SMUGGLER — a low, fast hull with a covered hold, $2,500 at the
//     Pier. Twice the cargo space, so a smuggling run in it pays a
//     bonus.
//
// Smuggling runs: a crate spawns at a dock every so often; board a
// boat at that dock and the run starts automatically — cargo aboard,
// destination dock, a timer. Deliver inside the timer for the payout
// (distance pay plus a heat bonus while the wanted level is up, plus
// the Smuggler's hold bonus); run out of time and the buyer walks away.
// A run while the helicopter is overhead pays more — the risk is the
// point. Runs are the water's income, and they are the only way the
// sea pays.
//
// Fuel: every boat burns fuel while its engine runs. Empty means
// drifting — the boat keeps its way, but no throttle, until Riko
// refuels at a dock (E near a dock, $40 a tank, or free for a boat he
// just bought). A boat that runs dry mid-run can still coast in, if
// the swell is kind.
//
// Damage and sinking: hitting the shore, a pier pile or another boat
// dents the hull; at zero hull the boat sinks — Riko swims the last
// metres to the beach (placed on the sand, soaked but alive), the
// boat is gone, and a bought boat respawns at the Marina after a
// minute. The sea does not kill Riko: it takes his boat, his cargo
// and his pride.
import * as THREE from 'three';
import { CITY, TUNE } from './config.js';
import { clamp, clamp01, dist2, lerp, makeRng, money } from './util.js';

/** The water's edge: boats may not cross north of this z. The sand
 * runs to the beach at 292 and the sea plane starts at 318; 306 is
 * the wet sand where a hull grounds. */
export const SHORE_Z = 306;

/** The sea's playable bounds: east and west to the map edge, south to
 * the horizon the sea plane covers. */
export const WATER_BOUNDS = { minX: -360, maxX: 360, minZ: SHORE_Z, maxZ: 470 };

/** The wave field: three sine waves, different directions and periods,
 * summed for the swell. The same function drives the bob, the pitch,
 * the roll and the wake — the water and the boat can never disagree
 * about the sea state. */
export const WAVES = [
  { dirX: 0.3, dirZ: 1, amp: 0.35, len: 26, speed: 0.9 },
  { dirX: -0.6, dirZ: 0.8, amp: 0.22, len: 13, speed: 1.4 },
  { dirX: 1, dirZ: 0.2, amp: 0.12, len: 7, speed: 2.1 },
];

/** The three docks: where boats moor, where cargo spawns, and where
 * fuel is sold. The Marina is the home dock — bought boats respawn
 * there — and the Pier is where the Smuggler is sold. */
export const DOCKS = [
  {
    id: 'marina', label: 'Marina Docks', x: -248, z: 330,
    cargo: true, fuel: true, buyKind: 'speedboat',
  },
  {
    id: 'pier', label: 'Sunset Pier', x: 124, z: 330,
    cargo: true, fuel: true, buyKind: 'smuggler',
  },
  {
    id: 'ferry', label: 'Ferry Point Dock', x: 248, z: 330,
    cargo: true, fuel: true, buyKind: null,
  },
];

/** The boat catalogue: price (0 = stealable, never sold), top speed,
 * acceleration, turn rate, hull points, fuel tank and cargo space.
 * A Dinghy is free because it is a rowboat with an outboard bolted
 * on; a Smuggler costs because it is the only hull that can run a
 * full hold through a storm. */
export const BOAT_DEFS = {
  dinghy: {
    name: 'Dinghy', price: 0, topSpeed: 16, accel: 7, turn: 1.5,
    hull: 60, fuel: 100, cargo: 1, color: 0xd8d3c8,
    blurb: 'A small open boat — slow, tipsy, but it floats.',
  },
  speedboat: {
    name: 'Speedboat', price: 800, topSpeed: 30, accel: 13, turn: 2.1,
    hull: 100, fuel: 140, cargo: 2, color: 0xe8452c,
    blurb: 'A fast red hull with a big outboard — the bay in minutes.',
  },
  smuggler: {
    name: 'Smuggler', price: 2500, topSpeed: 34, accel: 15, turn: 2.3,
    hull: 130, fuel: 180, cargo: 4, color: 0x1e2a38,
    blurb: 'A low black hull with a covered hold — twice the cargo, twice the trouble.',
  },
};

/** A smuggling run pays by distance ($1.1 per metre of open water),
 * plus a heat bonus while the wanted level is up ($40 a star — the
 * buyer pays for the risk), plus a hold bonus for a Smuggler's cargo
 * space. The timer is the distance at a gentle cruise, plus a
 * minute's grace: a run is a race, not a crawl. */
export const SMUGGLE_PAY_PER_METRE = 1.1;
export const SMUGGLE_HEAT_BONUS_PER_STAR = 40;
export const SMUGGLE_HOLD_BONUS = 60;
export const SMUGGLE_GRACE_SECONDS = 60;

/** A tank of fuel costs this much at a dock. Refuelling is cheap on
 * purpose: the fuel gauge is a reason to visit the docks, not a tax
 * on the sea. */
export const FUEL_PRICE = 40;

/** How long a dock takes to grow a new crate after one is picked up. */
export const CARGO_RESPAWN_SECONDS = 45;

/** How long a sunk bought boat takes to respawn at the Marina. */
export const BOAT_RESPAWN_SECONDS = 60;

/** The wave height at a point on the water, at a time. The same sum
 * every caller uses, so the mesh, the bob and the wake all agree. */
export function waveHeight(x, z, t) {
  let h = 0;
  for (const w of WAVES) {
    const phase = (x * w.dirX + z * w.dirZ) / w.len + t * w.speed;
    h += w.amp * Math.sin(phase);
  }
  return h;
}

/** The wave's slope at a point — the pitch and roll of a hull sitting
 * on it. Sampled by finite difference, a metre each way. */
export function waveSlope(x, z, t) {
  const e = 1;
  const dx = (waveHeight(x + e, z, t) - waveHeight(x - e, z, t)) / (2 * e);
  const dz = (waveHeight(x, z + e, t) - waveHeight(x, z - e, t)) / (2 * e);
  return { dx, dz };
}

/** Build a boat's mesh: a hull, a bow wedge, a cabin or open benches,
 * an outboard motor, a nav light and a white rub rail. The hull's
 * colour is the boat's own, so a Speedboat reads red at a glance and
 * a Smuggler reads black. */
export function makeBoatMesh(kind) {
  const def = BOAT_DEFS[kind] || BOAT_DEFS.dinghy;
  const group = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: def.color });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
  // The hull: a long box, slightly tapered by the bow wedge.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 6.4), hullMat);
  hull.position.y = 0.45;
  group.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 4), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 0.75);
  bow.position.set(0, 0.45, 4.2);
  group.add(bow);
  // A white rub rail around the gunwale, so the hull reads at dusk.
  const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 6.6), whiteMat);
  rail.position.y = 0.95;
  group.add(rail);
  // The deck: benches on a Dinghy, a low cabin on the bigger hulls.
  if (kind === 'dinghy') {
    for (const bz of [-1.6, 0, 1.6]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.7), whiteMat);
      bench.position.set(0, 0.95, bz);
      group.add(bench);
    }
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 2.2), whiteMat);
    cabin.position.set(0, 1.4, 0.6);
    group.add(cabin);
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.6, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x9fd4e8 }),
    );
    glass.position.set(0, 1.5, 1.75);
    group.add(glass);
    if (kind === 'smuggler') {
      // The covered hold: a low black tarp over the stern, where the
      // crates go — the reason a Smuggler earns a hold bonus.
      const tarp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 2.4), darkMat);
      tarp.position.set(0, 1.2, -1.8);
      group.add(tarp);
    }
  }
  // The outboard motor on the transom, and a red-white nav light on
  // the bow so a boat reads at night.
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.5), darkMat);
  motor.position.set(0, 0.6, -3.4);
  group.add(motor);
  const navLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4040 }),
  );
  navLight.position.set(0, 1.3, 3.2);
  group.add(navLight);
  group.userData.navLight = navLight;
  return group;
}

/** One boat in the world: its mesh, its motion state, its hull and
 * fuel, and whether it is stolen, owned or for sale. */
export class Boat {
  constructor(mesh, kind, x, z, yaw) {
    const def = BOAT_DEFS[kind];
    this.mesh = mesh;
    this.kind = kind;
    this.name = def.name;
    this.x = x;
    this.z = z;
    this.yaw = yaw || 0;
    this.speed = 0;
    this.hull = def.hull;
    this.maxHull = def.hull;
    this.fuel = def.fuel;
    this.maxFuel = def.fuel;
    this.stolen = false;
    this.owned = false;
    this.forSale = def.price > 0;
    this.price = def.price;
    this.sunk = false;
    this.wakeTimer = 0;
    this.bobPhase = Math.random() * Math.PI * 2;
    this.grounded = false;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = yaw;
  }

  /** The hull as a percent, for the HUD line. */
  get hullPct() {
    return Math.max(0, Math.round((this.hull / this.maxHull) * 100));
  }

  /** The fuel as a percent, for the HUD line. */
  get fuelPct() {
    return Math.max(0, Math.round((this.fuel / this.maxFuel) * 100));
  }

  /** Sync the mesh to the motion state, riding the waves: the hull
   * bobs on the swell and pitches and rolls with its slope, so the
   * boat never sits flat on a moving sea. */
  syncMesh(t) {
    const h = waveHeight(this.x, this.z, t + this.bobPhase);
    const slope = waveSlope(this.x, this.z, t + this.bobPhase);
    this.mesh.position.set(this.x, h * 0.8, this.z);
    // The mesh's yaw is the heading; pitch and roll ride on top of it
    // through a small rotation order trick — rotate the hull around
    // its own axes after the yaw, so the lean never fights the turn.
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.rotateX(clamp(slope.dz * 0.7, -0.2, 0.2));
    this.mesh.rotateZ(clamp(-slope.dx * 0.7, -0.2, 0.2));
    // The nav light blinks, so a moored boat is findable at night.
    const nav = this.mesh.userData.navLight;
    if (nav) nav.visible = Math.sin(t * 3 + this.bobPhase) > -0.4;
  }
}

/** One smuggling run: the cargo's origin and destination docks, the
 * payout, the timer, and the boat carrying it. */
export class SmuggleRun {
  constructor(fromDock, toDock, payout, timeLeft, boatKind) {
    this.from = fromDock;
    this.to = toDock;
    this.payout = payout;
    this.timeLeft = timeLeft;
    this.totalTime = timeLeft;
    this.boatKind = boatKind;
    this.startedAt = 0;
  }

  /** The destination, as a sentence for the HUD and the message feed. */
  get destinationLabel() {
    return `${this.to.label} — $${this.payout}`;
  }
}

/** The boats system: the moored boats, the docks, the cargo, the runs,
 * the fuel and the sinking. The game owns the player; this owns the
 * sea. */
export class Boats {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.rng = makeRng(20261118);
    this.boats = [];
    // Cargo waiting at each dock: { dockId: secondsUntilCrate }.
    this.cargoTimers = {};
    for (const dock of DOCKS) this.cargoTimers[dock.id] = 0;
    // The live smuggling run, or null between runs.
    this.run = null;
    // The boat Riko is aboard, or null on land.
    this.playerBoat = null;
    // Sinking bookkeeping: bought boats that went down, and when they
    // come back at the Marina.
    this.respawnTimers = [];
    // Bought boats, by kind — the save file's memory of the fleet.
    this.ownedKinds = new Set();
    // Lifetime stats, for the pause screen and the play-test.
    this.stats = {
      runsDone: 0,
      runsFailed: 0,
      earned: 0,
      boatsBought: 0,
      boatsStolen: 0,
      boatsSunk: 0,
      bestTime: 0,
    };
    // The HUD line this system writes, cached after the first frame.
    this.lineEl = null;
    this.lastLine = '';
    // Dock marker posts, so the docks read on the water like the
    // shop's $ marker reads on the street.
    this.dockMarkers = [];
    this.spawnDocks();
    this.spawnFleet();
  }

  // ----- setup ---------------------------------------------------------------
  /** The dock markers: a tall post and a floating buoy line at each
   * dock, so a driver on the water can find the mooring from a
   * distance — the sea has no street signs. */
  spawnDocks() {
    for (const dock of DOCKS) {
      const group = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 7, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x2c313a }),
      );
      post.position.y = 3.5;
      group.add(post);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.6, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x2b6cb0 }),
      );
      sign.position.y = 7.2;
      group.add(sign);
      // A line of orange buoys marking the approach lane, so the dock
      // reads from the open water as a channel, not a point.
      for (let b = 0; b < 4; b += 1) {
        const buoy = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 8, 6),
          new THREE.MeshLambertMaterial({ color: 0xff8c42 }),
        );
        buoy.position.set(-4 + b * 2.6, 0.3, 8 + b * 3);
        group.add(buoy);
      }
      group.position.set(dock.x, 0, dock.z - 6);
      this.scene.add(group);
      this.dockMarkers.push(group);
    }
  }

  /** The starting fleet: a stealable Dinghy at the Marina, a
   * Speedboat for sale at the Marina, a stealable Dinghy at the Pier,
   * and the Smuggler for sale at the Pier. The Ferry Point dock starts
   * empty — it is a destination first, a mooring second. */
  spawnFleet() {
    this.spawnBoat('dinghy', -256, 336, Math.PI / 2, { stolen: false });
    this.spawnBoat('speedboat', -240, 338, Math.PI / 2, { forSale: true });
    this.spawnBoat('dinghy', 116, 336, Math.PI / 2, { stolen: false });
    this.spawnBoat('smuggler', 132, 338, Math.PI / 2, { forSale: true });
  }

  /** Moor one boat: build its mesh, place it, and track it. Options:
   * forSale (a shop boat, not a steal), owned (Riko bought it). */
  spawnBoat(kind, x, z, yaw, opts) {
    const mesh = makeBoatMesh(kind);
    this.scene.add(mesh);
    const boat = new Boat(mesh, kind, x, z, yaw || 0);
    if (opts) {
      if (opts.forSale !== undefined) boat.forSale = opts.forSale;
      if (opts.owned) {
        boat.owned = true;
        boat.forSale = false;
      }
      if (opts.stolen) boat.stolen = true;
    }
    this.boats.push(boat);
    return boat;
  }

  /** Remove a boat from the world and the fleet (a sinking, or a sale
   * that turns a shop boat into Riko's boat). */
  removeBoat(boat) {
    this.scene.remove(boat.mesh);
    this.boats = this.boats.filter((b) => b !== boat);
  }

  /** The nearest dock to a point, within a radius — or null out on
   * the open water, where there is nothing to tie up to. */
  nearestDock(x, z, radius) {
    let best = null;
    let bestD = (radius || 14) * (radius || 14);
    for (const dock of DOCKS) {
      const d = dist2(x, z, dock.x, dock.z);
      if (d < bestD) {
        bestD = d;
        best = dock;
      }
    }
    return best;
  }

  /** The nearest boat to a point, within a radius. */
  nearestBoat(x, z, radius) {
    let best = null;
    let bestD = (radius || 7) * (radius || 7);
    for (const boat of this.boats) {
      if (boat.sunk) continue;
      const d = dist2(x, z, boat.x, boat.z);
      if (d < bestD) {
        bestD = d;
        best = boat;
      }
    }
    return best;
  }

  // ----- boarding -------------------------------------------------------------
  /** E on foot near a boat: board it. A shop boat asks for its price
   * first — E buys it when Riko can afford it, and boards it bought;
   * a free boat boards stolen, with a star of heat like a stolen car.
   * Returns true when the keypress was spent on a boat. */
  tryBoard(game) {
    const player = game.player;
    if (!player.onFoot) return false;
    // On the beach, not in the water: a boat is boarded from the dock
    // or the wet sand, within a few metres of its hull.
    const boat = this.nearestBoat(player.x, player.z, 7);
    if (!boat) return false;
    if (boat.forSale && !boat.owned) {
      if (game.money < boat.price) {
        game.missions.say(
          `The ${boat.name} is for sale — $${boat.price}. You're $${boat.price - Math.floor(game.money)} short.`,
          4,
        );
        return true;
      }
      game.money -= boat.price;
      boat.owned = true;
      boat.forSale = false;
      this.ownedKinds.add(boat.kind);
      this.stats.boatsBought += 1;
      if (game.economy) game.economy.record('sale', -boat.price, `${boat.name} bought`);
      game.audio.purchase();
      game.missions.say(
        `You bought the ${boat.name} — $${boat.price}. It's yours now, and it respawns at the Marina if it sinks.`,
        5,
      );
    } else if (!boat.owned && !boat.stolen) {
      boat.stolen = true;
      this.stats.boatsStolen += 1;
      game.crime(1, `You stole the ${boat.name}!`);
    }
    this.boardBoat(game, boat);
    return true;
  }

  /** Put Riko aboard a boat: on foot ends, the player mesh hides, the
   * boat becomes his, and a cargo crate at this dock starts a run. */
  boardBoat(game, boat) {
    const player = game.player;
    player.boat = boat;
    this.playerBoat = boat;
    player.onFoot = false;
    player.mesh.visible = false;
    player.x = boat.x;
    player.z = boat.z;
    player.yaw = boat.yaw;
    game.camYaw = boat.yaw;
    game.missions.say(
      `Aboard the ${boat.name} — WASD to drive, E to get off at a dock. ${BOAT_DEFS[boat.kind].blurb}`,
      5,
    );
    // A crate waiting at this dock starts a smuggling run the moment
    // Riko casts off in a boat with room for it.
    const dock = this.nearestDock(boat.x, boat.z, 16);
    if (dock && !this.run) this.maybeStartRun(dock, boat);
  }

  /** E while aboard: get off — but only at a dock or on the beach.
   * In open water the keypress is refused with the reason, so Riko
   * never ends up walking on the sea. Returns true when spent. */
  tryExit(game) {
    const boat = this.playerBoat;
    if (!boat) return false;
    const player = game.player;
    const dock = this.nearestDock(boat.x, boat.z, 14);
    const nearBeach = boat.z < SHORE_Z + 12;
    if (!dock && !nearBeach) {
      game.missions.say('Too deep to get off here — head for a dock or the beach.', 3);
      return true;
    }
    // Step off onto the dock (or the sand): beside the boat, facing it.
    const spot = dock
      ? { x: dock.x, z: dock.z - 8 }
      : { x: boat.x, z: SHORE_Z - 4 };
    player.x = spot.x;
    player.z = spot.z;
    player.boat = null;
    this.playerBoat = null;
    player.onFoot = true;
    player.mesh.visible = true;
    player.syncMesh();
    game.missions.say(
      dock ? `Ashore at ${dock.label}.` : 'Ashore on the beach — shake the salt off.',
      3,
    );
    return true;
  }

  /** The E key, from the game's input handler: aboard, it is an exit;
   * on foot near a boat, it is a boarding. Anywhere else it is not a
   * boat keypress at all, and the game keeps handling it. */
  handleInteract(game) {
    if (this.playerBoat) return this.tryExit(game);
    if (game.player.onFoot) return this.tryBoard(game);
    return false;
  }

  // ----- smuggling runs -------------------------------------------------------
  /** A crate is waiting at this dock and Riko just boarded a boat
   * with cargo room: the run starts — destination, payout and timer
   * computed from the open-water distance. */
  maybeStartRun(dock, boat) {
    if (this.cargoTimers[dock.id] > 0) return;
    const others = DOCKS.filter((d) => d.id !== dock.id);
    const to = this.rng.pick(others);
    const distance = Math.sqrt(dist2(dock.x, dock.z, to.x, to.z));
    const def = BOAT_DEFS[boat.kind];
    const base = Math.round(distance * SMUGGLE_PAY_PER_METRE);
    const heat = this.game.wanted * SMUGGLE_HEAT_BONUS_PER_STAR;
    const hold = def.cargo >= 4 ? SMUGGLE_HOLD_BONUS : 0;
    const payout = base + heat + hold;
    const cruise = distance / (def.topSpeed * 0.7);
    const timeLeft = Math.round(cruise + SMUGGLE_GRACE_SECONDS);
    this.run = new SmuggleRun(dock, to, payout, timeLeft, boat.kind);
    this.run.startedAt = this.game.time;
    this.cargoTimers[dock.id] = CARGO_RESPAWN_SECONDS;
    this.game.missions.say(
      `📦 Smuggling run: crate aboard — deliver to ${to.label} in ${Math.floor(timeLeft / 60)}:${String(Math.floor(timeLeft % 60)).padStart(2, '0')} for $${payout}.`,
      6,
    );
    if (this.game.audio && this.game.audio.chime) this.game.audio.chime();
  }

  /** Deliver the crate: the payout lands through the economy, the run
   * clears, and the stats remember it. */
  completeRun() {
    const run = this.run;
    if (!run) return;
    const g = this.game;
    const elapsed = g.time - run.startedAt;
    this.stats.runsDone += 1;
    this.stats.earned += run.payout;
    this.stats.bestTime = this.stats.bestTime === 0
      ? elapsed
      : Math.min(this.stats.bestTime, elapsed);
    if (g.economy) g.economy.earn('sidejob', run.payout, `Smuggling run — ${run.from.label} to ${run.to.label}`);
    else g.money += run.payout;
    g.missions.say(
      `📦 Delivered to ${run.to.label} — +$${run.payout} in ${Math.round(elapsed)}s. The buyer is happy; the cops are not looking.`,
      5,
    );
    if (g.audio && g.audio.purchase) g.audio.purchase();
    this.run = null;
  }

  /** The timer ran out: the buyer walks away, the crate is worthless,
   * and the run clears with a failure counted. */
  failRun() {
    const run = this.run;
    if (!run) return;
    this.stats.runsFailed += 1;
    this.game.missions.say(
      `📦 Too slow — the buyer at ${run.to.label} walked away. The crate is worthless now.`,
      4,
    );
    this.run = null;
  }

  // ----- fuel -------------------------------------------------------------------
  /** Refuel at a dock: G while aboard and moored tops the tank up,
   * for the fuel price. Called from the game's G handling only when
   * the player is aboard — never in open water. */
  tryRefuel(game) {
    const boat = this.playerBoat;
    if (!boat) return false;
    const dock = this.nearestDock(boat.x, boat.z, 14);
    if (!dock || !dock.fuel) return false;
    if (boat.fuel >= boat.maxFuel * 0.98) {
      game.missions.say('Tank is already full.', 2);
      return true;
    }
    if (game.money < FUEL_PRICE) {
      game.missions.say(`Fuel is $${FUEL_PRICE} — you're short.`, 3);
      return true;
    }
    game.money -= FUEL_PRICE;
    boat.fuel = boat.maxFuel;
    if (game.economy) game.economy.record('sale', -FUEL_PRICE, 'Boat fuel');
    game.audio.chime();
    game.missions.say(`Tank full — $${FUEL_PRICE}. The ${boat.name} is ready for open water.`, 4);
    return true;
  }

  // ----- per-frame ------------------------------------------------------------
  /** One tick: cargo timers, respawns, the live run's timer and
   * delivery check, the player's boat driving, and every moored
   * boat's bob on the swell. */
  update(dt) {
    const g = this.game;
    // Cargo regrows at each dock on its own timer.
    for (const dock of DOCKS) {
      if (this.cargoTimers[dock.id] > 0) {
        this.cargoTimers[dock.id] -= dt;
      }
    }
    // A sunk bought boat comes back at the Marina after its timer.
    for (let i = this.respawnTimers.length - 1; i >= 0; i -= 1) {
      const entry = this.respawnTimers[i];
      entry.timeLeft -= dt;
      if (entry.timeLeft <= 0) {
        this.respawnTimers.splice(i, 1);
        const boat = this.spawnBoat(entry.kind, -240, 338, Math.PI / 2, { owned: true });
        g.missions.say(`Your ${boat.name} is back at the Marina — the yard fished it out.`, 4);
      }
    }
    // The live run: the timer ticks, and reaching the destination
    // dock delivers the crate.
    if (this.run && this.playerBoat) {
      this.run.timeLeft -= dt;
      const to = this.run.to;
      if (dist2(this.playerBoat.x, this.playerBoat.z, to.x, to.z) < 16 * 16) {
        this.completeRun();
      } else if (this.run.timeLeft <= 0) {
        this.failRun();
      }
    } else if (this.run && !this.playerBoat) {
      // Riko got off mid-run: the crate stays aboard the boat, and
      // the timer keeps running — the buyer does not wait on the dock.
      this.run.timeLeft -= dt;
      if (this.run.timeLeft <= 0) this.failRun();
    }
    // Drive the player's boat, or let the moored fleet bob.
    if (this.playerBoat) this.drivePlayerBoat(dt);
    for (const boat of this.boats) {
      if (boat === this.playerBoat) continue;
      boat.syncMesh(g.time);
    }
    if (this.playerBoat) this.playerBoat.syncMesh(g.time);
    this.updateHud();
  }

  /** Drive the boat Riko is aboard: arcade water physics — throttle
   * builds speed against drag, steering bites harder the faster the
   * hull moves, the swell pushes the bow around, and the shore and
   * the map edge bounce the hull back with damage. */
  drivePlayerBoat(dt) {
    const g = this.game;
    const boat = this.playerBoat;
    const input = g.input;
    const def = BOAT_DEFS[boat.kind];
    const fwd = input.forward ? 1 : 0;
    const back = input.back ? 1 : 0;
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    // Fuel: the engine drinks while the throttle is down. Empty means
    // coasting — the boat keeps its way, but no new speed.
    const hasFuel = boat.fuel > 0;
    if (fwd && hasFuel) {
      boat.fuel = Math.max(0, boat.fuel - dt * 1.6);
      boat.speed += def.accel * dt;
    } else if (back && hasFuel) {
      boat.fuel = Math.max(0, boat.fuel - dt * 1.0);
      boat.speed -= def.accel * 0.7 * dt;
    }
    if (!hasFuel && boat.fuel <= 0 && fwd) {
      // The tank just ran dry: say so once per empty tank, not once
      // per frame — the message feed would drown otherwise.
      if (!boat.dryWarned) {
        boat.dryWarned = true;
        g.missions.say('⛽ Out of fuel — drifting. Get to a dock and press E to refuel.', 5);
      }
    } else if (boat.fuel > boat.maxFuel * 0.1) {
      boat.dryWarned = false;
    }
    // Drag: water is thick — the hull bleeds speed fast when the
    // throttle lifts, and reverse tops out at a crawl.
    boat.speed -= boat.speed * 0.55 * dt;
    boat.speed = clamp(boat.speed, -6, def.topSpeed);
    // Steering: no bite at a standstill, full bite at speed, and the
    // swell shoves the bow a little — a boat never tracks dead
    // straight, the way a car does.
    const speed01 = clamp(Math.abs(boat.speed) / def.topSpeed, 0, 1);
    const swellPush = Math.sin(g.time * 0.7 + boat.bobPhase) * 0.05 * (1 - speed01);
    boat.yaw += (steer * def.turn * (0.25 + speed01 * 0.75) + swellPush) * dt
      * (boat.speed >= 0 ? 1 : -1);
    // Move: forward along the heading, plus a little sideways drift
    // from the waves — the hull slides on the swell, it does not rail.
    const drift = Math.sin(g.time * 0.5 + boat.bobPhase) * 0.4;
    boat.x += Math.sin(boat.yaw) * boat.speed * dt + Math.cos(boat.yaw) * drift * dt;
    boat.z += Math.cos(boat.yaw) * boat.speed * dt - Math.sin(boat.yaw) * drift * dt;
    // The shore: grounding dents the hull and bounces the boat back
    // into the water, so the sea keeps its edge.
    if (boat.z < SHORE_Z) {
      boat.z = SHORE_Z;
      if (boat.speed > 4) {
        this.damageHull(boat, Math.round(boat.speed), 'Ran aground — the hull scrapes the sand.');
      }
      boat.speed = -Math.abs(boat.speed) * 0.3;
      boat.yaw += Math.PI * 0.5 * dt * 8;
    }
    // The map edge: the same bounce, further out, with a message.
    if (boat.x < WATER_BOUNDS.minX || boat.x > WATER_BOUNDS.maxX) {
      boat.x = clamp(boat.x, WATER_BOUNDS.minX, WATER_BOUNDS.maxX);
      if (Math.abs(boat.speed) > 6) {
        this.damageHull(boat, 8, 'Open water — the edge of the chart. Turn back.');
      }
      boat.speed *= 0.4;
    }
    if (boat.z > WATER_BOUNDS.maxZ) {
      boat.z = WATER_BOUNDS.maxZ;
      boat.speed *= 0.4;
    }
    // The wake: white water at the stern while moving, thicker the
    // faster the hull goes — one burst per interval, not per frame.
    boat.wakeTimer -= dt;
    if (Math.abs(boat.speed) > 4 && boat.wakeTimer <= 0) {
      boat.wakeTimer = 0.12;
      const bx = boat.x - Math.sin(boat.yaw) * 3.2;
      const bz = boat.z - Math.cos(boat.yaw) * 3.2;
      g.fx.burst(bx, 0.3, bz, 0xffffff, 3, 1.2);
    }
    // The player rides the boat: his position is the hull's, so the
    // camera, the wanted decay and the helicopter all track the boat.
    g.player.x = boat.x;
    g.player.z = boat.z;
    g.player.yaw = boat.yaw;
    // The engine note: the audio engine follows the boat's speed, so
    // a Speedboat at full throttle sounds like it means it.
    if (g.audio && g.audio.engine) {
      g.audio.engine(speed01, true, false);
    }
  }

  /** Dent a hull: damage, a message, a shake — and a sinking at zero. */
  damageHull(boat, amount, message) {
    boat.hull -= amount;
    this.game.fx.addShake(0.3);
    this.game.fx.burst(boat.x, 0.5, boat.z, 0xffffff, 6, 2);
    if (message) this.game.missions.say(message, 3);
    if (boat.hull <= 0) this.sinkBoat(boat);
  }

  /** A hull at zero: the boat goes down. Riko swims the last metres
   * to the beach — placed on the sand, soaked but alive, his cargo
   * lost with the boat — and a bought boat is booked to respawn at
   * the Marina. */
  sinkBoat(boat) {
    const g = this.game;
    boat.sunk = true;
    this.stats.boatsSunk += 1;
    g.fx.burst(boat.x, 0.5, boat.z, 0xffffff, 20, 4);
    g.fx.burst(boat.x, 0.5, boat.z, 0x333333, 12, 3);
    g.fx.addShake(0.6);
    if (this.run) {
      // The cargo goes down with the boat: the run fails, and the
      // buyer hears about it from someone else.
      this.stats.runsFailed += 1;
      g.missions.say(`📦 The ${boat.name} went down — cargo lost, run failed.`, 5);
      this.run = null;
    }
    if (this.playerBoat === boat) {
      // Riko swims ashore: onto the sand north of where she sank,
      // on foot, the boat gone from under him.
      this.playerBoat = null;
      g.player.boat = null;
      g.player.onFoot = true;
      g.player.mesh.visible = true;
      g.player.x = clamp(boat.x, -300, 300);
      g.player.z = SHORE_Z - 6;
      g.player.syncMesh();
      g.missions.say(`The ${boat.name} sank! You swam ashore — soaked, but alive.`, 5);
    }
    this.removeBoat(boat);
    if (boat.owned) {
      this.respawnTimers.push({ kind: boat.kind, timeLeft: BOAT_RESPAWN_SECONDS });
    } else if (!boat.forSale) {
      // A stolen Dinghy that sinks is gone for good — the Marina
      // grows a new one after a while, so the sea never runs dry.
      this.respawnTimers.push({ kind: 'dinghy', timeLeft: BOAT_RESPAWN_SECONDS });
    }
  }

  // ----- HUD ------------------------------------------------------------------
  /** The water line: the boat, its speed and hull and fuel, the live
   * run's destination and timer — or the dock prompt when Riko is on
   * foot near a boat, so the sea advertises itself. */
  hudLine() {
    const g = this.game;
    if (this.playerBoat) {
      const boat = this.playerBoat;
      const kmh = Math.round(Math.abs(boat.speed) * 3.6);
      let line = `🛥️ ${boat.name.toUpperCase()} ${kmh} KM/H · HULL ${boat.hullPct}% · ⛽ ${boat.fuelPct}%`;
      if (this.run) {
        const t = Math.max(0, Math.ceil(this.run.timeLeft));
        const mm = Math.floor(t / 60);
        const ss = String(t % 60).padStart(2, '0');
        line += ` · 📦 → ${this.run.to.label} ${mm}:${ss} $${this.run.payout}`;
      } else if (boat.fuel <= 0) {
        line += ' · OUT OF FUEL — drift to a dock';
      }
      return line;
    }
    if (g.player && g.player.onFoot) {
      const boat = this.nearestBoat(g.player.x, g.player.z, 7);
      if (boat) {
        if (boat.forSale && !boat.owned) {
          return `🛥️ ${boat.name} FOR SALE — $${boat.price} · press E to buy and board`;
        }
        return `🛥️ ${boat.name} — press E to board`;
      }
      const dock = this.nearestDock(g.player.x, g.player.z, 10);
      if (dock) {
        const crate = this.cargoTimers[dock.id] <= 0 ? '📦 crate ready' : `📦 next crate in ${Math.ceil(this.cargoTimers[dock.id])}s`;
        return `⚓ ${dock.label} · ${crate} · fuel $${FUEL_PRICE}`;
      }
    }
    return '';
  }

  updateHud() {
    if (!this.lineEl) {
      if (typeof document === 'undefined') return;
      this.lineEl = document.getElementById('boat-line');
      if (!this.lineEl) return;
    }
    const line = this.hudLine();
    if (line === this.lastLine) return;
    this.lastLine = line;
    this.lineEl.textContent = line;
    this.lineEl.style.display = line ? 'block' : 'none';
  }

  // ----- save / load ----------------------------------------------------------
  serialize() {
    return {
      ownedKinds: [...this.ownedKinds],
      runsDone: this.stats.runsDone,
      runsFailed: this.stats.runsFailed,
      earned: this.stats.earned,
      boatsBought: this.stats.boatsBought,
      boatsStolen: this.stats.boatsStolen,
      boatsSunk: this.stats.boatsSunk,
      bestTime: Math.round(this.stats.bestTime),
    };
  }

  restore(data) {
    if (!data) return;
    this.ownedKinds = new Set(Array.isArray(data.ownedKinds) ? data.ownedKinds : []);
    this.stats.runsDone = data.runsDone || 0;
    this.stats.runsFailed = data.runsFailed || 0;
    this.stats.earned = data.earned || 0;
    this.stats.boatsBought = data.boatsBought || 0;
    this.stats.boatsStolen = data.boatsStolen || 0;
    this.stats.boatsSunk = data.boatsSunk || 0;
    this.stats.bestTime = data.bestTime || 0;
    // Owned boats come back: a bought Speedboat moors at the Marina
    // again, a bought Smuggler at the Pier — the fleet remembers.
    for (const kind of this.ownedKinds) {
      if (this.boats.some((b) => b.kind === kind && b.owned)) continue;
      if (kind === 'speedboat') {
        this.spawnBoat('speedboat', -240, 338, Math.PI / 2, { owned: true });
      } else if (kind === 'smuggler') {
        this.spawnBoat('smuggler', 132, 338, Math.PI / 2, { owned: true });
      }
    }
  }

  /** A fresh game: the fleet back to its starting moorings, no run,
   * no cargo timers, no stats — Riko on land, the sea waiting. */
  reset() {
    for (const boat of [...this.boats]) this.removeBoat(boat);
    this.playerBoat = null;
    this.run = null;
    this.respawnTimers = [];
    this.ownedKinds = new Set();
    for (const dock of DOCKS) this.cargoTimers[dock.id] = 0;
    this.stats = {
      runsDone: 0,
      runsFailed: 0,
      earned: 0,
      boatsBought: 0,
      boatsStolen: 0,
      boatsSunk: 0,
      bestTime: 0,
    };
    this.lastLine = '';
    this.spawnFleet();
    this.updateHud();
  }

  /** One line for the stats screen: what the sea paid, and what it took. */
  summaryLine() {
    const s = this.stats;
    if (s.runsDone === 0 && s.boatsBought === 0 && s.boatsStolen === 0) {
      return 'No time on the water yet — the Marina has a Dinghy with your name on it.';
    }
    const bits = [];
    if (s.runsDone > 0) bits.push(`${s.runsDone} smuggling run${s.runsDone > 1 ? 's' : ''} ($${s.earned})`);
    if (s.boatsBought > 0) bits.push(`${s.boatsBought} boat${s.boatsBought > 1 ? 's' : ''} bought`);
    if (s.boatsStolen > 0) bits.push(`${s.boatsStolen} stolen`);
    if (s.boatsSunk > 0) bits.push(`${s.boatsSunk} sunk`);
    return `Water: ${bits.join(' · ')}.`;
  }
}
