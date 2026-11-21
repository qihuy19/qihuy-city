// Weather for Qihuy City: a slow cycle between clear skies, rain, fog and
// storm, each with its own sky colour, fog range, road grip and light level.
// Rain is a recycled THREE.Points cloud falling around the camera; a storm
// adds lightning flashes that briefly light the whole scene. The weather
// changes the driving itself — wet roads grip less, so a chase in the rain
// slides wider than one in the sun — and the HUD shows the current state.
//
// v5: weather is gameplay, not scenery — rain leaves the roads wet after
// it stops (wetness), and fog/rain/storm trim police sight range, so the
// same chase plays differently under different skies.
//
// v6: the cycle gains OVERCAST — grey light, long fog, slightly loose grip
// — the in-between state the city spends most of its time in. Storms now
// arrive as a FRONT: the sky darkens and the wind picks up for a few
// seconds before the first drops, so a chase can feel the storm coming.
// Fog drifts: the fog range breathes slowly, so visibility opens and
// closes instead of sitting flat. And the rain is heavier at the storm's
// peak — the drop speed follows the state's rain intensity.
import * as THREE from 'three';
import { WEATHER_STATES, TUNE } from './config.js';
import { makeRng, clamp, lerp } from './util.js';

// v6: overcast joins the cycle — the grey in-between the city spends most
// of its time in, between clear spells and rain.
const WEATHER_ORDER = ['clear', 'overcast', 'dusk', 'clear', 'rain', 'fog', 'rain', 'clear', 'overcast', 'storm', 'dusk', 'fog'];
const RAIN_DROPS = 900;
// The storm front: the sky darkens this many seconds before the rain.
const FRONT_SECONDS = 6;

export class Weather {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng || makeRng(4242);
    this.state = 'clear';
    this.blend = 1; // 0..1 toward the target state's look
    this.timer = TUNE.weatherChangeSeconds;
    this.orderIndex = 0;
    this.flash = 0; // lightning flash, 0..1, decays fast
    this.flashTimer = this.rng.range(4, 9);
    this.lightningNext = 0;
    this.wetness = 0; // v5: 0 dry .. 1 soaked; rain builds it, sun dries it
    // v6: the storm front — 0..1, 1 while the front is passing.
    this.front = 0;
    this.frontTimer = 0;
    // v6: the fog drift — a slow sine that breathes the fog range in and out.
    this.fogDrift = 0;
    this.splashTimer = 0;

