// Qihuy City itself, v6: a sun-soaked coastal grid of nine roads each way,
// built from boxes with canvas-painted window textures, palm-lined
// sidewalks, lamps, a beach and a sea to the south — plus a boardwalk
// district along the sand (deck, food stalls, a pier and a ferris wheel)
// and an industrial port on the far east edge (container stacks, gantry
// cranes and sheds). v4 adds three more districts, all procedural and
// seeded: Old Town in the north-east corner (low colourful houses, awnings,
// a market square), the marina in the south-west corner (docks, moored
// boats, anglers), and Market Row down the east edge — plus palm rows along
// the whole beach and a registry of neon signs the game pulses at dusk.
// v5 adds the airport in the north-west corner (runway, terminal, hangars,
// control tower, parked planes) and the Golden Palm casino on the
// north-east edge, and a perf pass: facades are cached by colour and the
// eighteen roads share two textures instead of cloning one per road.
//
// v6 re-architects the generator around a DISTRICT SYSTEM: every part of
// the map is built by one named builder function — buildGround, buildRoads,
// buildDowntown, buildSuburb, buildOldTown, buildCasinoBlock, buildPlaza,
// buildBoardwalk, buildPort, buildMarina, buildAirport, buildMarketRow,
// buildFerryPoint, buildParks — each owning its own props, colliders and
// wander points, so a district can be reworked without touching the rest.
// New in v6: Ferry Point in the south-east corner (a ferry terminal, a
// ticket hall, a lighthouse on the pier with a rotating lamp), a pocket
// park with a pond and benches in the suburb, a second plaza with a
// bandstand on Market Row, TRAFFIC LIGHTS at the nine central
// intersections (red / amber / green on a shared cycle, with a pole and a
// hanging gantry), bus stops with shelters along the main roads, phone
// booths, hydrants and dumpsters as street props, and seeded variety in
// every district — no two blocks share the same building set. Everything
// is generated at load from a seed, so the same seed always builds the
// same city. Returns the colliders the player, cars and pedestrians push
// against, the wander points, and the neon-sign registry.
import * as THREE from 'three';
import { CITY, PALETTE, DISTRICTS } from './config.js';
import { makeRng, clamp } from './util.js';

const BUILDING_COLORS = [
  0xe8dcc8, 0xd9b8a3, 0xc9a06c, 0xa8b8c4, 0xe0a458, 0x9fb8a0,
  0xd97b6c, 0x8fa3b8, 0xf0e0c0, 0xb98a7a, 0x7fb0a8, 0xe6c9d9,
];
const NEON_COLORS = [0xff5a7a, 0x2bb3a3, 0xf2c230, 0x8a5fd0, 0x51ff7a];
const CONTAINER_COLORS = [0xc65a3a, 0x2b6cb0, 0x3f8f4f, 0xf2c230, 0x8a5fd0, 0xd9d9d9];
const TOWER_GLASS = [0x7fa8c9, 0x5a7ba6, 0x8fb8d9, 0x6a8caf, 0xa8c4d9];
const OLD_TOWN_COLORS = [0xe87a5a, 0xf2c230, 0x2bb3a3, 0xd95f9e, 0x7ac74f, 0xe8dcc8];
const HOUSE_COLORS = [0xe8dcc8, 0xf0e0c0, 0xd9b8a3, 0xc9d9e8];
const ROOF_COLORS = [0x8a4a3a, 0x5a4a6a, 0x3a5a4a, 0x6a3a2a];
const BILLBOARD_FACES = [0xff5a7a, 0x2bb3a3, 0xf2c230, 0x8a5fd0];

/** A lit-window facade painted on a canvas, so buildings need no image files.
 * v5 perf: facades are cached by base colour — the same colour reuses one
 * canvas texture instead of painting a fresh 128x256 canvas per building. */
const facadeCache = new Map();
function facadeTexture(baseColor, rng) {
  const key = baseColor;
  if (facadeCache.has(key)) return facadeCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 256);
  // Slight vertical shade so the top reads as sunlit and the base as shade.
  const shade = ctx.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, 'rgba(255,255,255,0.16)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 128, 256);
  // Windows: most floors lit warm, the rest dark glass. The ground floor
  // keeps a darker band for the shopfronts.
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const lit = rng.chance(0.45);
      ctx.fillStyle = lit ? 'rgba(255,214,140,0.95)' : 'rgba(40,52,72,0.85)';
      ctx.fillRect(10 + col * 23, 12 + row * 24, 14, 15);
    }
  }
  // A painted shop awning along the bottom of some facades.
  if (rng.chance(0.4)) {
    ctx.fillStyle = '#' + rng.pick(NEON_COLORS).toString(16).padStart(6, '0');
    ctx.fillRect(0, 226, 128, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let x = 6; x < 128; x += 18) ctx.fillRect(x, 226, 8, 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  facadeCache.set(key, tex);
  return tex;
}

/** A taller facade for the downtown towers: more floors, smaller windows. */
function towerTexture(baseColor, rng) {
  const key = `tower-${baseColor}`;
  if (facadeCache.has(key)) return facadeCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 128, 256);
  const shade = ctx.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, 'rgba(255,255,255,0.22)');
  shade.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 16; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const lit = rng.chance(0.38);
      ctx.fillStyle = lit ? 'rgba(255,214,140,0.95)' : 'rgba(30,44,64,0.9)';
      ctx.fillRect(8 + col * 20, 8 + row * 15, 12, 9);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  facadeCache.set(key, tex);
  return tex;
}

/** The road surface: asphalt with a dashed centre line, tiled per road. */
function roadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3f4a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 200; i += 1) {
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  ctx.fillStyle = '#f5d76e';
  ctx.fillRect(62, 8, 4, 44);
  ctx.fillRect(62, 72, 4, 44);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wooden planks for the boardwalk deck, painted on a canvas. */
function boardwalkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#a9805a';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = y % 32 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, y, 128, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y, 128, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A zebra crossing: white bars painted on a canvas, one flat plane. */
function crosswalkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a3f4a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let x = 6; x < 128; x += 20) ctx.fillRect(x, 6, 10, 52);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A striped awning texture for market stalls, painted once and shared. */
function awningTexture(baseColor) {
  const key = `awning-${baseColor}`;
  if (facadeCache.has(key)) return facadeCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  for (let x = 0; x < 64; x += 16) {
    ctx.fillStyle = x % 32 === 0 ? '#' + baseColor.toString(16).padStart(6, '0') : '#f2f2f2';
    ctx.fillRect(x, 0, 16, 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  facadeCache.set(key, tex);
  return tex;
}

// ----- small prop factories --------------------------------------------------

function makePalm(rng) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 4.6, 6), trunkMat);
  trunk.position.y = 2.3;
  trunk.rotation.z = rng.range(-0.08, 0.08);
  group.add(trunk);
  for (let i = 0; i < 6; i += 1) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.9, 4.9, Math.sin(a) * 0.9);
    leaf.rotation.z = Math.cos(a) * 1.1;
    leaf.rotation.x = -Math.sin(a) * 1.1;
    group.add(leaf);
  }
  return group;
}

