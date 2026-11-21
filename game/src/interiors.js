// Building interiors, v7: three rooms Riko can actually walk into —
// the corner store, the Golden Palm casino floor, and the safehouse.
// Each interior is a real room built far outside the city grid (a
// thousand units east, where no road or collider reaches), with a floor,
// walls, furniture, a shopkeeper or dealer who talks, and something to
// do inside: the store's counter opens the shop, the casino's slot
// machines take a gamble, the safehouse bed sleeps the night away.
//
// Entering is E at the door marker outside (the $ shop, the casino, the
// safehouse H). Inside, the world outside freezes — the interior owns
// the player's movement with its own WASD walk and room-bounds clamp,
// because the street player's clamps and colliders do not apply a
// thousand units out. E at the glowing doorway walks back out, to the
// exact spot Riko came in from.
//
// The rooms are built once, at construction, and hidden in plain sight:
// they sit in the same scene, far away, so the renderer never has to
// swap scenes — the camera simply follows Riko into one.
import * as THREE from 'three';
import { PLACES } from './config.js';
import { dist2 } from './util.js';
import { makePersonMesh } from './people.js';

/** The three interiors: where the room sits in the world, how big it
 * is, and what colours it wears. The offsets are far outside the city
 * bound (272) and the beach (318), so no street, car or pedestrian ever
 * wanders into a room, and no room ever blocks a road. */
export const INTERIOR_DEFS = {
  shop: {
    id: 'shop',
    label: 'Corner Store',
    cx: 900, cz: 900, w: 18, d: 13,
    floor: 0x8a6a4a, wall: 0xc9a06c, trim: 0x2a7a3a,
    light: 0xffe9b0,
    enterLine: 'Inside the corner store — shelves, a counter, and the smell of coffee and gun oil.',
    door: { x: 72, z: 62, label: 'Corner Store door' },
  },
  casino: {
    id: 'casino',
    label: 'Golden Palm Casino',
    cx: 960, cz: 900, w: 24, d: 16,
    floor: 0x3a2a55, wall: 0xc9a227, trim: 0xff5a9e,
    light: 0xffd94f,
    enterLine: 'Inside the Golden Palm — slots chiming, felt tables, and Dara\'s dealer watching the door.',
    door: { x: 196, z: -62, label: 'Golden Palm door' },
  },
  safehouse: {
    id: 'safehouse',
    label: 'Safehouse',
    cx: 1020, cz: 900, w: 16, d: 12,
    floor: 0x5d6a4a, wall: 0x2a6a8a, trim: 0x4fd2ff,
    light: 0x9fd8ff,
    enterLine: 'Inside the safehouse — a bed, a lamp, and the quietest room in Qihuy City.',
    door: { x: -110, z: 124, label: 'Safehouse door' },
  },
};

/** What the shopkeeper says when Riko walks up to the counter. */
const KEEPER_LINES = [
  'Keeper: Coffee\'s fresh, shells are cheaper by the box. You look like a man with a job tonight.',
  'Keeper: Mara was in earlier. She said you\'d be by. Said not to sell you the good stuff on credit.',
  'Keeper: The parts shop by the port does engines now. Tell them the corner store sent you — they won\'t care, but tell them anyway.',
  'Keeper: You want the shotgun? Aisle three. You want advice? Don\'t take the ferry job at dusk.',
];

/** What the casino dealer says. Dara's house, Dara's rules. */
const DEALER_LINES = [
  'Dealer: Dara says the house always wins, Riko. The house is just polite about it.',
  'Dealer: Slots are $20 a pull. The big one pays $200. The small one pays $50. The rest pays for my shoes.',
  'Dealer: Mara\'s boy, playing at Dara\'s tables. I like your nerve. The slots like it too.',
  'Dealer: You\'re up $0 so far, if my maths is right. The machines are that way — don\'t keep them waiting.',
];

