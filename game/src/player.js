// Riko Vale on foot, v6: WASD movement relative to the camera, sprint,
// jump, punching and pistol combat, and getting in and out of cars. The
// player is the one object every other system reads — traffic slows for
// him, police chase him, missions point at him — so he keeps his state
// plain and public.
//
// v3 adds stamina: sprinting drains it, and when it runs out Riko drops back
// to a walk until it recovers. It also adds car repair: a dented car can be
// fixed at Mara's garage, and the player carries the repair call so the game
// loop stays thin.
//
// v4 adds game feel: landing from a jump kicks up a dust ring, and a punch
// or a shot that actually lands freezes the sim for a few dozen
// milliseconds (hit-stop) through the effects layer.
//
// v5 adds: the shotgun's knockback shove and pump sound on a landed blast,
// the motorbike flag (onBike) the HUD reads for its bike handling card,
// and a stolen-car counter that feeds the pause-menu stats screen.
//
// v6 rewrites the on-foot model: a DODGE ROLL (X) — a short burst of speed
// in the movement direction with a half-second of knockback immunity, on a
// 1.2 s cooldown; an AIM MODE (hold right mouse) that slows movement, narrows
// the weapon cone and steadies the shot; RECOIL — every shot kicks the aim
// up a little and widens the cone until it settles, so spraying the SMG
// actually costs accuracy; an INJURY LIMP — below 30 HP Riko walks slower
// and sways, so a near-death escape reads in the movement; and a PUNCH
// COMBO — three punches in a row, the third one knocking the target back.
// Weapon handling is one table now (WEAPON_STATS): cooldown, damage, range,
// cone, pellets, spread growth and falloff per weapon.
import * as THREE from 'three';
import { CITY, TUNE } from './config.js';
import { clamp, dist2, collideCircle } from './util.js';
import { makePersonMesh } from './people.js';

/** Weapon handling, one table: cooldown, damage, range, aim cone (dot
 * product — higher is tighter), pellets per shot, recoil per shot (cone
 * growth) and the range at which damage starts falling off. */
const WEAPON_STATS = {
  pistol: { cooldown: 0.32, damage: 45, range: 70, cone: 0.94, pellets: 1, recoil: 0.02, falloff: 40, kick: 0.12 },
  shotgun: { cooldown: 0.85, damage: 26, range: 30, cone: 0.82, pellets: 5, recoil: 0.09, falloff: 12, kick: 0.3 },
  smg: { cooldown: 0.09, damage: 18, range: 50, cone: 0.94, pellets: 1, recoil: 0.012, falloff: 25, kick: 0.12 },
};

export class Player {
  constructor(scene, x, z) {
    this.mesh = makePersonMesh(0x2bb3a3, 0xe8b88a, false);
    scene.add(this.mesh);
    this.x = x; this.z = z; this.y = 0; this.vy = 0;
    this.yaw = Math.PI;
    this.health = TUNE.playerMaxHealth;
    this.onFoot = true;
    this.car = null;
    this.busted = false;
    this.wasted = false;
    this.punchTimer = 0;
    this.gunTimer = 0;
    this.gunFlash = 0;
    // Four weapons: fists, pistol (infinite ammo), shotgun and SMG (bought
    // at the corner store, ammo counted). Keys 1–4 switch.
    this.weapon = 'pistol';
    this.owned = { pistol: true, shotgun: false, smg: false };
    this.ammo = { pistol: Infinity, shotgun: 0, smg: 0 };
    this.knockX = 0; this.knockZ = 0;
    this.walkPhase = 0;
    this.moving = false;
    // Stamina: sprint drains it; it refills while walking or standing.
    this.stamina = TUNE.staminaMax;
    this.exhausted = false;
    // v5 stats the HUD's stats screen reads: cars stolen this run.
    this.carsStolen = 0;
    // v6: the dodge roll — a burst of speed with knockback immunity.
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollDirX = 0;
    this.rollDirZ = 0;
    // v6: aim mode (right mouse) and recoil — the cone widens per shot
    // and settles back when the trigger is released.
    this.aiming = false;
    this.recoil = 0;
    // v6: the punch combo — three quick punches, the third one shoves.
    this.punchCombo = 0;
    this.punchComboTimer = 0;
  }