/** A suburban house: a small box with a pyramid roof and a garden tree. */
function makeHouse(rng, color) {
  const group = new THREE.Group();
  const w = rng.range(6, 8);
  const h = rng.range(3, 4.5);
  const d = rng.range(6, 8);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  base.position.y = h / 2;
  group.add(base);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.72, rng.range(1.8, 2.8), 4),
    new THREE.MeshLambertMaterial({ color: rng.pick(ROOF_COLORS) }),
  );
  roof.position.y = h + roof.geometry.parameters.height / 2;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  // A garden tree beside the house.
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 1.4, 5),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
  );
  trunk.position.set(w / 2 + 1.2, 0.7, d / 2 - 1);
  group.add(trunk);
  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x4a8a3a }),
  );
  crown.position.set(w / 2 + 1.2, 2.1, d / 2 - 1);
  group.add(crown);
  group.userData.footprint = { w, d };
  return group;
}

function makeLamp(lit) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6), poleMat);
  pole.position.y = 2.7;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), poleMat);
  arm.position.set(0.6, 5.35, 0);
  group.add(arm);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulbMat);
  bulb.position.set(1.25, 5.25, 0);
  group.add(bulb);
  // Only a few lamps carry a real light; the rest are just glowing bulbs.
  if (lit) {
    const light = new THREE.PointLight(0xffd9a0, 12, 18, 1.8);
    light.position.set(1.25, 5.1, 0);
    group.add(light);
  }
  return group;
}

/** A traffic light (v6): a pole, a hanging gantry arm and a three-lamp
 * head. The lamps are separate meshes so the game can flip them red /
 * amber / green on a shared cycle; the head is registered with the
 * traffic-light list the builder returns. */
function makeTrafficLight() {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.4, 6), poleMat);
  pole.position.y = 3.2;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 0.14), poleMat);
  arm.position.set(2.1, 6.3, 0);
  group.add(arm);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.9, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  );
  head.position.set(4.1, 5.4, 0);
  group.add(head);
  const lamps = {};
  const lampColors = { red: 0xff2a2a, amber: 0xffc94f, green: 0x51ff7a };
  const lampY = { red: 6.05, amber: 5.4, green: 4.75 };
  for (const [name, color] of Object.entries(lampColors)) {
    const lamp = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 }),
    );
    lamp.position.set(4.1, lampY[name], 0.26);
    group.add(lamp);
    lamps[name] = lamp;
  }
  group.userData.lamps = lamps;
  return group;
}

/** A bus stop (v6): a shelter with a bench and a timetable sign. */
function makeBusStop() {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x7fa8c9, transparent: true, opacity: 0.5 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.16, 1.8), frameMat);
  roof.position.y = 2.6;
  group.add(roof);
  const back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.4, 0.1), glassMat);
  back.position.set(0, 1.3, -0.8);
  group.add(back);
  for (const x of [-2.1, 2.1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), frameMat);
    post.position.set(x, 1.3, 0.8);
    group.add(post);
  }
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.14, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x8a6b4a }),
  );
  bench.position.set(0, 0.7, -0.5);
  group.add(bench);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.1, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x2b6cb0 }),
  );
  sign.position.set(2.4, 2.1, 0.6);
  group.add(sign);
  group.userData.footprint = { w: 4.4, d: 1.8 };
  return group;
}

/** A phone booth (v6): a glass box with a pink neon top. */
function makePhoneBooth() {
  const group = new THREE.Group();
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x7fa8c9, transparent: true, opacity: 0.45 });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2c313a });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 1.1), glassMat);
  box.position.y = 1.3;
  group.add(box);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.18, 1.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.neonPink }),
  );
  roof.position.y = 2.7;
  group.add(roof);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.16), frameMat);
  phone.position.set(-0.3, 1.5, 0.5);
  group.add(phone);
  group.userData.neonTop = roof;
  return group;
}

/** A fire hydrant (v6): a small red post with caps. */
function makeHydrant() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd94f3d });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), mat);
  body.position.y = 0.4;
  group.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mat);
  cap.position.y = 0.85;
  group.add(cap);
  for (const x of [-0.24, 0.24]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 6), mat);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(x, 0.5, 0);
    group.add(nozzle);
  }
  return group;
}

/** A dumpster (v6): a dark green steel box with a slanted lid. */
function makeDumpster(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: color || 0x2a4a3a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.2), mat);
  body.position.y = 0.6;
  group.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.2), mat);
  lid.position.set(0, 1.28, 0);
  lid.rotation.x = -0.18;
  group.add(lid);
  group.userData.footprint = { w: 2.2, d: 1.2 };
  return group;
}

/** A gantry crane over the port containers: two legs, a top beam and a hook. */
function makeCrane(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
  for (const x of [-6, 6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 26, 1.2), mat);
    leg.position.set(x, 13, 0);
    group.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.6, 1.6), mat);
  beam.position.y = 26;
  group.add(beam);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2.6), dark);
  cab.position.set(0, 24, 0);
  group.add(cab);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 5), dark);
  cable.position.set(8, 20, 0);
  group.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), new THREE.MeshLambertMaterial({ color: 0xc65a3a }));
  hook.position.set(8, 14.4, 0);
  group.add(hook);
  return group;
}

/** A moored boat at the marina: hull, mast and a bright triangular sail. */
function makeBoat(rng, hullColor, sailColor) {
  const group = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.0, 6.5),
    new THREE.MeshLambertMaterial({ color: hullColor }),
  );
  hull.position.y = 0.5;
  group.add(hull);
  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 2.2, 4),
    new THREE.MeshLambertMaterial({ color: hullColor }),
  );
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.5, 4.2);
  group.add(bow);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 7, 6),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
  );
  mast.position.y = 4.2;
  group.add(mast);
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 5.4);
  sailShape.lineTo(2.6, 0.6);
  sailShape.lineTo(0, 0);
  const sail = new THREE.Mesh(
    new THREE.ShapeGeometry(sailShape),
    new THREE.MeshLambertMaterial({ color: sailColor, side: THREE.DoubleSide }),
  );
  sail.position.set(0.1, 1.4, 0);
  group.add(sail);
  return group;
}

/** A parked plane for the airport apron (v5): fuselage, wings, tail fin
 * and engines, built from boxes and cylinders like everything else. */
function makePlane(rng, fuselageColor) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: fuselageColor });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 14, 10),
    bodyMat,
  );
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.y = 1.6;
  group.add(fuselage);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(1.5, 2.4, 10),
    new THREE.MeshLambertMaterial({ color: PALETTE.terminalGlass }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.6, 8.2);
  group.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(20, 0.24, 2.6), bodyMat);
  wing.position.set(0, 1.5, 0.5);
  group.add(wing);
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, 1.8), bodyMat);
  tailWing.position.set(0, 2.2, -6.2);
  group.add(tailWing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.2, 2.2), bodyMat);
  fin.position.set(0, 3.4, -6.4);
  group.add(fin);
  for (const x of [-2.6, 2.6]) {
    const engine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 2.2, 8),
      darkMat,
    );
    engine.rotation.x = Math.PI / 2;
    engine.position.set(x, 0.9, 1.2);
    group.add(engine);
  }
  group.userData.footprint = { w: 20, d: 15 };
  return group;
}

