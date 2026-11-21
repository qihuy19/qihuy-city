// Police helicopter pursuit, v8: the eye in the sky becomes a real
// adversary instead of a circling prop. The two traffic helicopters
// already spawn at 3+ stars (5 stars for the second one); this system
// gives them a brain — an air-pursuit state machine, a searchlight that
// builds a lock on Riko, ground-unit coordination while the beam holds
// him, evasion through tunnels and interiors, rotor wash that shakes
// the camera when a chopper sits low overhead, and a health pool so
// Riko can shoot a helicopter down for a bounty.
//
// The states, per helicopter:
//   TRACK — circle the player at a radius that shrinks with the wanted
//     level, beam sweeping, lock building whenever the beam holds him.
//   LOCK — the beam is pinned: wanted decay pauses, every ground unit's
//     last-known position refreshes to Riko's real spot, and the HUD
//     shows the lock percentage climbing toward a full pin.
//   SEARCH — the beam lost him (interior, safehouse, tunnel shadow):
//     the chopper circles the last-known spot and the lock bleeds off.
//   DOWN — hit points gone: the chopper falls burning, the wanted
//     level drops a star, and a bounty lands in the ledger.
//
// Evasion is real: stepping into an interior (shop, casino, safehouse
// room) or the safehouse grounds breaks the beam instantly, and at
// night the lock builds slower in fog. Shooting a chopper down takes
// sustained fire — a pistol chips it, a shotgun hurts up close, an SMG
// chews it at mid range — and a downed chopper stays down for a
// cooldown, so the sky is quiet for a while after a kill.
//
// The system owns no DOM of its own except one line it writes itself
// (#heli-line, added to index.html in v8): the air unit's callsign, its
// state and the lock meter. The minimap already draws the helicopter
// dots; this line is the air picture in words.
import { TUNE } from './config.js';
import { clamp, clamp01, dist2, lerp, money } from './util.js';

/** Air-unit callsigns, in the same style as the ground roster. */
export const HELI_CALLSIGNS = ['AIR-1', 'AIR-2'];

/** Hit points per helicopter, by wanted level: a hotter chase flies a
 * tougher airframe, so a five-star chopper takes noticeably more fire
 * than the first three-star one. */
export const HELI_HP = { 3: 120, 4: 150, 5: 190 };

/** Damage one shot does to a helicopter, by weapon. The shotgun's five
 * pellets land as one close-range hit; the SMG is the best anti-air
 * gun Riko owns, because it keeps hitting at the range a chopper
 * circles at. */
export const HELI_WEAPON_DAMAGE = {
  pistol: 12,
  shotgun: 34,
  smg: 9,
  fists: 0,
};

/** How far each weapon can reach a helicopter, in metres. A chopper
 * circles at 26–40 m, so the pistol and SMG can reach it and the
 * shotgun only can when it dives low to hold the lock. */
export const HELI_WEAPON_RANGE = {
  pistol: 110,
  shotgun: 60,
  smg: 95,
  fists: 0,
};

/** Bounty for shooting a police helicopter down, by the wanted level
 * it was flying at: hotter sky, bigger bounty. */
export const HELI_BOUNTY = { 3: 150, 4: 200, 5: 300 };

/** Seconds of lock for a full pin: the beam must hold Riko this long
 * (outdoors, in the open) before the wanted level stops decaying. */
export const HELI_LOCK_SECONDS = 6;

/** Seconds a downed helicopter stays down before the dispatcher sends
 * a replacement — the sky goes quiet after a kill. */
export const HELI_DOWN_COOLDOWN = 25;

/** How close the beam must be, horizontally, to count as "on" Riko:
 * the spotlight radius from the tune, plus a little slack for a
 * moving target. */
export const HELI_BEAM_SLACK = 6;

/** The searchlight's states, as words the HUD and the trace can use. */
export const HELI_STATES = ['TRACK', 'LOCK', 'SEARCH', 'DOWN'];

/** One air unit's live state: which traffic helicopter it watches, its
 * hit points, its lock, and the last-known spot it circles when the
 * beam loses Riko. */