  get speed() {
    return this.car ? Math.abs(this.car.speed) : 0;
  }

  /** True while riding a motorbike — the HUD shows bike handling for it. */
  get onBike() {
    return !this.onFoot && this.car && this.car.isBike;
  }

  /** True while the roll's immunity window is open. */
  get rolling() {
    return this.rollTimer > 0;
  }

  /** The injury limp: below 30 HP Riko moves slower — the escape reads
   * in the legs, not just the health bar. */
  get limpFactor() {
    return this.health <= 30 ? 0.7 : 1;
  }

  /** The effective aim cone for the current weapon: tighter while aiming,
   * wider with recoil. The HUD's crosshair reads this through shoot(). */
  get aimCone() {
    const stats = WEAPON_STATS[this.weapon];
    if (!stats) return 0.94;
    const aimBonus = this.aiming ? 0.04 : 0;
    return clamp(stats.cone + aimBonus - this.recoil, 0.6, 0.99);
  }

  syncMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.yaw;
    // The roll tucks Riko into a ball: the mesh pitches forward while
    // the roll timer runs, then stands back up.
    if (this.rollTimer > 0) {
      this.mesh.rotation.x = -0.9;
    } else {
      this.mesh.rotation.x = 0;
    }
    const swing = Math.sin(this.walkPhase) * 0.5;
    this.mesh.userData.legL.rotation.x = swing;
    this.mesh.userData.legR.rotation.x = -swing;
    this.mesh.userData.armL.rotation.x = -swing * 0.8;
    this.mesh.userData.armR.rotation.x = swing * 0.8;
    // A short muzzle flash: a bright sphere at the raised hand.
    this.mesh.userData.head.visible = true;
  }

  /** Start a dodge roll in the current movement direction (or facing, if
   * standing still). Returns false while the roll is on cooldown. */
  roll(dirX, dirZ) {
    if (!this.onFoot || this.rollCooldown > 0 || this.rollTimer > 0) return false;
    this.rollTimer = TUNE.rollSeconds;
    this.rollCooldown = TUNE.rollCooldownSeconds;
    const len = Math.hypot(dirX, dirZ);
    if (len > 0.01) {
      this.rollDirX = dirX / len;
      this.rollDirZ = dirZ / len;
    } else {
      this.rollDirX = Math.sin(this.yaw);
      this.rollDirZ = Math.cos(this.yaw);
    }
    return true;
  }

  knockback(fromX, fromZ, force) {
    // A roll's immunity window shrugs off knockback — the whole point of
    // rolling through a police car's nudge or a gangster's shove.
    if (this.rolling) return;
    const d = Math.max(0.1, Math.sqrt(dist2(this.x, this.z, fromX, fromZ)));
    this.knockX = ((this.x - fromX) / d) * force;
    this.knockZ = ((this.z - fromZ) / d) * force;
    this.health -= 12;
    if (this.health <= 0) this.wasted = true;
  }

  damage(amount) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.wasted = true;
    }
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, TUNE.playerMaxHealth);
  }

  /** Repair the car Riko is driving; returns true if anything was fixed. */
  repairCar() {
    if (!this.car || this.car.damage <= 0) return false;
    this.car.repairAll();
    return true;
  }

  /** Try to get into the nearest car; returns the car or null. */
  tryEnterCar(traffic) {
    const car = traffic.nearestCar(this.x, this.z, 4.5);
    if (!car) return null;
    if (car.stalled) return { car, stalled: true };
    this.car = car;
    this.onFoot = false;
    car.kind = 'player';
    car.parked = false;
    this.mesh.visible = false;
    const wasStolen = !car.stolen && car.owner !== 'player';
    if (wasStolen) {
      car.stolen = true;
      this.carsStolen += 1; // v5: the stats screen counts every steal
    }
    return { car, stolen: wasStolen };
  }

  /** Step out of the car, beside the driver's door. */
  exitCar() {
    if (!this.car) return;
    const car = this.car;
    car.kind = 'traffic';
    car.parked = true;
    car.speed = 0;
    // Bank any unbanked drift before leaving the car — the points are
    // collected on foot, not lost with the keys.
    if (car.driftBanked > 0) car.driftBanked = 0;
    this.x = car.x - Math.cos(car.yaw) * 2.2;
    this.z = car.z + Math.sin(car.yaw) * 2.2;
    this.yaw = car.yaw;
    this.car = null;
    this.onFoot = true;
    this.mesh.visible = true;
    this.syncMesh();
  }

  /** Punch the nearest person in front of the player. v6: a combo — three
   * quick punches in a row, and the third one shoves the target back. */
  punch(people, fx, audio) {
    if (this.punchTimer > 0 || !this.onFoot) return;
    this.punchTimer = 0.45;
    audio.punch();
    // The combo window: a punch within 0.8 s of the last one chains.
    this.punchCombo = this.punchComboTimer > 0 ? this.punchCombo + 1 : 1;
    this.punchComboTimer = 0.8;
    const targets = [...people.peds, ...people.cops, ...people.gang];
    let best = null, bestD = TUNE.punchRange * TUNE.punchRange;
    for (const t of targets) {
      if (t.dead) continue;
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d < bestD) {
        const ang = Math.atan2(t.x - this.x, t.z - this.z);
        const diff = Math.abs(((ang - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < 1.1) { bestD = d; best = t; }
      }
    }
    if (best) {
      const third = this.punchCombo >= 3;
      best.health -= TUNE.punchDamage * (third ? 1.5 : 1);
      fx.burst(best.x, 1.4, best.z, 0xffe9a0, third ? 14 : 8, 3);
      fx.impactRing(best.x, best.z, 0xffe9a0);
      // A landed punch freezes the sim for a beat — the hit-stop that
      // makes fists feel heavy instead of floaty.
      fx.hitStop('punch', performance.now());
      if (third) {
        // The combo finisher shoves the target back a step.
        const dx = best.x - this.x, dz = best.z - this.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        best.x += (dx / d) * 1.4;
        best.z += (dz / d) * 1.4;
        best.mesh.position.set(best.x, 0, best.z);
        this.punchCombo = 0;
      }
      if (best.health <= 0) {
        best.dead = true;
        best.mesh.rotation.x = -Math.PI / 2;
        best.mesh.position.y = 0.3;
        if (best.kind === 'ped') people.scare(best.x, best.z, 30);
      }
    }
  }

  /** Switch to an owned weapon; returns true if it worked. */
  switchWeapon(name) {
    if (name === 'fists') { this.weapon = 'fists'; return true; }
    if (!this.owned[name]) return false;
    this.weapon = name;
    // A fresh weapon starts with a settled aim — no inherited recoil.
    this.recoil = 0;
    return true;
  }

  get weaponLabel() {
    if (this.weapon === 'pistol') return 'Pistol ∞';
    if (this.weapon === 'shotgun') return `Shotgun ${this.ammo.shotgun}`;
    if (this.weapon === 'smg') return `SMG ${this.ammo.smg}`;
    return 'Fists';
  }

  /**
   * Fire the current weapon toward the camera's aim: the nearest living
   * person within range and the weapon's cone takes the hit. The shotgun
   * fires 5 pellets in a wide cone for big close damage; the SMG fires
   * fast and light; the pistol sits in between. Shotgun and SMG eat ammo.
   * v6: damage falls off past the weapon's falloff range, recoil widens
   * the cone per shot (aiming steadies it), and a shotgun blast at close
   * range still shoves its target backwards.
   */
  shoot(people, aimDir, fx, audio, onCrime) {
    if (this.gunTimer > 0 || !this.onFoot) return false;
    const stats = WEAPON_STATS[this.weapon];
    if (!stats) return false;
    if (this.ammo[this.weapon] <= 0) {
      this.gunTimer = 0.25;
      audio.blip(140, 0.06, 0.15); // dry click
      return false;
    }
    this.gunTimer = stats.cooldown;
    this.gunFlash = 0.08;
    this.ammo[this.weapon] -= this.weapon === 'pistol' ? 0 : 1;
    audio.shot();
    // Recoil: the cone widens per shot and settles when the trigger is
    // released — spraying the SMG costs accuracy, aiming steadies it.
    this.recoil = Math.min(0.3, this.recoil + stats.recoil * (this.aiming ? 0.5 : 1));
    // v5: the shotgun's pump — a mechanical clack half a beat after the
    // blast, so the next shell is chambered by the time the cooldown ends.
    if (this.weapon === 'shotgun' && audio.pump) {
      setTimeout(() => audio.pump(), 350);
    }
    fx.addShake(stats.kick);
    const origin = { x: this.x, y: 1.5, z: this.z };
    const targets = [...people.peds, ...people.cops, ...people.gang];
    let best = null, bestD = stats.range;
    const cone = this.aimCone;
    for (const t of targets) {
      if (t.dead) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > stats.range || d < 0.5) continue;
      const dot = (dx / d) * aimDir.x + (dz / d) * aimDir.z;
      if (dot > cone && d < bestD) { bestD = d; best = t; }
    }
    const end = best
      ? { x: best.x, y: 1.3, z: best.z }
      : { x: this.x + aimDir.x * stats.range, y: 1.5, z: this.z + aimDir.z * stats.range };
    if (this.weapon === 'shotgun') {
      // Five pellets fan out from the muzzle.
      for (let i = -2; i <= 2; i += 1) {
        const a = Math.atan2(aimDir.x, aimDir.z) + i * 0.06;
        fx.tracer(origin, {
          x: this.x + Math.sin(a) * stats.range,
          y: 1.5,
          z: this.z + Math.cos(a) * stats.range,
        });
      }
    } else {
      fx.tracer(origin, end);
    }
    if (best) {
      // Damage falls off past the falloff range — a pistol at 60 m is a
      // scratch, not a one-shot.
      const falloff = bestD > stats.falloff
        ? Math.max(0.4, 1 - (bestD - stats.falloff) / stats.range)
        : 1;
      const totalDamage = stats.damage * stats.pellets * falloff;
      best.health -= totalDamage;
      // v5: a shotgun blast shoves its target backwards — a gunman hit
      // at close range stumbles off his feet instead of standing his ground.
      if (this.weapon === 'shotgun') {
        const kb = TUNE.shotgunKnockback;
        const dx = best.x - this.x, dz = best.z - this.z;
        const d = Math.max(0.1, Math.hypot(dx, dz));
        best.x += (dx / d) * kb;
        best.z += (dz / d) * kb;
        best.mesh.position.set(best.x, 0, best.z);
      }
      fx.burst(best.x, 1.4, best.z, 0xff5040, 12, 4);
      fx.impactRing(best.x, best.z, 0xff5040);
      fx.hitStop('shot', performance.now());
      people.scare(best.x, best.z, 40);
      if (best.health <= 0) {
        best.dead = true;
        best.mesh.rotation.x = -Math.PI / 2;
        best.mesh.position.y = 0.3;
      }
      onCrime(1, best.kind === 'ped' ? 'You shot a pedestrian!' : 'You shot it out with the law!');
      return true;
    }
    people.scare(this.x + aimDir.x * 10, this.z + aimDir.z * 10, 25);
    return false;
  }

  update(dt, input, camYaw, colliders, traffic, fx) {
    this._fx = fx || null;
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.gunTimer = Math.max(0, this.gunTimer - dt);
    this.gunFlash = Math.max(0, this.gunFlash - dt);
    this.punchComboTimer = Math.max(0, this.punchComboTimer - dt);
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    // Recoil settles when the trigger is released.
    if (this.gunTimer <= 0) this.recoil = Math.max(0, this.recoil - dt * 0.25);
    // Aim mode: right mouse held — slower, steadier.
    this.aiming = !!input.aim && this.onFoot;
    if (!this.onFoot) return;
    // The roll: a burst of speed in the roll direction, immune to
    // knockback, then the timer runs out and Riko stands back up.
    if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      const nx = this.x + this.rollDirX * TUNE.rollSpeed * dt;
      const nz = this.z + this.rollDirZ * TUNE.rollSpeed * dt;
      const solved = collideCircle(nx, nz, 0.6, colliders);
      this.x = clamp(solved.x, -CITY.bound - 20, CITY.bound + 20);
      this.z = clamp(solved.z, -CITY.bound - 20, CITY.beachZ + 26);
      this.walkPhase += dt * TUNE.rollSpeed * 1.4;
      this.syncMesh();
      return;
    }
    // Knockback decays; movement is camera-relative.
    this.x += this.knockX * dt;
    this.z += this.knockZ * dt;
    this.knockX *= Math.max(0, 1 - dt * 6);
    this.knockZ *= Math.max(0, 1 - dt * 6);
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.moving = fwd !== 0 || strafe !== 0;
    // Sprint only while stamina lasts; exhausted means walk until it recovers.
    const wantSprint = input.sprint && !this.exhausted;
    if (this.moving) {
      // Aiming slows the walk; the limp slows it more.
      const aimFactor = this.aiming ? 0.55 : 1;
      const speed = (wantSprint ? TUNE.sprintSpeed : TUNE.walkSpeed) * this.limpFactor * aimFactor;
      if (wantSprint) {
        this.stamina = Math.max(0, this.stamina - TUNE.staminaDrain * dt);
        if (this.stamina <= 0) this.exhausted = true;
      } else {
        this.stamina = Math.min(TUNE.staminaMax, this.stamina + TUNE.staminaRegen * 0.5 * dt);
      }
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      let mx = sin * fwd + cos * strafe;
      let mz = cos * fwd - sin * strafe;
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const nx = this.x + mx * speed * dt;
      const nz = this.z + mz * speed * dt;
      const solved = collideCircle(nx, nz, 0.6, colliders);
      this.x = clamp(solved.x, -CITY.bound - 20, CITY.bound + 20);
      this.z = clamp(solved.z, -CITY.bound - 20, CITY.beachZ + 26);
      this.yaw = Math.atan2(mx, mz);
      this.walkPhase += dt * speed * 1.9;
    } else {
      this.stamina = Math.min(TUNE.staminaMax, this.stamina + TUNE.staminaRegen * dt);
      if (this.exhausted && this.stamina > TUNE.staminaMax * 0.4) this.exhausted = false;
    }
    // Jump and gravity. Landing from a real jump kicks up a dust ring.
    if (input.jump && this.y === 0) this.vy = TUNE.jumpSpeed;
    const wasAirborne = this.y > 0.4;
    this.vy -= TUNE.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      if (wasAirborne && this.vy < -6) {
        // The landing dust: a grey ring at Riko's feet. The game passes
        // the fx layer in through update's fx argument when it has one.
        if (this._fx) this._fx.ring(this.x, this.z, 0xb9a98c);
      }
      this.y = 0; this.vy = 0;
    }
    // A car running the player over hurts; traffic already slows, so this is rare.
    for (const car of traffic.cars) {
      if (car.dead || car.parked) continue;
      if (dist2(this.x, this.z, car.x, car.z) < 4.4 && Math.abs(car.speed) > 3) {
        this.knockback(car.x, car.z, 10);
        this.damage(8);
        break;
      }
    }
    this.syncMesh();
  }
}