/** A food stall on the boardwalk: counter, striped awning, glowing sign. */
function makeStall(rng, signColor) {
  const group = new THREE.Group();
  const counter = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.4, 2),
    new THREE.MeshLambertMaterial({ color: rng.pick([0xe8dcc8, 0xd9b8a3, 0x7fb0a8]) }),
  );
  counter.position.y = 0.7;
  group.add(counter);
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.18, 2.6),
    new THREE.MeshLambertMaterial({ color: rng.pick(NEON_COLORS) }),
  );
  awning.position.y = 2.6;
  awning.rotation.x = 0.12;
  group.add(awning);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.7, 0.2),
    new THREE.MeshBasicMaterial({ color: signColor }),
  );
  sign.position.set(0, 3.2, 0);
  group.add(sign);
  for (const x of [-1.4, 1.4]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.6, 5),
      new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
    );
    post.position.set(x, 1.3, 1.1);
    group.add(post);
  }
  return group;
}

/** A ferry (v6): a boxy white-and-blue boat moored at the terminal, with
 * a ramp, a bridge and a funnel — the island's way out at dusk. */
function makeFerry() {
  const group = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x2b6cb0 });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 22), hullMat);
  hull.position.y = 1.2;
  group.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(4, 4.5, 4), hullMat);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 1.2, 12.5);
  group.add(bow);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(7.4, 2.6, 12), deckMat);
  deck.position.set(0, 3.6, -2);
  group.add(deck);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 3), deckMat);
  bridge.position.set(0, 5.6, -6.5);
  group.add(bridge);
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 3.2, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
  );
  funnel.position.set(0, 6.4, 2.5);
  group.add(funnel);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.24, 6), deckMat);
  ramp.position.set(0, 1.1, -13);
  ramp.rotation.x = 0.18;
  group.add(ramp);
  group.userData.footprint = { w: 8, d: 24 };
  return group;
}

/** A lighthouse (v6): a striped tower on the pier, a glass lamp room and
 * a rotating beam the game can sweep. The beam mesh is returned in
 * userData so the game loop can rotate it. */
function makeLighthouse() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: PALETTE.lighthouse });
  const red = new THREE.MeshLambertMaterial({ color: 0xd94f3d });
  let y = 0;
  for (let i = 0; i < 6; i += 1) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7 - i * 0.1, 1.8 - i * 0.1, 2.2, 10),
      i % 2 === 0 ? white : red,
    );
    band.position.y = y + 1.1;
    group.add(band);
    y += 2.2;
  }
  const lampRoom = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 1.8, 10),
    new THREE.MeshLambertMaterial({ color: 0x2c313a }),
  );
  lampRoom.position.y = y + 0.9;
  group.add(lampRoom);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 10, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.lighthouseLamp }),
  );
  lamp.position.y = y + 0.9;
  group.add(lamp);
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 1.6, 10),
    new THREE.MeshLambertMaterial({ color: 0x2c313a }),
  );
  cap.position.y = y + 2.6;
  group.add(cap);
  // The beam: a long translucent cone, apex at the lamp, rotating slowly.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 42, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.14,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(21, y + 0.9, 0);
  group.add(beam);
  group.userData.beam = beam;
  group.userData.lamp = lamp;
  group.userData.height = y + 3.4;
  return group;
}

/** A bandstand (v6): a raised octagonal stage with a domed roof, for the
 * second plaza on Market Row — peds gather around it at dusk. */
function makeBandstand() {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5.4, 1.0, 8),
    new THREE.MeshLambertMaterial({ color: 0xc9a06c }),
  );
  deck.position.y = 0.5;
  group.add(deck);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x2c313a }),
    );
    post.position.set(Math.cos(a) * 4.4, 2.6, Math.sin(a) * 4.4);
    group.add(post);
  }
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(5.6, 2.4, 8),
    new THREE.MeshLambertMaterial({ color: 0xd95f9e }),
  );
  roof.position.y = 5.2;
  group.add(roof);
  group.userData.footprint = { w: 11, d: 11 };
  return group;
}

// ----- district builders -----------------------------------------------------
// Each builder receives the shared context { scene, rng, colliders,
// wanderPoints, registerNeon, addCollider, addWander } and builds one
// district. The main buildCity runs them in order, so a district can be
// reworked, moved or deleted without touching the others.

function buildGround(ctx) {
  const { scene, colliders } = ctx;
  const { bound } = CITY;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(bound * 2 + 220, bound * 2 + 220),
    new THREE.MeshLambertMaterial({ color: PALETTE.grass }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 40);
  scene.add(ground);
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(bound * 2 + 220, 40),
    new THREE.MeshLambertMaterial({ color: PALETTE.sand }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, CITY.beachZ + 8);
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(bound * 2 + 220, 160),
    new THREE.MeshLambertMaterial({ color: PALETTE.sea }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, CITY.waterZ + 80);
  scene.add(sea);
  return colliders;
}

function buildRoads(ctx) {
  const { scene, rng } = ctx;
  const { pitch, halfGrid, roadHalf, bound } = CITY;
  const roadLength = bound * 2 + roadHalf * 2;
  const roadTexNS = roadTexture();
  roadTexNS.repeat.set(1, roadLength / 14);
  const roadTexEW = roadTexture();
  roadTexEW.repeat.set(roadLength / 14, 1);
  const roadMatNS = new THREE.MeshLambertMaterial({ map: roadTexNS });
  const roadMatEW = new THREE.MeshLambertMaterial({ map: roadTexEW });
  for (let i = -halfGrid; i <= halfGrid; i += 1) {
    const c = i * pitch;
    const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(roadHalf * 2, roadLength), roadMatNS);
    roadNS.rotation.x = -Math.PI / 2;
    roadNS.position.set(c, 0.01, 0);
    scene.add(roadNS);
    const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(roadLength, roadHalf * 2), roadMatEW);
    roadEW.rotation.x = -Math.PI / 2;
    roadEW.position.set(0, 0.01, c);
    scene.add(roadEW);
  }
  // Zebra crossings at the nine central intersections, alternating direction.
  const crossTex = crosswalkTexture();
  for (const ix of [-2, 0, 2]) {
    for (const jz of [-2, 0, 2]) {
      const crossing = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 7),
        new THREE.MeshLambertMaterial({ map: crossTex }),
      );
      crossing.rotation.x = -Math.PI / 2;
      crossing.rotation.z = (ix + jz) % 2 === 0 ? 0 : Math.PI / 2;
      crossing.position.set(ix * pitch, 0.02, jz * pitch);
      scene.add(crossing);
    }
  }
  // Traffic lights (v6): one at each of the nine central intersections,
  // on the north-east corner, arms reaching over the crossing. The heads
  // are collected so the game can flip them on a shared cycle.
  const lights = [];
  for (const ix of [-2, 0, 2]) {
    for (const jz of [-2, 0, 2]) {
      const light = makeTrafficLight();
      light.position.set(ix * pitch + 9, 0, jz * pitch + 9);
      light.rotation.y = rng.range(0, Math.PI * 2);
      scene.add(light);
      lights.push(light);
      ctx.addCollider(ix * pitch + 9, jz * pitch + 9, 0.3, 0.3);
    }
  }
  ctx.trafficLights = lights;
}

/** Generic blocks: sidewalks, then one to four buildings each, with alleys
 * between. Seeded variety: each block rolls its own building set — a tall
 * tower, a row of shops, a pair of mid-rises — so no two blocks match. */
