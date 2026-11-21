// Effects: the cheap juice — particle bursts for hits and pickups, tracer
// lines for gunfire, and a screen-shake value the camera reads. One pooled
// THREE.Points cloud per burst, recycled, never allocated per frame.
//
// v3 adds smoke puffs that rise and linger (a dented car smokes, a hard
// crash leaves a grey cloud) and flat ring splashes for rain hitting the
// street and for pickups landing.
//
// v4 adds the game-feel layer from the feel skill: a HitStopManager that
// freezes the simulation for a few dozen milliseconds on a landed hit (a
// punch, a shot, a crash, a police ram), a TraumaShake that composes the
// camera shake as a decaying trauma value instead of raw randomness, and
// an impact flash ring that marks where a hit landed.
//
// v5 adds: a muzzle flash and a shotgun shockwave ring, and a burst cap
// (24 live bursts) so a big firefight cannot pile up unbounded particles.
import * as THREE from 'three';
import { makeRng, clamp } from './util.js';

/** Hit-stop: overlapping requests use the smallest active multiplier, each
 * with its own deadline; ticked on real time even while the sim is frozen.
 * baseScale is the external baseline policy (1.0 in normal play). */
export class HitStopManager {
  constructor(baseScale) {
    this.baseScale = baseScale || (() => 1);
    this.requests = []; // { scale, untilMs }
  }

  /** Freeze the sim at `scale` (0 = full stop) for `ms` milliseconds. */
  request(scale, ms, nowMs) {
    this.requests.push({ scale, untilMs: nowMs + ms });
  }

  /** Effective scale right now; prunes expired requests. */
  tick(nowMs) {
    this.requests = this.requests.filter((r) => nowMs < r.untilMs);
    let scale = this.baseScale();
    for (const r of this.requests) scale = Math.min(scale, r.scale);
    return scale;
  }
}

/** Trauma-based camera shake: trauma rises on impacts and decays; the
 * sampled offset is trauma^2, so small hits barely move the camera and
 * big ones kick hard. The offset is a visual delta only — it never moves
 * the player, the cars or the aim ray. */
export class TraumaShake {
  constructor() {
    this.trauma = 0;
    this.reducedMotion = false;
  }