export class AirUnit {
  constructor(callsign) {
    this.callsign = callsign;
    this.state = 'TRACK';
    this.hp = HELI_HP[3];
    this.maxHp = HELI_HP[3];
    this.lock = 0; // 0..1 — 1 is a full pin on Riko
    this.lastKnown = null;
    this.searchTimer = 0;
    this.smokeTimer = 0;
    this.downAt = -99;
    this.hitsTaken = 0;
    this.lockPeaked = 0;
  }

  /** The lock as a whole percent, for the HUD line. */
  get lockPct() {
    return Math.round(this.lock * 100);
  }

  /** True while the beam is pinned hard enough to freeze wanted decay. */
  get pinned() {
    return this.lock >= 1;
  }

  /** True while the airframe is burning and falling. */
  get down() {
    return this.state === 'DOWN';
  }

  /** Reset for a fresh game: full health, no lock, no last-known spot. */
  reset() {
    this.state = 'TRACK';
    this.hp = HELI_HP[3];
    this.maxHp = HELI_HP[3];
    this.lock = 0;
    this.lastKnown = null;
    this.searchTimer = 0;
    this.smokeTimer = 0;
    this.downAt = -99;
    this.hitsTaken = 0;
    this.lockPeaked = 0;
  }
}

/** The helicopter pursuit brain: two air units, one per traffic
 * helicopter, updated every frame from the game's wanted level, the
 * player's position and whether he is under cover. */
export class HeliPursuit {
  constructor(game) {
    this.game = game;
    this.units = [new AirUnit('AIR-1'), new AirUnit('AIR-2')];
    // Seconds until a replacement chopper may spawn after a shoot-down.
    this.downCooldown = 0;
    // Lifetime stats, for the pause screen and the play-test.
    this.stats = {
      helisDowned: 0,
      shotsLanded: 0,
      lockSeconds: 0,
      evasions: 0,
      bountiesEarned: 0,
    };
    // The HUD line this system writes, cached after the first frame.
    this.lineEl = null;
    // The last lock state, so the HUD only rewrites when it changes.
    this.lastLine = '';
    // Was Riko under cover last frame — used to count an evasion once
    // per break, not once per frame.
    this.wasCovered = false;
    // A short grace after a shoot-down, during which the dispatcher
    // stays quiet instead of immediately re-tasking the sky.
    this.quietTimer = 0;
  }

  // ----- helpers ----------------------------------------------------------
  /** The traffic helicopters, in callsign order: index 0 is AIR-1
   * (the 3-star chopper), index 1 is AIR-2 (the 5-star second one). */
  heliAt(i) {
    return i === 0 ? this.game.traffic.heli : this.game.traffic.heli2;
  }

  /** True while Riko is under cover — inside an interior room, or on
   * the safehouse grounds, where the beam cannot reach him. The
   * safehouse is a walled compound: the chopper can see the street
   * outside it, not Riko inside it. */
  playerUnderCover() {
    const g = this.game;
    if (g.interiors && g.interiors.inside) return true;
    const safe = g.safePos || { x: -124, z: 124 };
    return dist2(g.player.x, g.player.z, safe.x, safe.z) < 64;
  }

  /** True while the player is on the water in a boat: the beam still
   * finds him out there (open sky), but the ground units cannot follow
   * — the lock builds, the search does not. */
  playerOnWater() {
    const g = this.game;
    return !!(g.boats && g.boats.playerBoat);
  }

  /** The lock's build rate: slower in fog (the beam scatters), slower
   * at night only if the beam is the only light — the searchlight is
   * brightest at night, so night itself does not slow it. Rain slows
   * it a little: the beam cuts the rain, but not cleanly. */
  lockRate() {
    const g = this.game;
    const weather = g.weather ? g.weather.state : 'clear';
    if (weather === 'fog') return 0.55;
    if (weather === 'rain') return 0.8;
    if (weather === 'storm') return 0.65;
    return 1;
  }

  /** The wanted level this airframe is flying at, for its hit points
   * and its bounty: the hotter the chase, the tougher the chopper. */
  wantedFor(i) {
    return i === 0 ? Math.max(3, this.game.wanted) : 5;
  }