function buildGenericBlock(ctx, cx, cz) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const { blockHalf } = CITY;
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(blockHalf * 2 + 6, blockHalf * 2 + 6),
    sidewalkMat,
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  // The block's flavour: 'tower' (one tall slab), 'shops' (low row with
  // neon), 'midrise' (two or three mid buildings), 'courtyard' (low ring
  // around an open middle with a palm).
  const flavour = rng.pick(['tower', 'shops', 'midrise', 'midrise', 'courtyard']);
  const slots = [
    { x: cx - 9, z: cz - 9 }, { x: cx + 9, z: cz - 9 },
    { x: cx - 9, z: cz + 9 }, { x: cx + 9, z: cz + 9 },
    { x: cx, z: cz },
  ];
  const placeBuilding = (slot, w, d, h, color, tower) => {
    const tex = tower ? towerTexture(color, rng) : facadeTexture(color, rng);
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    building.position.set(slot.x, h / 2, slot.z);
    scene.add(building);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
      new THREE.MeshLambertMaterial({ color: rng.pick([0x5a4a3a, 0x6a5a4a, 0x4a5a6a, 0x7a6a5a]) }),
    );
    roof.position.set(slot.x, h + 0.25, slot.z);
    scene.add(roof);
    // Rooftop variety: some towers get a penthouse box, some an antenna.
    if (rng.chance(0.35)) {
      const pentH = rng.range(2, 4);
      const pent = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.45, pentH, d * 0.45),
        new THREE.MeshLambertMaterial({ color: rng.pick(BUILDING_COLORS) }),
      );
      pent.position.set(slot.x, h + 0.5 + pentH / 2, slot.z);
      scene.add(pent);
    } else if (rng.chance(0.3)) {
      const mastH = rng.range(4, 8);
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.12, mastH, 5),
        new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
      );
      mast.position.set(slot.x, h + 0.5 + mastH / 2, slot.z);
      scene.add(mast);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xff4040 }),
      );
      tip.position.set(slot.x, h + 0.5 + mastH + 0.2, slot.z);
      scene.add(tip);
    }
    if (h > 24 && rng.chance(0.5)) {
      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.5, 1.1, 0.2),
        new THREE.MeshBasicMaterial({ color: rng.pick(NEON_COLORS) }),
      );
      neon.position.set(slot.x, h * 0.72, slot.z + d / 2 + 0.15);
      scene.add(neon);
      registerNeon(neon);
    }
    addCollider(slot.x, slot.z, w / 2 + 0.3, d / 2 + 0.3);
  };
  if (flavour === 'tower') {
    const slot = slots[rng.int(0, 4)];
    placeBuilding(slot, rng.range(12, 16), rng.range(12, 16), rng.range(28, 44),
      rng.pick(BUILDING_COLORS), true);
  } else if (flavour === 'shops') {
    for (let s = 0; s < 3; s += 1) {
      const slot = slots[s];
      placeBuilding(slot, rng.range(9, 12), rng.range(9, 12), rng.range(5, 8),
        rng.pick(BUILDING_COLORS), false);
    }
  } else if (flavour === 'courtyard') {
    for (let s = 0; s < 4; s += 1) {
      placeBuilding(slots[s], rng.range(7, 9), rng.range(7, 9), rng.range(5, 9),
        rng.pick(BUILDING_COLORS), false);
    }
    const palm = makePalm(rng);
    palm.position.set(cx, 0, cz);
    scene.add(palm);
    addCollider(cx, cz, 0.5, 0.5);
  } else {
    const count = rng.int(1, 3);
    for (let s = 0; s < count; s += 1) {
      const slot = slots[rng.int(0, slots.length - 1)];
      placeBuilding(slot, rng.range(9, 15), rng.range(9, 15),
        rng.range(7, rng.chance(0.22) ? 42 : 20), rng.pick(BUILDING_COLORS), false);
    }
  }
  // Palms and lamps along the block corners.
  for (let k = 0; k < 2; k += 1) {
    const palm = makePalm(rng);
    palm.position.set(cx + rng.range(-18, 18), 0, cz + rng.range(-18, 18));
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  addWander(cx + 22, cz);
  addWander(cx - 22, cz);
}

function buildDowntownBlock(ctx, cx, cz) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  // Glass towers, 26–55 high, neon crowns and rooftop beacons.
  for (const [ox, oz] of [[-8, -8], [8, 8], [8, -8], [-8, 8]]) {
    if (!rng.chance(0.62)) continue;
    const w = rng.range(11, 15);
    const d = rng.range(11, 15);
    const h = rng.range(26, 55);
    const tex = towerTexture(rng.pick(TOWER_GLASS), rng);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex }));
    tower.position.set(cx + ox, h / 2, cz + oz);
    scene.add(tower);
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.7, 1.4, 0.3),
      new THREE.MeshBasicMaterial({ color: rng.pick(NEON_COLORS) }),
    );
    crown.position.set(cx + ox, h - 2, cz + oz + d / 2 + 0.15);
    scene.add(crown);
    registerNeon(crown);
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xff4040 }),
    );
    beacon.position.set(cx + ox, h + 0.8, cz + oz);
    scene.add(beacon);
    addCollider(cx + ox, cz + oz, w / 2 + 0.3, d / 2 + 0.3);
  }
  addWander(cx + 22, cz);
  addWander(cx - 22, cz);
}

function buildSuburbBlock(ctx, cx, cz) {
  const { scene, rng, addCollider, addWander } = ctx;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: 0x6a9a52 }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  // Two to four houses per block, each with a roof and a garden tree.
  const spots = [
    { x: cx - 10, z: cz - 8 }, { x: cx + 10, z: cz - 8 },
    { x: cx - 10, z: cz + 8 }, { x: cx + 10, z: cz + 8 },
  ];
  for (const spot of spots) {
    if (!rng.chance(0.75)) continue;
    const house = makeHouse(rng, rng.pick(HOUSE_COLORS));
    house.position.set(spot.x, 0, spot.z);
    house.rotation.y = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
    scene.add(house);
    const fp = house.userData.footprint;
    addCollider(spot.x, spot.z, fp.w / 2 + 0.3, fp.d / 2 + 0.3);
  }
  const palm = makePalm(rng);
  palm.position.set(cx, 0, cz);
  scene.add(palm);
  addCollider(cx, cz, 0.5, 0.5);
  addWander(cx + 22, cz);
  addWander(cx - 22, cz);
}

function buildOldTownBlock(ctx, cx, cz) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: 0xc9a06c }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  const spots = [
    { x: cx - 10, z: cz - 8 }, { x: cx + 10, z: cz - 8 },
    { x: cx - 10, z: cz + 8 }, { x: cx + 10, z: cz + 8 },
  ];
  for (const spot of spots) {
    if (!rng.chance(0.8)) continue;
    const w = rng.range(7, 10);
    const h = rng.range(4, 7);
    const d = rng.range(7, 10);
    const tex = facadeTexture(rng.pick(OLD_TOWN_COLORS), rng);
    const house = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    house.position.set(spot.x, h / 2, spot.z);
    scene.add(house);
    // Striped awning over the door, in a neon colour.
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.7, 0.16, 1.8),
      new THREE.MeshBasicMaterial({ color: rng.pick(NEON_COLORS) }),
    );
    awning.position.set(spot.x, 2.6, spot.z + d / 2 + 0.7);
    awning.rotation.x = 0.18;
    scene.add(awning);
    registerNeon(awning);
    addCollider(spot.x, spot.z, w / 2 + 0.3, d / 2 + 0.3);
  }
  // One market stall in the middle of the block.
  if (rng.chance(0.7)) {
    const stall = makeStall(rng, rng.pick(NEON_COLORS));
    stall.position.set(cx, 0, cz);
    scene.add(stall);
    registerNeon(stall.children[2]);
    addCollider(cx, cz, 2, 1.4);
  }
  addWander(cx + 22, cz);
  addWander(cx - 22, cz);
}