export class Interiors {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    // Which interior Riko is inside right now: 'shop' | 'casino' |
    // 'safehouse' | null. Null means he is on the street.
    this.inside = null;
    // Where he came in from, so the exit drops him back on the same
    // pavement instead of the middle of the road.
    this.returnPos = null;
    // Visit counts and the casino ledger, for the stats screen.
    this.visits = { shop: 0, casino: 0, safehouse: 0 };
    this.gambles = 0;
    this.gambleWon = 0;
    // The built rooms, by id: { group, def, keeper, slots, counter, bed }.
    this.rooms = {};
    for (const def of Object.values(INTERIOR_DEFS)) {
      this.rooms[def.id] = this.buildRoom(def);
    }
  }

  // ----- construction -----------------------------------------------------
  /** Build one room: floor, four walls, a glowing doorway on the south
   * wall, a warm point light, and the furniture that makes it a place —
   * shelves and a counter for the store, slot machines and a felt table
   * for the casino, a bed and a lamp for the safehouse. */
  buildRoom(def) {
    const group = new THREE.Group();
    group.position.set(def.cx, 0, def.cz);
    const floorMat = new THREE.MeshLambertMaterial({ color: def.floor });
    const wallMat = new THREE.MeshLambertMaterial({ color: def.wall });
    const trimMat = new THREE.MeshLambertMaterial({ color: def.trim });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x22242a });

    // Floor: a thin slab whose top sits exactly at y = 0, so Riko's
    // feet rest on it instead of sinking into it.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(def.w, 0.2, def.d), floorMat);
    floor.position.y = -0.1;
    group.add(floor);

    // Walls: north, south, west, east. The south wall carries the door —
    // two segments with a gap in the middle, and a glowing frame over it.
    const wallH = 3.6;
    const mkWall = (w, d, x, z) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      wall.position.set(x, wallH / 2, z);
      group.add(wall);
      return wall;
    };
    mkWall(def.w, 0.4, 0, -def.d / 2); // north
    mkWall(def.w / 2 - 1.4, 0.4, -(def.w / 4 + 0.7), def.d / 2); // south, west of door
    mkWall(def.w / 2 - 1.4, 0.4, def.w / 4 + 0.7, def.d / 2); // south, east of door
    mkWall(0.4, def.d, -def.w / 2, 0); // west
    mkWall(0.4, def.d, def.w / 2, 0); // east
    // Door glow: a bright frame the player walks toward to leave.
    const doorGlow = new THREE.Mesh(
      new THREE.BoxGeometry(2.8, 3.0, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x51ff7a }),
    );
    doorGlow.position.set(0, 1.5, def.d / 2 - 0.1);
    group.add(doorGlow);
    // A warm point light in the middle of the room, so the interior
    // reads as lit even at midnight outside.
    const light = new THREE.PointLight(def.light, 50, 30, 1.6);
    light.position.set(0, 3, 0);
    group.add(light);

    const room = { group, def, keeper: null, dealer: null, slots: [], counter: null, bed: null, table: null };

    if (def.id === 'shop') {
      // Shelves along the west wall: three rows of boxes with goods.
      for (let row = 0; row < 3; row += 1) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 4.5), trimMat);
        shelf.position.set(-def.w / 2 + 1.2, 1.1, -3.5 + row * 3.5);
        group.add(shelf);
        for (let s = 0; s < 3; s += 1) {
          const goods = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.4, 0.9),
            new THREE.MeshLambertMaterial({ color: [0xd94f3d, 0xf2c230, 0x2bb3a3][s] }),
          );
          goods.position.set(-def.w / 2 + 1.2, 0.5 + s * 0.7, -4.5 + row * 3.5 + s * 0.9);
          group.add(goods);
        }
      }
      // The counter across the north wall, with the keeper behind it.
      const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.4), darkMat);
      counter.position.set(0, 0.55, -def.d / 2 + 1.6);
      group.add(counter);
      room.counter = { x: 0, z: -def.d / 2 + 1.6 };
      const keeper = makePersonMesh(0x2a7a3a, 0xe8b88a, false);
      keeper.position.set(0, 0, -def.d / 2 + 3.0);
      keeper.rotation.y = 0;
      group.add(keeper);
      room.keeper = keeper;
      // A crate of shells by the counter — the shop's whole inventory,
      // more or less, in one box.
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), trimMat);
      crate.position.set(4.5, 0.6, -def.d / 2 + 2.2);
      group.add(crate);
    }

    if (def.id === 'casino') {
      // Slot machines along the north wall: cabinets with glowing faces.
      for (let i = 0; i < 4; i += 1) {
        const sx = -7.5 + i * 5;
        const cabinet = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 1.0), darkMat);
        cabinet.position.set(sx, 1.2, -def.d / 2 + 1.2);
        group.add(cabinet);
        const face = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 1.2, 0.1),
          new THREE.MeshBasicMaterial({ color: [0xff5a9e, 0xffc94f, 0x2bd9c9, 0xff8c42][i] }),
        );
        face.position.set(sx, 1.7, -def.d / 2 + 1.75);
        group.add(face);
        room.slots.push({ x: sx, z: -def.d / 2 + 1.2 });
      }
      // The felt table in the middle: green top, gold trim, dealer behind it.
      const table = new THREE.Mesh(new THREE.BoxGeometry(6, 0.9, 3), new THREE.MeshLambertMaterial({ color: 0x1a6a3a }));
      table.position.set(0, 0.45, 1.5);
      group.add(table);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.15, 3.4), trimMat);
      rim.position.set(0, 0.95, 1.5);
      group.add(rim);
      room.table = { x: 0, z: 1.5 };
      const dealer = makePersonMesh(0xc9a227, 0xd9a06c, false);
      dealer.position.set(0, 0, 4.2);
      dealer.rotation.y = Math.PI;
      group.add(dealer);
      room.dealer = dealer;
      // Chip stacks on the table: little cylinders of colour.
      for (let i = 0; i < 5; i += 1) {
        const chip = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.28, 0.35, 10),
          new THREE.MeshLambertMaterial({ color: [0xff5a9e, 0x2bd9c9, 0xffc94f, 0xe8e4da, 0xff5040][i] }),
        );
        chip.position.set(-2 + i * 1.0, 1.15, 1.2);
        group.add(chip);
      }
    }

    if (def.id === 'safehouse') {
      // The bed against the west wall: frame, mattress, pillow.
      const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 4.5), trimMat);
      bedFrame.position.set(-def.w / 2 + 1.6, 0.25, -1);
      group.add(bedFrame);
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 4.2), new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
      mattress.position.set(-def.w / 2 + 1.6, 0.65, -1);
      group.add(mattress);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 0.9), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      pillow.position.set(-def.w / 2 + 1.6, 0.85, -2.8);
      group.add(pillow);
      room.bed = { x: -def.w / 2 + 1.6, z: -1 };
      // A table with a lamp in the middle, and a poster on the north wall.
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.4), darkMat);
      table.position.set(2, 0.45, -2);
      group.add(table);
      const lamp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.45, 0.7, 10),
        new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
      );
      lamp.position.set(2, 1.25, -2);
      group.add(lamp);
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 3.2),
        new THREE.MeshBasicMaterial({ color: 0xff5a9e }),
      );
      poster.position.set(3, 1.8, -def.d / 2 + 0.25);
      group.add(poster);
      // A duffel bag by the door — Riko's go-bag, always packed.
      const bag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 0.8), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
      bag.position.set(4.5, 0.35, def.d / 2 - 1.5);
      group.add(bag);
    }

    this.scene.add(group);
    return room;
  }

  // ----- enter / exit -------------------------------------------------------
  /** E at a door outside: step into the room. Returns true when a door
   * was near enough to use, so the caller knows the keypress is spent. */
  tryEnter(game) {
    if (this.inside) return false;
    const player = game.player;
    if (!player.onFoot) return false;
    for (const def of Object.values(INTERIOR_DEFS)) {
      if (dist2(player.x, player.z, def.door.x, def.door.z) < 36) {
        this.enter(def.id, game);
        return true;
      }
    }
    return false;
  }

  /** Step into a room: remember where Riko came from, put him just
   * inside the glowing doorway facing the room, and say what the room is. */
  enter(id, game) {
    const def = INTERIOR_DEFS[id];
    if (!def) return;
    this.returnPos = { x: game.player.x, z: game.player.z, yaw: game.player.yaw };
    this.inside = id;
    this.visits[id] = (this.visits[id] || 0) + 1;
    game.player.x = def.cx;
    game.player.z = def.cz + def.d / 2 - 2.5;
    game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.audio.chime();
    game.missions.say(`${def.label} — ${def.enterLine} Press E at the green doorway to leave.`, 6);
  }

  /** Step back out through the glowing doorway, onto the exact pavement
   * Riko came in from. */
  exit(game) {
    if (!this.inside || !this.returnPos) return;
    game.player.x = this.returnPos.x;
    game.player.z = this.returnPos.z;
    game.player.yaw = this.returnPos.yaw;
    game.player.syncMesh();
    game.camYaw = game.player.yaw;
    this.inside = null;
    this.returnPos = null;
    game.audio.blip(660, 0.08, 0.15);
    game.missions.say('Back on the street.', 2);
  }

  // ----- inside the room ----------------------------------------------------
  /** The per-frame interior update. The game calls this instead of the
   * street movement while Riko is inside: WASD walks him around the
   * room (camera-relative, like the street), clamped to the walls, and
   * E uses whatever he is standing next to — the doorway, the counter,
   * a slot machine, the dealer, or the bed. */
  update(dt, game) {
    if (!this.inside) return;
    const room = this.rooms[this.inside];
    const def = room.def;
    const player = game.player;
    const input = game.input;
    const edges = input.consumeEdges();

    // Walk: camera-relative, at street walking speed, clamped to the
    // room's walls with a margin for Riko's own width.
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (fwd !== 0 || strafe !== 0) {
      const sin = Math.sin(game.camYaw), cos = Math.cos(game.camYaw);
      let mx = sin * fwd + cos * strafe;
      let mz = cos * fwd - sin * strafe;
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const speed = 6.5;
      player.x += mx * speed * dt;
      player.z += mz * speed * dt;
      player.yaw = Math.atan2(mx, mz);
      player.walkPhase += dt * speed * 1.9;
    }
    const mx = def.w / 2 - 1.1;
    const mz = def.d / 2 - 1.1;
    player.x = Math.max(def.cx - mx, Math.min(def.cx + mx, player.x));
    player.z = Math.max(def.cz - mz, Math.min(def.cz + mz, player.z));
    player.syncMesh();

    if (!edges.e) return;
    // The doorway out: the glowing green frame on the south wall.
    if (dist2(player.x, player.z, def.cx, def.cz + def.d / 2 - 1.2) < 16) {
      this.exit(game);
      return;
    }
    if (this.inside === 'shop') {
      // The counter: opens the corner store's shop screen.
      if (room.counter && dist2(player.x, player.z, def.cx + room.counter.x, def.cz + room.counter.z) < 12) {
        game.openShop('corner');
        return;
      }
      // The keeper: a line of dialogue, no purchase attached.
      if (room.keeper && dist2(player.x, player.z, def.cx, def.cz - def.d / 2 + 3.0) < 12) {
        const line = KEEPER_LINES[Math.floor(Math.random() * KEEPER_LINES.length)];
        game.missions.say(line, 6);
        return;
      }
    }
    if (this.inside === 'casino') {
      // A slot machine: $20 a pull, $50 on a small win, $200 on the big one.
      for (const slot of room.slots) {
        if (dist2(player.x, player.z, def.cx + slot.x, def.cz + slot.z) < 12) {
          this.pullSlot(game);
          return;
        }
      }
      // The dealer: a line of dialogue, house-flavoured.
      if (room.dealer && dist2(player.x, player.z, def.cx, def.cz + 4.2) < 12) {
        const line = DEALER_LINES[Math.floor(Math.random() * DEALER_LINES.length)];
        game.missions.say(line, 6);
        return;
      }
    }
    if (this.inside === 'safehouse') {
      // The bed: sleep till the other half of the day, fully healed.
      if (room.bed && dist2(player.x, player.z, def.cx + room.bed.x, def.cz + room.bed.z) < 12) {
        this.sleep(game);
        return;
      }
    }
  }

  /** One pull on a slot machine: $20 in, a 30% small win ($50) and a
   * 10% big win ($200). The economy records both the stake and any
   * payout, so the ledger shows the casino as a source — or a sink. */
  pullSlot(game) {
    const econ = game.economy;
    if (game.money < 20) {
      game.missions.say('Slots are $20 a pull — you\'re short. The dealer pretends not to notice.', 4);
      return;
    }
    econ.spend(20, 'Slot machine pull');
    this.gambles += 1;
    const roll = Math.random();
    if (roll < 0.10) {
      econ.earn('casino', 200, 'Slot machine — JACKPOT');
      this.gambleWon += 200;
      game.audio.jingle();
      game.fx.confetti(game.player.x, 2, game.player.z);
      game.missions.say('🎰 JACKPOT — $200! The machine sings, the dealer sighs, Dara hears about it.', 6);
    } else if (roll < 0.40) {
      econ.earn('casino', 50, 'Slot machine win');
      this.gambleWon += 50;
      game.audio.chime();
      game.missions.say('🎰 Small win — $50. The machine blinks, pleased with itself.', 4);
    } else {
      game.audio.blip(220, 0.15, 0.2);
      game.missions.say('🎰 Nothing — the reels stop on lemons. The house thanks you for the $20.', 4);
    }
  }

  /** Sleep in the safehouse bed: full health, and the day/night driver
   * jumps to the other half of the day — a night's sleep, or a day's. */
  sleep(game) {
    game.player.heal(100);
    game.dayNight.jumpHalfDay();
    game.updateDayNight(0);
    game.audio.chime();
    game.missions.say(
      game.isNight
        ? 'Slept till nightfall — full health, and the city is lit up outside.'
        : 'Slept till morning — full health, and the sunset is coming back around.',
      5,
    );
  }

  // ----- save / load --------------------------------------------------------
  serialize() {
    return {
      visits: { ...this.visits },
      gambles: this.gambles,
      gambleWon: this.gambleWon,
    };
  }

  restore(data) {
    if (!data) return;
    if (data.visits) this.visits = { shop: 0, casino: 0, safehouse: 0, ...data.visits };
    this.gambles = data.gambles || 0;
    this.gambleWon = data.gambleWon || 0;
  }

  reset() {
    this.inside = null;
    this.returnPos = null;
    this.visits = { shop: 0, casino: 0, safehouse: 0 };
    this.gambles = 0;
    this.gambleWon = 0;
  }
}