  // ----- per-frame ----------------------------------------------------------
  /** One tick: spawn health for new choppers, track the beam, build or
   * bleed the lock, coordinate the ground units, shake the camera under
   * rotor wash, and keep the HUD line current. */
  update(dt) {
    const g = this.game;
    if (this.downCooldown > 0) this.downCooldown -= dt;
    if (this.quietTimer > 0) this.quietTimer -= dt;
    const covered = this.playerUnderCover();
    if (covered && !this.wasCovered) {
      // A fresh break: the beam just lost him — count one evasion.
      this.stats.evasions += 1;
      for (const unit of this.units) {
        if (unit.lock > 0.25) {
          unit.state = 'SEARCH';
          unit.searchTimer = 0;
        }
      }
    }
    this.wasCovered = covered;
    const onWater = this.playerOnWater();
    for (let i = 0; i < this.units.length; i += 1) {
      const unit = this.units[i];
      const heli = this.heliAt(i);
      if (!heli) {
        // No airframe up: the lock bleeds off fast, and the unit waits.
        if (unit.state !== 'DOWN') {
          unit.lock = Math.max(0, unit.lock - dt * 0.5);
          if (unit.lock <= 0) unit.state = 'TRACK';
        }
        continue;
      }
      // A fresh airframe (just spawned by the traffic system) gets full
      // hit points for the wanted level it is flying at.
      if (heli.hp === undefined || heli.hp <= 0) {
        const wanted = this.wantedFor(i);
        heli.hp = HELI_HP[wanted] || HELI_HP[3];
        heli.maxHp = heli.hp;
        heli.unitIndex = i;
        unit.hp = heli.hp;
        unit.maxHp = heli.hp;
        unit.state = 'TRACK';
        unit.lock = 0;
      }
      unit.hp = heli.hp;
      this.updateUnit(unit, heli, i, dt, covered, onWater);
    }
    // A downed chopper's replacement is held back while the cooldown
    // runs: pull any airframe the traffic system spawned too early, so
    // the sky stays quiet for the full cooldown after a kill. The
    // traffic system spawns a fresh chopper the frame after a
    // shoot-down (the wanted level is still 3+), so the guard removes
    // whatever is up — the replacement only sticks once the cooldown
    // has run out.
    if (this.downCooldown > 0) {
      if (g.traffic.heli) g.traffic.removeHeli();
      if (g.traffic.heli2) g.traffic.removeHeli2();
    }
    this.updateHud();
  }