function buildCasinoBlock(ctx, cx, cz) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: 0x8a6a3a }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  const casino = new THREE.Mesh(
    new THREE.BoxGeometry(24, 13, 18),
    new THREE.MeshLambertMaterial({ color: 0xc9a227 }),
  );
  casino.position.set(cx, 6.5, cz);
  scene.add(casino);
  const casinoSign = new THREE.Mesh(
    new THREE.BoxGeometry(18, 2.2, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.neonPink }),
  );
  casinoSign.position.set(cx, 13.8, cz + 9.2);
  scene.add(casinoSign);
  registerNeon(casinoSign);
  const casinoRoof = new THREE.Mesh(
    new THREE.BoxGeometry(25, 0.8, 19),
    new THREE.MeshLambertMaterial({ color: 0x5a3a6a }),
  );
  casinoRoof.position.set(cx, 13.4, cz);
  scene.add(casinoRoof);
  // A valet forecourt: a striped canopy over the entrance drive.
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.3, 6),
    new THREE.MeshLambertMaterial({ color: 0x5a3a6a }),
  );
  canopy.position.set(cx, 4.2, cz + 13);
  scene.add(canopy);
  for (const x of [-4.5, 4.5]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 4.2, 6),
      new THREE.MeshLambertMaterial({ color: 0x2c313a }),
    );
    post.position.set(cx + x, 2.1, cz + 13);
    scene.add(post);
  }
  addCollider(cx, cz, 12.5, 9.5);
  for (let p = 0; p < 3; p += 1) {
    const palm = makePalm(rng);
    palm.position.set(cx - 14 + p * 14, 0, cz + 13);
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  addWander(cx - 16, cz + 14);
  addWander(cx + 16, cz + 14);
}

function buildPlaza(ctx, cx, cz) {
  const { scene, rng, addCollider, addWander } = ctx;
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 8, 1.1, 24),
    new THREE.MeshLambertMaterial({ color: 0x7fb0c9 }),
  );
  plaza.position.set(cx, 0.55, cz);
  scene.add(plaza);
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.8, 3.4, 8),
    new THREE.MeshLambertMaterial({ color: 0xdfe9ee }),
  );
  jet.position.set(cx, 2.2, cz);
  scene.add(jet);
  addCollider(cx, cz, 8, 8);
  for (let p = 0; p < 8; p += 1) {
    const palm = makePalm(rng);
    const a = (p / 8) * Math.PI * 2;
    palm.position.set(cx + Math.cos(a) * 15, 0, cz + Math.sin(a) * 15);
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  // Benches around the fountain, facing the water.
  for (let p = 0; p < 4; p += 1) {
    const a = (p / 4) * Math.PI * 2 + Math.PI / 4;
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.5, 1),
      new THREE.MeshLambertMaterial({ color: 0x8a6b4a }),
    );
    bench.position.set(cx + Math.cos(a) * 11, 0.25, cz + Math.sin(a) * 11);
    bench.rotation.y = -a + Math.PI / 2;
    scene.add(bench);
  }
  addWander(cx + 12, cz);
  addWander(cx - 12, cz);
  addWander(cx, cz + 12);
}

/** The second plaza (v6): a bandstand square on Market Row, with benches
 * and a ring of palms — peds gather here at dusk. */
function buildBandstandPlaza(ctx, cx, cz) {
  const { scene, rng, addCollider, addWander } = ctx;
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: 0xc9a06c }),
  );
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(cx, 0.0, cz);
  scene.add(walk);
  const stand = makeBandstand();
  stand.position.set(cx, 0, cz);
  scene.add(stand);
  addCollider(cx, cz, 5.5, 5.5);
  for (let p = 0; p < 6; p += 1) {
    const a = (p / 6) * Math.PI * 2;
    const palm = makePalm(rng);
    palm.position.set(cx + Math.cos(a) * 16, 0, cz + Math.sin(a) * 16);
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  addWander(cx + 18, cz);
  addWander(cx - 18, cz);
  addWander(cx, cz + 18);
}

/** A pocket park (v6): a pond, benches and trees in the suburb, so the
 * south-west quarter has somewhere green that is not a garden. */
function buildPocketPark(ctx, cx, cz) {
  const { scene, rng, addCollider, addWander } = ctx;
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.blockHalf * 2 + 6, CITY.blockHalf * 2 + 6),
    new THREE.MeshLambertMaterial({ color: 0x5d8a4a }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, 0.0, cz);
  scene.add(lawn);
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(6, 20),
    new THREE.MeshLambertMaterial({ color: 0x2b6cb0 }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(cx - 4, 0.04, cz - 2);
  scene.add(pond);
  for (let t = 0; t < 5; t += 1) {
    const palm = makePalm(rng);
    palm.position.set(cx + rng.range(-16, 16), 0, cz + rng.range(-16, 16));
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  for (let b = 0; b < 3; b += 1) {
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.5, 1),
      new THREE.MeshLambertMaterial({ color: 0x8a6b4a }),
    );
    bench.position.set(cx + 8 + b * 4, 0.25, cz + 8);
    bench.rotation.y = rng.range(0, Math.PI);
    scene.add(bench);
  }
  addWander(cx + 10, cz + 10);
  addWander(cx - 10, cz - 10);
}

function buildBoardwalk(ctx) {
  const { scene, rng, addCollider, addWander } = ctx;
  const boardTex = boardwalkTexture();
  boardTex.repeat.set(30, 1);
  const boardwalk = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.boardwalkHalf * 2, 12),
    new THREE.MeshLambertMaterial({ map: boardTex }),
  );
  boardwalk.rotation.x = -Math.PI / 2;
  boardwalk.position.set(0, 0.06, CITY.boardwalkZ);
  scene.add(boardwalk);
  for (let s = 0; s < 6; s += 1) {
    const stall = makeStall(rng, NEON_COLORS[s % NEON_COLORS.length]);
    const sx = -200 + s * 80 + rng.range(-8, 8);
    stall.position.set(sx, 0, CITY.boardwalkZ - 3);
    scene.add(stall);
    addCollider(sx, CITY.boardwalkZ - 3, 2, 1.4);
    addWander(sx, CITY.boardwalkZ + 3);
  }
  // The pier: planks out over the water, with a lamp at the end.
  const pier = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 46),
    new THREE.MeshLambertMaterial({ map: boardTex }),
  );
  pier.rotation.x = -Math.PI / 2;
  pier.position.set(124, 0.08, CITY.boardwalkZ + 24);
  scene.add(pier);
  const pierLamp = makeLamp(true);
  pierLamp.position.set(124, 0, CITY.boardwalkZ + 44);
  scene.add(pierLamp);
  // Ferris wheel at the west end of the boardwalk: a ring, spokes and cabins.
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(11, 0.35, 8, 32),
    new THREE.MeshLambertMaterial({ color: 0xff5a7a }),
  );
  wheel.add(rim);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 22, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
    );
    spoke.rotation.z = a;
    wheel.add(spoke);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.6, 1.6),
      new THREE.MeshLambertMaterial({ color: NEON_COLORS[i % NEON_COLORS.length] }),
    );
    cabin.position.set(Math.cos(a) * 11, Math.sin(a) * 11, 0);
    wheel.add(cabin);
  }
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 3, 8),
    new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
  );
  axle.rotation.x = Math.PI / 2;
  wheel.add(axle);
  wheel.position.set(-210, 13.5, CITY.boardwalkZ);
  // Face the wheel along the boardwalk, so walkers see the ring, not its edge.
  wheel.rotation.y = Math.PI / 2;
  scene.add(wheel);
  ctx.ferrisWheel = wheel;
  for (const x of [-4, 4]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 13.5, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
    );
    leg.position.set(-210 + x, 6.75, CITY.boardwalkZ);
    scene.add(leg);
  }
  addCollider(-210, CITY.boardwalkZ, 5, 2);
  addWander(-200, CITY.boardwalkZ + 4);
  addWander(124, CITY.boardwalkZ + 4);
  // Palm rows along the whole beach, so the sunset skyline is palms, not
  // bare sand, from any camera on the boardwalk.
  for (let px = -250; px <= 250; px += 42) {
    if (Math.abs(px + 210) < 12) continue; // the ferris wheel owns that spot
    const palm = makePalm(rng);
    palm.position.set(px + rng.range(-4, 4), 0, CITY.beachZ - 6);
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
}