  add(amount) {
    if (this.reducedMotion) return;
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Sample a shake offset for this frame; dt is real seconds. */
  sample(dt, timeSeconds) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const mag = this.trauma * this.trauma * 0.55;
    return {
      x: mag * Math.sin(timeSeconds * 47.3),
      y: mag * Math.cos(timeSeconds * 39.7),
      mag,
    };
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.bursts = [];
    this.tracers = [];
    this.puffs = [];
    this.rings = [];
    this.shake = 0;
    this.rng = makeRng(99);
    // v4 feel layer: hit-stop + trauma shake, owned here, driven by the
    // game loop (main.js ticks the hit-stop and reads the shake sample).
    this.hitstop = new HitStopManager(() => 1);
    this.trauma = new TraumaShake();
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        this.trauma.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (err) { /* headless or no media support: keep shake on */ }
    }
  }

  /** Freeze the sim briefly on a landed hit: `kind` is punch | shot |
   * crash | ram, and the durations come from TUNE. v6 adds `roll` (a
   * dodge roll landing — a tiny 30 ms settle) and `drift` (a drift bank
   * paying out — a 40 ms celebratory freeze). */
  hitStop(kind, nowMs) {
    const ms = { punch: 55, shot: 70, crash: 90, ram: 110, roll: 30, drift: 40 }[kind] || 60;
    this.hitstop.request(0, ms, nowMs);
    this.trauma.add(kind === 'ram' ? 0.55 : kind === 'crash' ? 0.45 : kind === 'roll' ? 0.1 : 0.3);
  }

  /** A bright flash ring on the ground where an impact landed. */
  impactRing(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.9, 24),
      new THREE.MeshBasicMaterial({ color: color || 0xffe9a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.09, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.45, maxLife: 0.45 });
  }

  /** v5: a muzzle flash at the gun — a bright sphere that lives one
   * frame, so a shotgun blast reads as a flash as well as a bang. */
  muzzleFlash(x, y, z, big) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(big ? 0.55 : 0.34, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.95 }),
    );
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.07, maxLife: 0.07, flash: true });
  }

  /** v5: a shockwave ring for a shotgun blast — wider and faster than the
   * impact ring, so the spread shot has its own ground signature. */
  shockwave(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.4, 24),
      new THREE.MeshBasicMaterial({ color: color || 0xffc94f, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.09, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.4, maxLife: 0.4 });
  }

  // --- v6: drift smoke, sparks, dust, beacons and confetti -----------------
  //
  // A drift slide leaves a trail of pale tyre smoke behind the rear wheels;
  // a roll landing kicks up dust; a hard hit throws orange sparks; a
  // mission objective gets a light pillar the player can see across the
  // city; a completed mission rains confetti. Each is a small pooled effect
  // on the same lifecycle as the bursts above.

  /** Pale tyre smoke at a drifting car's rear wheels. */
  driftSmoke(x, y, z) {
    this.smoke(x, y, z, 3);
    // Tyre smoke is bluer and thinner than crash smoke — retint the last
    // puff the smoke() call just pushed.
    const p = this.puffs[this.puffs.length - 1];
    if (p) p.points.material.color.set(0x9aa4b0);
  }

  /** Orange sparks from a hard impact or a skid on metal — fast, bright,
   * short-lived, with a little gravity. */
  sparks(x, y, z, count) {
    const n = count || 10;
    if (this.bursts.length >= 24) {
      const old = this.bursts.shift();
      this.scene.remove(old.points);
      old.points.geometry.dispose();
      old.points.material.dispose();
    }
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const velocities = [];
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const a = this.rng.range(0, Math.PI * 2);
      velocities.push({
        x: Math.cos(a) * this.rng.range(2, 7),
        y: this.rng.range(2, 6),
        z: Math.sin(a) * this.rng.range(2, 7),
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffa62b, size: 0.18, transparent: true, opacity: 1 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0.45, maxLife: 0.45 });
  }

  /** A brown dust cloud at ground level — a roll landing, a dirt-track
   * slide, a car pulling off the road onto the beach. */
  dustCloud(x, z, count) {
    const n = count || 8;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(n * 3);
    const velocities = [];
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = x + this.rng.range(-0.8, 0.8);
      positions[i * 3 + 1] = 0.3;
      positions[i * 3 + 2] = z + this.rng.range(-0.8, 0.8);
      velocities.push({
        x: this.rng.range(-1.2, 1.2),
        y: this.rng.range(0.4, 1.2),
        z: this.rng.range(-1.2, 1.2),
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xb9a98c, size: 0.7, transparent: true, opacity: 0.8 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.puffs.push({ points, velocities, life: 1.1, maxLife: 1.1 });
  }

  /** A vertical light pillar marking a mission objective — visible across
   * the city, pulsing gently. Returns a handle; call `clearBeacon(handle)`
   * when the objective is done. */
  beacon(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: color || 0xffd166, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    mesh.position.set(x, 30, z);
    this.scene.add(mesh);
    if (!this.beacons) this.beacons = [];
    const handle = { mesh, phase: this.rng.range(0, Math.PI * 2) };
    this.beacons.push(handle);
    return handle;
  }

  /** Remove a beacon placed by `beacon()`. Safe to call twice. */
  clearBeacon(handle) {
    if (!handle || !this.beacons) return;
    const i = this.beacons.indexOf(handle);
    if (i < 0) return;
    this.beacons.splice(i, 1);
    this.scene.remove(handle.mesh);
    handle.mesh.geometry.dispose();
    handle.mesh.material.dispose();
  }

  /** Confetti for a completed mission: coloured bursts from above the
   * player, falling slowly. */
  confetti(x, y, z) {
    const colors = [0xff5d8f, 0xffd166, 0x2bb3a3, 0x7c5cff, 0xffa62b];
    for (let c = 0; c < colors.length; c += 1) {
      this.burst(x + this.rng.range(-1, 1), y + this.rng.range(0, 2), z + this.rng.range(-1, 1), colors[c], 8, 2);
    }
  }

  /** A dark skid mark where a handbrake slide happened: a flat quad that
   * fades slowly. Pooled to 40 marks; the oldest is recycled first. */
  skidMark(x, z, yaw) {
    if (!this.skids) this.skids = [];
    let mark;
    if (this.skids.length >= 40) {
      mark = this.skids.shift();
      mark.mesh.visible = true;
    } else {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 2.2),
        new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      mark = { mesh, life: 9 };
      this.skids.push(mark);
    }
    mark.mesh.position.set(x, 0.07, z);
    mark.mesh.rotation.z = yaw;
    mark.life = 9;
    mark.mesh.material.opacity = 0.55;
  }

  burst(x, y, z, color, count, speed) {
    // v5 perf: cap live bursts at 24 — a shotgun blast plus a crash plus
    // a gang firefight must not pile up unbounded Points clouds.
    if (this.bursts.length >= 24) {
      const old = this.bursts.shift();
      this.scene.remove(old.points);
      old.points.geometry.dispose();
      old.points.material.dispose();
    }
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      const a = this.rng.range(0, Math.PI * 2);
      const b = this.rng.range(-1, 1);
      velocities.push({
        x: Math.cos(a) * speed * this.rng.range(0.4, 1),
        y: b * speed + speed * 0.5,
        z: Math.sin(a) * speed * this.rng.range(0.4, 1),
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.22, transparent: true, opacity: 1 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, velocities, life: 0.7, maxLife: 0.7 });
  }

  /** A slow grey puff that rises and spreads — car smoke, crash dust. */
  smoke(x, y, z, count) {
    const geo = new THREE.BufferGeometry();
    const n = count || 6;
    const positions = new Float32Array(n * 3);
    const velocities = [];
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = x + this.rng.range(-0.6, 0.6);
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z + this.rng.range(-0.6, 0.6);
      velocities.push({
        x: this.rng.range(-0.4, 0.4),
        y: this.rng.range(1.2, 2.4),
        z: this.rng.range(-0.4, 0.4),
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x777777, size: 0.6, transparent: true, opacity: 0.7 });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.puffs.push({ points, velocities, life: 1.6, maxLife: 1.6 });
  }

  /** A flat ring on the ground that grows and fades — rain splash, pickup. */
  ring(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.5, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.5, maxLife: 0.5 });
  }

  tracer(from, to) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      from.x, from.y, from.z, to.x, to.y, to.z,
    ]), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09, maxLife: 0.09 });
  }

  addShake(amount) {
    this.shake = Math.min(0.6, this.shake + amount);
    this.trauma.add(amount);
  }

  /** Current trauma-shake offset for the camera this frame. */
  shakeSample(dt, timeSeconds) {
    return this.trauma.sample(dt, timeSeconds);
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.life -= dt;
      const attr = b.points.geometry.getAttribute('position');
      for (let j = 0; j < b.velocities.length; j += 1) {
        const v = b.velocities[j];
        v.y -= 9 * dt;
        attr.array[j * 3] += v.x * dt;
        attr.array[j * 3 + 1] += v.y * dt;
        attr.array[j * 3 + 2] += v.z * dt;
        if (attr.array[j * 3 + 1] < 0.05) attr.array[j * 3 + 1] = 0.05;
      }
      attr.needsUpdate = true;
      b.points.material.opacity = Math.max(0, b.life / b.maxLife);
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const p = this.puffs[i];
      p.life -= dt;
      const attr = p.points.geometry.getAttribute('position');
      for (let j = 0; j < p.velocities.length; j += 1) {
        const v = p.velocities[j];
        attr.array[j * 3] += v.x * dt;
        attr.array[j * 3 + 1] += v.y * dt;
        attr.array[j * 3 + 2] += v.z * dt;
      }
      attr.needsUpdate = true;
      p.points.material.opacity = Math.max(0, (p.life / p.maxLife) * 0.7);
      p.points.material.size += dt * 0.5;
      if (p.life <= 0) {
        this.scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
        this.puffs.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i];
      r.life -= dt;
      const grow = 1 + (1 - r.life / r.maxLife) * 3;
      r.mesh.scale.setScalar(grow);
      r.mesh.material.opacity = Math.max(0, r.life / r.maxLife) * 0.8;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i -= 1) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // Skid marks fade over nine seconds, then hide until recycled.
    if (this.skids) {
      for (const s of this.skids) {
        if (!s.mesh.visible) continue;
        s.life -= dt;
        s.mesh.material.opacity = Math.max(0, (s.life / 9) * 0.55);
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    // v6: beacons pulse — their opacity breathes slowly so the pillar
    // reads as alive, not a static column.
    if (this.beacons) {
      for (const b of this.beacons) {
        b.phase += dt * 2.2;
        b.mesh.material.opacity = 0.16 + Math.sin(b.phase) * 0.08;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }
}