  /** One air unit's tick: beam tracking, lock building or bleeding,
   * ground coordination, rotor wash and smoke. */
  updateUnit(unit, heli, index, dt, covered, onWater) {
    const g = this.game;
    const player = g.player;
    const dx = player.x - heli.x;
    const dz = player.z - heli.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    const beamRadius = (TUNE.heliSpotlightRadius || 14) + HELI_BEAM_SLACK;
    const beamOnPlayer = horizontal < beamRadius && !covered;
    // The beam follows Riko: while tracking, the chopper's searchlight
    // mesh is kept visible and brightened with the lock, so the cone
    // reads as a live spotlight instead of a static prop.
    const beam = heli.mesh && heli.mesh.userData ? heli.mesh.userData.beam : null;
    if (beam) {
      beam.visible = true;
      beam.material.opacity = 0.14 + unit.lock * 0.22;
      // Aim the cone at the player: the beam hangs under the nose, so
      // tilt it toward him — a small pitch that grows as he gets
      // further off the vertical.
      const tilt = clamp(horizontal / 60, 0, 0.6);
      beam.rotation.x = tilt * Math.sign(dz || 1) * 0.5;
      beam.rotation.z = -tilt * Math.sign(dx || 1) * 0.5;
    }
    // The airframe leans into the chase: at high lock it drops lower
    // and tighter, so a pinned Riko sees the chopper fill the sky.
    // The hover: a police helicopter does not orbit its suspect at
    // arm's length — it sits over him. The traffic system's orbit
    // holds the chopper ~26 m out, which is further than the beam
    // reaches (spotlight radius 9 + slack 6 = 15 m), so the beam
    // could never hold Riko at all. This brain pulls the hover point
    // in to ~10 m (6 m pinned), lerping harder than the orbit does,
    // so the rendered position settles overhead and the beam lands.
    const wanted = this.wantedFor(index);
    const hoverRadius = unit.pinned ? 6 : 10;
    const hoverSpeed = 0.25 + wanted * 0.03;
    heli.angle = (heli.angle || 0) + dt * hoverSpeed * 0.4;
    if (unit.state === 'SEARCH' && unit.lastKnown) {
      // Searching: circle the last-known spot, not Riko — the beam
      // sweeps the ground where he was last seen.
      const lx = unit.lastKnown.x - heli.x;
      const lz = unit.lastKnown.z - heli.z;
      const ld = Math.sqrt(lx * lx + lz * lz);
      if (ld > 24) {
        heli.x += (lx / ld) * dt * 18;
        heli.z += (lz / ld) * dt * 18;
      }
      unit.searchTimer += dt;
      if (unit.searchTimer > 14) {
        // Fourteen seconds of searching an empty spot and the air unit
        // gives up: the lock is gone and it goes back to tracking.
        unit.state = 'TRACK';
        unit.lastKnown = null;
        unit.searchTimer = 0;
      }
    } else if (!heli.fixed) {
      // Tracking: hover over the player, circling slowly overhead —
      // the lerp here is stronger than the traffic orbit's, so the
      // chopper settles above Riko instead of circling out of beam
      // range. A staged (fixed) chopper keeps its pose: the shot
      // owns it, not the brain.
      const tx = player.x + Math.cos(heli.angle) * hoverRadius;
      const tz = player.z + Math.sin(heli.angle) * hoverRadius;
      heli.x = lerp(heli.x, tx, clamp(dt * 2, 0, 1));
      heli.z = lerp(heli.z, tz, clamp(dt * 2, 0, 1));
    }
    if (beamOnPlayer) {
      // The beam holds him: the lock builds, faster in clear weather,
      // slower in fog and rain — and the unit remembers where he is.
      const rate = this.lockRate() / HELI_LOCK_SECONDS;
      unit.lock = clamp01(unit.lock + rate * dt);
      unit.lockPeaked = Math.max(unit.lockPeaked, unit.lock);
      unit.lastKnown = { x: player.x, z: player.z };
      unit.state = unit.pinned ? 'LOCK' : 'TRACK';
      if (unit.pinned) {
        this.stats.lockSeconds += dt;
        // A pinned Riko is a known Riko: every ground unit's last-known
        // position refreshes to his real spot, so the patrol cars stop
        // searching where he was and converge on where he is. On the
        // water the ground units cannot follow, so they hold their
        // search instead of driving into the sea.
        if (!onWater) {
          for (const cop of g.traffic.police) {
            if (cop.brain) {
              cop.brain.blackboard.lastKnown = { x: player.x, z: player.z };
              cop.brain.blackboard.lastSeenAt = g.time;
              cop.brain.blackboard.seenRecently = true;
              cop.brain.blackboard.sinceSeen = 0;
            }
          }
        }
      }
    } else {
      // The beam lost him: the lock bleeds off — fast under cover,
      // slower in the open (the chopper keeps sweeping).
      const bleed = covered ? 0.6 : 0.18;
      unit.lock = Math.max(0, unit.lock - bleed * dt);
      if (unit.lock <= 0 && unit.state !== 'SEARCH') unit.state = 'TRACK';
      if (covered && unit.lastKnown) {
        unit.state = 'SEARCH';
        unit.searchTimer = 0;
      }
    }
    // Rotor wash: a low chopper shakes the camera and kicks dust off
    // the street, so a close pass feels like weather, not a model.
    if (horizontal < 26 && heli.y < 30) {
      const strength = clamp01(1 - horizontal / 26) * 0.25;
      g.fx.addShake(strength * dt * 8);
      unit.smokeTimer -= dt;
      if (unit.smokeTimer <= 0) {
        unit.smokeTimer = 0.4;
        g.fx.burst(heli.x, 0.4, heli.z, 0xcfc4a8, 3, 1.5);
      }
    }
    // A damaged airframe smokes: the worse the hit points, the thicker
    // the trail, so Riko can see his fire is landing.
    if (unit.hp < unit.maxHp * 0.6) {
      unit.smokeTimer -= dt;
      if (unit.smokeTimer <= 0) {
        unit.smokeTimer = unit.hp < unit.maxHp * 0.3 ? 0.12 : 0.3;
        g.fx.burst(heli.x, heli.y - 1, heli.z, 0x333333, 4, 1);
      }
    }
  }