function buildPort(ctx) {
  const { scene, rng, addCollider, addWander } = ctx;
  const portGround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 130),
    new THREE.MeshLambertMaterial({ color: 0x6a6a72 }),
  );
  portGround.rotation.x = -Math.PI / 2;
  portGround.position.set(CITY.portX, 0.03, CITY.portZ);
  scene.add(portGround);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const stack = rng.int(1, 3);
      for (let level = 0; level < stack; level += 1) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(12, 2.6, 2.6),
          new THREE.MeshLambertMaterial({ color: rng.pick(CONTAINER_COLORS) }),
        );
        const cx = CITY.portX - 30 + col * 26;
        const cz = CITY.portZ - 40 + row * 26;
        box.position.set(cx, 1.3 + level * 2.6, cz);
        box.rotation.y = row % 2 === 0 ? 0 : Math.PI / 2;
        scene.add(box);
      }
      addCollider(CITY.portX - 30 + col * 26, CITY.portZ - 40 + row * 26, 6.5, 6.5);
    }
  }
  for (const [cx, cz] of [[CITY.portX - 10, CITY.portZ + 30], [CITY.portX + 30, CITY.portZ - 30]]) {
    const crane = makeCrane(PALETTE.crane);
    crane.position.set(cx, 0, cz);
    crane.rotation.y = rng.range(0, Math.PI);
    scene.add(crane);
    addCollider(cx, cz, 7, 2);
  }
  for (const [sx, sz] of [[CITY.portX - 40, CITY.portZ + 50], [CITY.portX + 20, CITY.portZ + 52]]) {
    const shed = new THREE.Mesh(
      new THREE.BoxGeometry(24, 9, 14),
      new THREE.MeshLambertMaterial({ color: 0x8a94a6 }),
    );
    shed.position.set(sx, 4.5, sz);
    scene.add(shed);
    const shedRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 24, 12, 1, false, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x5a6474 }),
    );
    shedRoof.rotation.z = Math.PI / 2;
    shedRoof.rotation.y = Math.PI / 2;
    shedRoof.position.set(sx, 9, sz);
    scene.add(shedRoof);
    addCollider(sx, sz, 12.5, 7.5);
  }
  // Dumpsters behind the sheds — street props the port shares with the city.
  for (const [dx, dz] of [[CITY.portX - 52, CITY.portZ + 40], [CITY.portX + 34, CITY.portZ + 40]]) {
    const dumpster = makeDumpster();
    dumpster.position.set(dx, 0, dz);
    scene.add(dumpster);
    addCollider(dx, dz, 1.4, 0.9);
  }
  addWander(CITY.portX - 30, CITY.portZ + 10);
  addWander(CITY.portX + 10, CITY.portZ - 10);
}

function buildMarina(ctx) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const boardTex = boardwalkTexture();
  const marinaDeck = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 14),
    new THREE.MeshLambertMaterial({ map: boardTex }),
  );
  marinaDeck.rotation.x = -Math.PI / 2;
  marinaDeck.position.set(CITY.marinaX, 0.07, CITY.marinaZ - 8);
  scene.add(marinaDeck);
  const boatColors = [0xd94f3d, 0x3d7fd9, 0xf2c230, 0x7ac74f, 0xe8e4da];
  const sailColors = [0xff5a7a, 0x2bb3a3, 0xffc94f, 0x8a5fd0, 0x51ff7a];
  for (let b = 0; b < 5; b += 1) {
    const boat = makeBoat(rng, boatColors[b], sailColors[b]);
    const bx = CITY.marinaX - 24 + b * 12;
    boat.position.set(bx, 0.1, CITY.marinaZ + 14 + (b % 2) * 6);
    boat.rotation.y = rng.range(-0.2, 0.2);
    scene.add(boat);
    addCollider(bx, CITY.marinaZ + 14, 2, 4);
  }
  const shack = new THREE.Mesh(
    new THREE.BoxGeometry(6, 3.4, 5),
    new THREE.MeshLambertMaterial({ color: 0x8a94a6 }),
  );
  shack.position.set(CITY.marinaX + 24, 1.7, CITY.marinaZ - 8);
  scene.add(shack);
  const shackSign = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.9, 0.2),
    new THREE.MeshBasicMaterial({ color: PALETTE.neonCyan }),
  );
  shackSign.position.set(CITY.marinaX + 24, 3.9, CITY.marinaZ - 5.4);
  scene.add(shackSign);
  registerNeon(shackSign);
  addCollider(CITY.marinaX + 24, CITY.marinaZ - 8, 3.4, 2.9);
  addWander(CITY.marinaX - 10, CITY.marinaZ - 4);
  addWander(CITY.marinaX + 12, CITY.marinaZ - 4);
  addWander(CITY.marinaX, CITY.marinaZ + 22);
}