    const positions = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS; i += 1) {
      positions[i * 3] = this.rng.range(-60, 60);
      positions[i * 3 + 1] = this.rng.range(0, 40);
      positions[i * 3 + 2] = this.rng.range(-60, 60);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xaac4de, size: 0.14, transparent: true, opacity: 0.55,
    }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    this.rainSpeed = 42;
  }

  get def() { return WEATHER_STATES[this.state]; }

  get label() { return this.def.label; }

  /** Wet roads grip less: 1.0 in the clear, 0.6 in a storm. v5: rain
   * leaves the roads wet — `wetness` builds while it rains and dries
   * slowly after, so grip stays low for a while after the rain stops.
   * v6: the storm front trims grip a little more while it passes. */
  get grip() {
    return this.def.grip * (1 - (this.wetness || 0) * 0.12) * (1 - this.front * 0.08);
  }

  /** v5: how far police can see in this weather — fog halves it, rain
   * and storm trim it. The police brains read this every frame. */
  get sightFactor() { return this.def.sight ?? 1; }

  get lightLevel() { return this.def.light; }

  get isRaining() { return this.def.rain > 0; }

  /** True while the storm front is passing — the sky is darkening and the
   * wind is up, but the rain has not started yet. */
  get isFrontPassing() { return this.front > 0.05; }

  /** Force a state (screenshot poses and the N-key debug cycle use this). */
  setState(name) {
    if (!WEATHER_STATES[name]) return false;
    // A storm never arrives silently: setState('storm') starts the front,
    // and the rain follows a few seconds later — the same as the cycle.
    if (name === 'storm' && this.state !== 'storm') {
      this.front = 1;
      this.frontTimer = FRONT_SECONDS;
    }
    this.state = name;
    this.blend = 1;
    this.timer = TUNE.weatherChangeSeconds;
    this.applyLook();
    return true;
  }

  /** Step to the next state in the cycle (V key, and the auto timer). */
  next() {
    this.orderIndex = (this.orderIndex + 1) % WEATHER_ORDER.length;
    const nextState = WEATHER_ORDER[this.orderIndex];
    // The front: a storm is announced a few seconds early — the sky
    // darkens and the wind picks up before the first drops fall.
    if (nextState === 'storm') {
      this.front = 1;
      this.frontTimer = FRONT_SECONDS;
    }
    return this.setState(nextState);
  }

  applyLook() {
    const def = this.def;
    const fog = this.scene.fog;
    if (fog) {
      // v6: the fog breathes — the range drifts slowly with the fogDrift
      // sine, so visibility opens and closes instead of sitting flat.
      const drift = 1 + Math.sin(this.fogDrift) * 0.12;
      fog.near = lerp(fog.near, def.fogNear * drift, this.blend);
      fog.far = lerp(fog.far, def.fogFar * drift, this.blend);
      // The storm front darkens the fog itself while it passes.
      if (this.front > 0) {
        fog.color.multiplyScalar(1 - this.front * 0.15);
      }
    }
    this.rain.visible = this.isRaining;
  }

  /** The sunset tint: at golden hour the fog itself turns pink-orange, so
   * the whole city glows even far from the sun disc. `dayness` is 1 at
   * sunset, 0 at deep night; the tint only applies while the sun is up,
   * and night keeps its own dark fog from the day/night cycle. */
  applySunsetTint(dayness) {
    const fog = this.scene.fog;
    if (!fog || (this.state !== 'clear' && this.state !== 'dusk')) return;
    if (dayness < 0.4) return; // night owns the fog below this
    const pink = 0xe87a9a;
    const warm = 0xf7b98a;
    const t = clamp((dayness - 0.4) / 0.6, 0, 1);
    const r = lerp((warm >> 16) & 0xff, (pink >> 16) & 0xff, t);
    const g = lerp((warm >> 8) & 0xff, (pink >> 8) & 0xff, t);
    const b = lerp(warm & 0xff, pink & 0xff, t);
    fog.color.setRGB(r / 255, g / 255, b / 255);
  }

  /** Keep the rain centred on the camera target and falling. `fx`
   * (optional) gets a splash ring on the street every so often while it
   * rains, so wet weather reads on the ground as well as in the air. */
  update(dt, focusX, focusZ, sunLight, hemiLight, dayness, fx) {
    this.timer -= dt;
    if (this.timer <= 0) this.next();
    this.blend = Math.min(1, this.blend + dt * 0.25);
    // v6: the fog drift advances slowly — one full breath every ~40 s.
    this.fogDrift += dt * 0.16;
    // v6: the storm front decays over FRONT_SECONDS, then the rain is
    // already falling and the front is gone.
    if (this.frontTimer > 0) {
      this.frontTimer -= dt;
      this.front = clamp(this.frontTimer / FRONT_SECONDS, 0, 1);
    } else {
      this.front = 0;
    }
    // v5 wetness: rain soaks the roads (up to 1), dry weather dries them
    // slowly (0.02/s) — a chase right after the rain is still slippery.
    if (this.isRaining) this.wetness = Math.min(1, this.wetness + dt * 0.08);
    else this.wetness = Math.max(0, this.wetness - dt * 0.02);

    if (this.isRaining) {
      this.splashTimer = (this.splashTimer || 0) - dt;
      if (this.splashTimer <= 0 && fx) {
        this.splashTimer = 0.14;
        fx.ring(
          focusX + this.rng.range(-24, 24),
          focusZ + this.rng.range(-24, 24),
          0xaac4de,
        );
      }
      const attr = this.rain.geometry.getAttribute('position');
      const arr = attr.array;
      // v6: the drops fall faster in heavier rain — the storm's peak
      // reads in the rain itself, not just the sky.
      const fall = this.rainSpeed * (0.7 + this.def.rain * 0.6) * dt;
      for (let i = 0; i < RAIN_DROPS; i += 1) {
        let y = arr[i * 3 + 1] - fall;
        if (y < 0) {
          y = 40;
          arr[i * 3] = focusX + this.rng.range(-60, 60);
          arr[i * 3 + 2] = focusZ + this.rng.range(-60, 60);
        }
        arr[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
      this.rain.position.set(0, 0, 0);
      this.rain.material.opacity = 0.35 + 0.25 * this.def.rain;
    } else {
      this.rain.visible = false;
    }

    // Storm lightning: a random flash every few seconds, decaying fast.
    if (this.state === 'storm') {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 1;
        this.flashTimer = this.rng.range(3, 8);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      if (sunLight) sunLight.intensity += this.flash * 2.4;
      if (hemiLight) hemiLight.intensity += this.flash * 0.5;
    }
    // The storm front dims the sun a little while it passes — the city
    // darkens before the first drop falls.
    if (this.front > 0 && sunLight) {
      sunLight.intensity *= (1 - this.front * 0.35);
    }
    // Golden-hour fog tint follows the day/night cycle.
    this.applySunsetTint(dayness);
    this.applyLook();
  }
}

/** A headlight beam for night driving: a spotlight that follows the car.
 * v6: the beam widens a little in fog, so the light itself reads the
 * weather — the caller sets `light.angle` from the weather's sight factor. */
export function makeHeadlight() {
  const light = new THREE.SpotLight(0xfff2c0, 0, 55, 0.5, 0.45, 1.4);
  const target = new THREE.Object3D();
  light.target = target;
  return { light, target };
}