  /** True while any air unit has a full pin on Riko — the wanted level
   * does not decay while the beam holds him. The game reads this next
   * to the night-spotlight rule it already had. */
  get locked() {
    return this.units.some((u) => u.pinned);
  }

  /** True while any helicopter is overhead at all. */
  get overhead() {
    return !!(this.game.traffic.heli || this.game.traffic.heli2);
  }

  /** The highest lock any unit holds, 0..1 — the HUD's meter. */
  get maxLock() {
    return Math.max(0, ...this.units.map((u) => u.lock));
  }

  // ----- shooting a helicopter down -----------------------------------------
  /** A shot Riko just fired: if the aim ray passes close to a
   * helicopter inside the weapon's range, the round lands. The aim is
   * the camera's yaw direction (the same aim the player shoot uses),
   * so a chopper has to be roughly in the crosshair — spraying the sky
   * does not count. Returns the damage dealt, or 0 for a miss. */
  registerShot(aimDir, weapon) {
    const g = this.game;
    if (!g.player.onFoot) return 0;
    const damage = HELI_WEAPON_DAMAGE[weapon] || 0;
    const range = HELI_WEAPON_RANGE[weapon] || 0;
    if (damage <= 0 || range <= 0) return 0;
    let dealt = 0;
    for (let i = 0; i < this.units.length; i += 1) {
      const heli = this.heliAt(i);
      if (!heli || heli.hp === undefined || heli.hp <= 0) continue;
      const dx = heli.x - g.player.x;
      const dz = heli.z - g.player.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > range || d < 1) continue;
      // The aim cone: the helicopter must be within ~18 degrees of the
      // aim ray — a generous cone, because a chopper is a big target
      // and the player is shooting up at it, not along the ground.
      const dot = (dx / d) * aimDir.x + (dz / d) * aimDir.z;
      if (dot < 0.94) continue;
      // Height matters: a chopper at 38 m is a harder shot than one
      // diving to 14 m to hold the lock — damage falls off with the
      // slant range, not just the ground distance.
      const slant = Math.sqrt(d * d + heli.y * heli.y);
      const falloff = slant > range ? 0.5 : 1;
      const hit = Math.round(damage * falloff);
      heli.hp -= hit;
      this.units[i].hp = heli.hp;
      this.units[i].hitsTaken += 1;
      this.stats.shotsLanded += 1;
      dealt += hit;
      // A hit sparks off the airframe and kicks the camera a touch.
      g.fx.burst(heli.x, heli.y, heli.z, 0xffc040, 6, 3);
      g.fx.addShake(0.08);
      if (heli.hp <= 0) this.shootDown(i);
      // One shot, one helicopter: the round does not pass through.
      break;
    }
    return dealt;
  }

  /** A helicopter's hit points hit zero: it falls burning, the wanted
   * level drops a star, a bounty lands, and the sky stays quiet for
   * the cooldown. */
  shootDown(index) {
    const g = this.game;
    const unit = this.units[index];
    const heli = this.heliAt(index);
    const wanted = this.wantedFor(index);
    const bounty = HELI_BOUNTY[wanted] || HELI_BOUNTY[3];
    unit.state = 'DOWN';
    unit.downAt = g.time;
    unit.lock = 0;
    this.stats.helisDowned += 1;
    this.stats.bountiesEarned += bounty;
    this.downCooldown = HELI_DOWN_COOLDOWN;
    this.quietTimer = 4;
    if (heli) {
      // The fall: a fireball where the chopper was, a smoke column,
      // and the airframe gone — the traffic system will spawn a fresh
      // one only after the cooldown, and this one is marked so the
      // cooldown guard knows it was a shoot-down, not a despawn.
      g.fx.burst(heli.x, heli.y, heli.z, 0xff8020, 26, 7);
      g.fx.burst(heli.x, heli.y - 4, heli.z, 0x333333, 18, 4);
      g.fx.impactRing(heli.x, heli.z, 0xff8020);
      g.fx.addShake(0.7);
      g.fx.hitStop('shot', performance.now());
      heli.justDowned = true;
      if (index === 0) g.traffic.removeHeli();
      else g.traffic.removeHeli2();
    }
    // The heat drops a star: taking down the eye in the sky buys
    // breathing room, and the ground units lose their air cover.
    if (g.wanted > 0) g.setWanted(g.wanted - 1);
    if (g.economy) g.economy.earn('sidejob', bounty, `${unit.callsign} shot down — air bounty`);
    if (g.audio && g.audio.dispatch) g.audio.dispatch();
    g.missions.say(
      `${unit.callsign} is down! +$${bounty} air bounty — the heat drops a star.`,
      5,
    );
  }

  // ----- HUD ------------------------------------------------------------------
  /** The air picture, as one line: callsign, state, lock meter, hit
   * points — or nothing at all when the sky is empty, so the line
   * stays out of the way in a quiet moment. */
  hudLine() {
    const g = this.game;
    if (g.wanted < 3 && !this.overhead) return '';
    const parts = [];
    for (let i = 0; i < this.units.length; i += 1) {
      const unit = this.units[i];
      const heli = this.heliAt(i);
      if (!heli) {
        if (this.downCooldown > 0) {
          parts.push(`${unit.callsign} DOWN — next air unit in ${Math.ceil(this.downCooldown)}s`);
        }
        continue;
      }
      const hpPct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
      const lockBar = '█'.repeat(Math.round(unit.lock * 10)) + '░'.repeat(10 - Math.round(unit.lock * 10));
      const stateWord = unit.pinned ? 'PINNED' : unit.state === 'SEARCH' ? 'SEARCHING' : 'TRACKING';
      parts.push(`🚁 ${unit.callsign} ${stateWord} [${lockBar}] ${unit.lockPct}% · HULL ${hpPct}%`);
    }
    if (this.downCooldown > 0 && parts.length === 0) {
      return `🚁 Sky clear — next air unit in ${Math.ceil(this.downCooldown)}s`;
    }
    return parts.join('  ·  ');
  }

  updateHud() {
    if (!this.lineEl) {
      if (typeof document === 'undefined') return;
      this.lineEl = document.getElementById('heli-line');
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
      helisDowned: this.stats.helisDowned,
      shotsLanded: this.stats.shotsLanded,
      evasions: this.stats.evasions,
      bountiesEarned: this.stats.bountiesEarned,
      lockSeconds: Math.floor(this.stats.lockSeconds),
      lockPeaked: Math.max(0, ...this.units.map((u) => Math.round(u.lockPeaked * 100))),
    };
  }

  restore(data) {
    if (!data) return;
    this.stats.helisDowned = data.helisDowned || 0;
    this.stats.shotsLanded = data.shotsLanded || 0;
    this.stats.evasions = data.evasions || 0;
    this.stats.bountiesEarned = data.bountiesEarned || 0;
    this.stats.lockSeconds = data.lockSeconds || 0;
  }

  /** A fresh game: both units reset, no cooldown, no stats. */
  reset() {
    for (const unit of this.units) unit.reset();
    this.downCooldown = 0;
    this.quietTimer = 0;
    this.wasCovered = false;
    this.stats = {
      helisDowned: 0,
      shotsLanded: 0,
      lockSeconds: 0,
      evasions: 0,
      bountiesEarned: 0,
    };
    this.lastLine = '';
    this.updateHud();
  }

  /** One line for the stats screen: what the sky cost him, and what
   * he took out of it. */
  summaryLine() {
    const s = this.stats;
    if (s.helisDowned === 0 && s.evasions === 0) return 'No air pursuit yet — stay under 3 stars.';
    const bits = [];
    if (s.helisDowned > 0) bits.push(`${s.helisDowned} chopper${s.helisDowned > 1 ? 's' : ''} down ($${s.bountiesEarned} bounties)`);
    if (s.evasions > 0) bits.push(`${s.evasions} beam evasion${s.evasions > 1 ? 's' : ''}`);
    if (s.shotsLanded > 0) bits.push(`${s.shotsLanded} air hits`);
    return `Air pursuit: ${bits.join(' · ')}.`;
  }
}