function buildAirport(ctx) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(124, 124),
    new THREE.MeshLambertMaterial({ color: 0x9a9aa2 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(CITY.airportX, 0.03, CITY.airportZ);
  scene.add(apron);
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 14),
    new THREE.MeshLambertMaterial({ color: PALETTE.runway }),
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(CITY.airportX, 0.05, CITY.runwayZ);
  scene.add(runway);
  for (let rx = -50; rx <= 50; rx += 10) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 0.7),
      new THREE.MeshBasicMaterial({ color: PALETTE.runwayMark }),
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(CITY.airportX + rx, 0.06, CITY.runwayZ);
    scene.add(dash);
  }
  for (let rx = -54; rx <= 54; rx += 12) {
    for (const rz of [CITY.runwayZ - 6.4, CITY.runwayZ + 6.4]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.3, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xffc94f }),
      );
      lamp.position.set(CITY.airportX + rx, 0.15, rz);
      scene.add(lamp);
    }
  }
  const terminal = new THREE.Mesh(
    new THREE.BoxGeometry(30, 10, 14),
    new THREE.MeshLambertMaterial({ color: PALETTE.terminalGlass }),
  );
  terminal.position.set(-222, 5, -196);
  scene.add(terminal);
  const terminalSign = new THREE.Mesh(
    new THREE.BoxGeometry(16, 1.6, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.neonCyan }),
  );
  terminalSign.position.set(-222, 10.6, -188.8);
  scene.add(terminalSign);
  registerNeon(terminalSign);
  addCollider(-222, -196, 15.5, 7.5);
  for (const [hx, hz, hw, hd, hh] of [[-262, -196, 18, 14, 9], [-262, -238, 16, 12, 8]]) {
    const hangar = new THREE.Mesh(
      new THREE.BoxGeometry(hw, hh, hd),
      new THREE.MeshLambertMaterial({ color: PALETTE.hangar }),
    );
    hangar.position.set(hx, hh / 2, hz);
    scene.add(hangar);
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(hd / 2, hd / 2, hw, 12, 1, false, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: 0x5a6474 }),
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.set(hx, hh, hz);
    scene.add(roof);
    addCollider(hx, hz, hw / 2 + 0.3, hd / 2 + 0.3);
  }
  const towerShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.2, 26, 10),
    new THREE.MeshLambertMaterial({ color: 0xd9d9d9 }),
  );
  towerShaft.position.set(-196, 13, -240);
  scene.add(towerShaft);
  const towerCab = new THREE.Mesh(
    new THREE.BoxGeometry(7, 3.4, 7),
    new THREE.MeshLambertMaterial({ color: PALETTE.terminalGlass }),
  );
  towerCab.position.set(-196, 27.5, -240);
  scene.add(towerCab);
  const towerBeacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4040 }),
  );
  towerBeacon.position.set(-196, 29.6, -240);
  scene.add(towerBeacon);
  ctx.towerBeacon = towerBeacon;
  addCollider(-196, -240, 2.6, 2.6);
  const planeColors = [0xe8e4da, 0x3d7fd9, 0xd94f3d];
  const planeSpots = [[-206, -232, 0.4], [-188, -258, -0.3], [-216, -262, 1.2]];
  for (let p = 0; p < planeSpots.length; p += 1) {
    const [px, pz, pyaw] = planeSpots[p];
    const plane = makePlane(rng, planeColors[p]);
    plane.position.set(px, 0, pz);
    plane.rotation.y = pyaw;
    scene.add(plane);
    addCollider(px, pz, 10, 8);
  }
  addWander(-222, -186);
  addWander(-240, -196);
  addWander(-206, -240);
}

function buildMarketRow(ctx) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  for (let s = 0; s < 6; s += 1) {
    const stall = makeStall(rng, NEON_COLORS[s % NEON_COLORS.length]);
    const sx = CITY.marketX + rng.range(-4, 4);
    const sz = CITY.marketZ - 60 + s * 24;
    stall.position.set(sx, 0, sz);
    stall.rotation.y = -Math.PI / 2;
    scene.add(stall);
    registerNeon(stall.children[2]); // the stall's glowing sign
    addCollider(sx, sz, 1.6, 1.6);
    addWander(sx - 4, sz + 3);
  }
}

/** Ferry Point (v6): the ninth district. A concrete terminal on the sand,
 * a ticket hall with a blue neon sign, a moored ferry with its ramp down,
 * and a striped lighthouse at the end of the pier whose beam sweeps the
 * water. The terminal and the lighthouse are collidable; the ferry floats
 * just off the pier, close enough to read as moored. */
function buildFerryPoint(ctx) {
  const { scene, rng, registerNeon, addCollider, addWander } = ctx;
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70),
    new THREE.MeshLambertMaterial({ color: PALETTE.ferryDeck }),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(CITY.ferryX, 0.04, CITY.ferryZ);
  scene.add(deck);
  // The terminal: a long low hall with a blue glass front and a neon sign.
  const terminal = new THREE.Mesh(
    new THREE.BoxGeometry(34, 8, 16),
    new THREE.MeshLambertMaterial({ color: 0xe8e4da }),
  );
  terminal.position.set(CITY.ferryX - 6, 4, CITY.ferryZ - 12);
  scene.add(terminal);
  const glassFront = new THREE.Mesh(
    new THREE.BoxGeometry(30, 5, 0.4),
    new THREE.MeshLambertMaterial({ color: PALETTE.terminalGlass }),
  );
  glassFront.position.set(CITY.ferryX - 6, 3.4, CITY.ferryZ - 3.8);
  scene.add(glassFront);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(20, 1.8, 0.3),
    new THREE.MeshBasicMaterial({ color: PALETTE.ferryBlue }),
  );
  sign.position.set(CITY.ferryX - 6, 8.8, CITY.ferryZ - 3.8);
  scene.add(sign);
  registerNeon(sign);
  addCollider(CITY.ferryX - 6, CITY.ferryZ - 12, 17.5, 8.5);
  // The ticket hall: a smaller booth with a striped awning, by the gate.
  const booth = new THREE.Mesh(
    new THREE.BoxGeometry(6, 3.2, 5),
    new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
  );
  booth.position.set(CITY.ferryX + 16, 1.6, CITY.ferryZ + 8);
  scene.add(booth);
  const boothAwning = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.16, 6),
    new THREE.MeshLambertMaterial({ map: awningTexture(PALETTE.ferryBlue) }),
  );
  boothAwning.position.set(CITY.ferryX + 16, 3.4, CITY.ferryZ + 8);
  scene.add(boothAwning);
  addCollider(CITY.ferryX + 16, CITY.ferryZ + 8, 3.4, 2.9);
  // The ferry, moored off the deck with its ramp down.
  const ferry = makeFerry();
  ferry.position.set(CITY.ferryX + 8, 0, CITY.ferryZ + 44);
  ferry.rotation.y = Math.PI;
  scene.add(ferry);
  ctx.ferry = ferry;
  addCollider(CITY.ferryX + 8, CITY.ferryZ + 44, 5, 12);
  // The lighthouse pier: planks from the boardwalk's east end out over
  // the water, ending in the striped tower with its sweeping beam.
  const boardTex = boardwalkTexture();
  const pier = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 34),
    new THREE.MeshLambertMaterial({ map: boardTex }),
  );
  pier.rotation.x = -Math.PI / 2;
  pier.position.set(CITY.lighthouseX, 0.08, CITY.lighthouseZ - 12);
  scene.add(pier);
  const lighthouse = makeLighthouse();
  lighthouse.position.set(CITY.lighthouseX, 0, CITY.lighthouseZ);
  scene.add(lighthouse);
  ctx.lighthouse = lighthouse;
  addCollider(CITY.lighthouseX, CITY.lighthouseZ, 2.2, 2.2);
  // Palms and a bench along the terminal deck.
  for (let p = 0; p < 3; p += 1) {
    const palm = makePalm(rng);
    palm.position.set(CITY.ferryX - 24 + p * 18, 0, CITY.ferryZ + 22);
    scene.add(palm);
    addCollider(palm.position.x, palm.position.z, 0.5, 0.5);
  }
  addWander(CITY.ferryX - 10, CITY.ferryZ + 14);
  addWander(CITY.ferryX + 12, CITY.ferryZ + 18);
  addWander(CITY.lighthouseX, CITY.lighthouseZ - 16);
}

/** Street props (v6): bus stops along the two main roads, phone booths on
 * the plaza corners, hydrants by the hydrant-coloured blocks and dumpsters
 * in the alleys behind the shops. All collidable, all seeded. */
function buildStreetProps(ctx) {
  const { scene, rng, registerNeon, addCollider } = ctx;
  const busStops = [
    { x: -93, z: 9, yaw: 0 }, { x: 93, z: -9, yaw: Math.PI },
    { x: 9, z: -93, yaw: Math.PI / 2 }, { x: -9, z: 93, yaw: -Math.PI / 2 },
  ];
  for (const spot of busStops) {
    const stop = makeBusStop();
    stop.position.set(spot.x, 0, spot.z);
    stop.rotation.y = spot.yaw;
    scene.add(stop);
    addCollider(spot.x, spot.z, 2.4, 1.2);
  }
  const booths = [
    { x: -44, z: -18 }, { x: -18, z: -44 },
    { x: 44, z: 18 }, { x: 18, z: 44 },
  ];
  for (const spot of booths) {
    const booth = makePhoneBooth();
    booth.position.set(spot.x, 0, spot.z);
    scene.add(booth);
    registerNeon(booth.userData.neonTop);
    addCollider(spot.x, spot.z, 0.8, 0.8);
  }
  for (let h = 0; h < 8; h += 1) {
    const hydrant = makeHydrant();
    hydrant.position.set(rng.pick([-186, -124, -62, 62, 124, 186]) + rng.range(-2, 2), 0,
      rng.pick([-186, -124, -62, 62, 124, 186]) + rng.range(-2, 2));
    scene.add(hydrant);
    addCollider(hydrant.position.x, hydrant.position.z, 0.35, 0.35);
  }
  for (let d = 0; d < 5; d += 1) {
    const dumpster = makeDumpster(rng.pick([0x2a4a3a, 0x3a3f4a, 0x4a3a2a]));
    dumpster.position.set(rng.pick([-155, -93, 31, 93, 155]) + rng.range(-3, 3), 0,
      rng.pick([-155, -93, 31, 93, 155]) + rng.range(-3, 3));
    dumpster.rotation.y = rng.range(0, Math.PI);
    scene.add(dumpster);
    addCollider(dumpster.position.x, dumpster.position.z, 1.4, 0.9);
  }
}

/** Lamps at every other intersection, facing the road; only a few are lit. */
function buildLamps(ctx) {
  const { scene, rng, addCollider } = ctx;
  const { pitch, halfGrid, roadHalf } = CITY;
  let lampIndex = 0;
  for (let i = -halfGrid; i <= halfGrid; i += 2) {
    for (let j = -halfGrid; j <= halfGrid; j += 2) {
      const lamp = makeLamp(lampIndex % 4 === 0);
      lampIndex += 1;
      lamp.position.set(i * pitch + roadHalf + 1, 0, j * pitch + roadHalf + 1);
      lamp.rotation.y = rng.range(0, Math.PI * 2);
      scene.add(lamp);
      addCollider(lamp.position.x, lamp.position.z, 0.3, 0.3);
    }
  }
}

/** A few billboards for the skyline: tall posts with a bright face. */
function buildBillboards(ctx) {
  const { scene, rng, registerNeon, addCollider } = ctx;
  for (let b = 0; b < 6; b += 1) {
    const bx = rng.pick([-186, -124, 124, 186, 62, -62]);
    const bz = rng.pick([-186, -124, 124, 186, 62, -62]);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 14, 0.8),
      new THREE.MeshLambertMaterial({ color: 0x3a3f4a }),
    );
    post.position.set(bx, 7, bz);
    scene.add(post);
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(12, 6, 0.4),
      new THREE.MeshBasicMaterial({ color: BILLBOARD_FACES[b % BILLBOARD_FACES.length] }),
    );
    face.position.set(bx, 16, bz);
    face.rotation.y = rng.range(0, Math.PI);
    scene.add(face);
    registerNeon(face);
    addCollider(bx, bz, 0.7, 0.7);
  }
}

/**
 * Build the city into `scene` from `seed`. Returns the colliders, the plaza
 * centre, the neon signs, the traffic lights and the animated landmarks
 * (ferris wheel, lighthouse, ferry, tower beacon) the game loop animates.
 */
export function buildCity(scene, seed) {
  const rng = makeRng(seed);
  const colliders = [];
  const wanderPoints = [];
  // Neon signs the game pulses at dusk: { mesh, phase }. Every registered
  // sign is a MeshBasicMaterial with transparent:true so the pulse can
  // fade it without touching the geometry.
  const neonSigns = [];
  const registerNeon = (mesh) => {
    mesh.material.transparent = true;
    neonSigns.push({ mesh, phase: rng.range(0, Math.PI * 2) });
  };
  const addCollider = (x, z, hx, hz) => colliders.push({ x, z, hx, hz });
  const addWander = (x, z) => wanderPoints.push({ x, z });
  const ctx = {
    scene, rng, colliders, wanderPoints, neonSigns,
    registerNeon, addCollider, addWander,
    trafficLights: [], ferrisWheel: null, lighthouse: null, ferry: null,
    towerBeacon: null,
  };

  buildGround(ctx);
  buildRoads(ctx);
  buildBoardwalk(ctx);
  buildPort(ctx);
  buildMarina(ctx);
  buildAirport(ctx);
  buildMarketRow(ctx);
  buildFerryPoint(ctx);
  buildStreetProps(ctx);
  buildLamps(ctx);
  buildBillboards(ctx);

  // The block grid: the plaza stays open, the airport block is owned by
  // the airport district, the casino owns its block, and the rest roll
  // downtown / suburb / Old Town / bandstand plaza / pocket park / generic
  // by position — the DISTRICTS table in config.js is the map of record.
  const { pitch, halfGrid } = CITY;
  for (let bx = -halfGrid; bx < halfGrid; bx += 1) {
    for (let bz = -halfGrid; bz < halfGrid; bz += 1) {
      const cx = (bx + 0.5) * pitch;
      const cz = (bz + 0.5) * pitch;
      if (bx === -1 && bz === -1) { buildPlaza(ctx, cx, cz); continue; }
      if (bx === -4 && bz === -4) continue; // airport district owns this block
      if (bx === 3 && bz === -1) { buildCasinoBlock(ctx, cx, cz); continue; }
      // The bandstand plaza owns the Market Row block at (2, 1).
      if (bx === 2 && bz === 1) { buildBandstandPlaza(ctx, cx, cz); continue; }
      // The pocket park owns the suburb block at (-3, 2).
      if (bx === -3 && bz === 2) { buildPocketPark(ctx, cx, cz); continue; }
      const isDowntown = bz <= -2 && bx >= -1 && bx <= 1;
      const isSuburb = bx <= -3 && bz >= 2;
      const isOldTown = bx >= 2 && bz <= -3;
      if (isOldTown) { buildOldTownBlock(ctx, cx, cz); continue; }
      if (isDowntown) { buildDowntownBlock(ctx, cx, cz); continue; }
      if (isSuburb) { buildSuburbBlock(ctx, cx, cz); continue; }
      buildGenericBlock(ctx, cx, cz);
    }
  }

  return {
    colliders,
    wanderPoints,
    plaza: { x: -31, z: -31 },
    neonSigns,
    trafficLights: ctx.trafficLights,
    ferrisWheel: ctx.ferrisWheel,
    lighthouse: ctx.lighthouse,
    ferry: ctx.ferry,
    towerBeacon: ctx.towerBeacon,
    // The district table, for the HUD and the minimap to draw from.
    districts: DISTRICTS,
  };
}
