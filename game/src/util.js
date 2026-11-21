// Shared helpers for Qihuy City: a seeded RNG so the city, traffic and every
// screenshot pose are reproducible, plus the small math the game reuses.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    chance(p) { return next() < p; },
    /** A shuffled copy of a list, so deals and draws never repeat a pattern. */
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate-independent exponential smoothing: damp(a, b, lambda, dt)
 * moves a toward b the way a spring would, whatever the frame rate. */
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Plain (non-squared) 2D distance, for HUD readouts and AI ranges. */
export function dist(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Heading from (ax, az) toward (bx, bz), in the game's yaw convention. */
export function angleTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

/** A distance readout the HUD way: 1,240 m, or 1.2 km past a kilometre. */
export function distanceLabel(metres) {
  const m = Math.round(metres);
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return m.toLocaleString('en-US') + ' m';
}

/** Smoothstep easing: 0 at the low edge, 1 at the high edge, smooth between. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Shortest signed turn from angle a to angle b, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function angleLerp(a, b, t) { return a + angleDelta(a, b) * clamp(t, 0, 1); }

/** Wrap an angle into -PI..PI so camera yaw never grows without bound. */
export function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

/** Squared 2D distance, the only distance most checks need. */
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** Push a circle (x, z, radius) out of every AABB collider it overlaps. */
export function collideCircle(x, z, radius, colliders) {
  let px = x, pz = z;
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    const cx = clamp(px, c.x - c.hx, c.x + c.hx);
    const cz = clamp(pz, c.z - c.hz, c.z + c.hz);
    const dx = px - cx, dz = pz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        px = cx + (dx / d) * radius;
        pz = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: shove out along the smallest penetration axis.
        const ox = c.hx + radius - Math.abs(px - c.x);
        const oz = c.hz + radius - Math.abs(pz - c.z);
        if (ox < oz) px = c.x + (px >= c.x ? c.hx + radius : -c.hx - radius);
        else pz = c.z + (pz >= c.z ? c.hz + radius : -c.hz - radius);
      }
    }
  }
  return { x: px, z: pz };
}

/** Format a cash amount the HUD way: $1,250. */
export function money(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/** Format a mission countdown as M:SS. */
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Format a play-time total as H:MM:SS for the save slot. */
export function playClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Format a play-time total the short way for the stats screen: "2h 14m",
 * "45m" under an hour, "3m 12s" under ten minutes. */
export function shortClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m >= 10) return `${m}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Five stars as text, e.g. ★★★☆☆ — the stats screen's best-wanted row. */
export function starsString(n) {
  let out = '';
  for (let i = 0; i < 5; i += 1) out += i < n ? '★' : '☆';
  return out;
}

// ---------------------------------------------------------------------------
// v6 helpers: easing, weighted picks, compass and clock readouts, and small
// vector utilities the v6 systems (drift meter, compass strip, day/night
// clock, mission log) share instead of each re-implementing them.
// ---------------------------------------------------------------------------

/** Ease-in-out (smooth both ends) for camera moves and UI transitions. */
export function easeInOut(t) {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Ease-out cubic: fast start, gentle stop — camera snap-backs, HUD pops. */
export function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** Ease-in quad: slow start, fast finish — a punch wind-up, a car launch. */
export function easeInQuad(t) {
  const x = clamp01(t);
  return x * x;
}

/** Remap a value from one range to another, clamped at both ends. */
export function remap(v, inMin, inMax, outMin, outMax) {
  const t = clamp01((v - inMin) / (inMax - inMin || 1));
  return outMin + (outMax - outMin) * t;
}

/** Weighted pick from [{ w, v }, ...] using a seeded rng — traffic kinds,
 * pedestrian moods and loot tables all draw through this one helper. */
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const e of entries) total += e.w;
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll <= 0) return e.v;
  }
  return entries[entries.length - 1].v;
}

/** Compass point from a yaw: N, NE, E, SE, S, SW, W, NW. The HUD's compass
 * strip and the mission arrow both read this. */
export function compassLabel(yaw) {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((wrapAngle(yaw) / (Math.PI * 2)) * 8 + 8) % 8;
  return points[idx];
}

/** A clock reading from minutes-since-midnight: "6:42 PM". The day/night
 * HUD and the pause screen's clock share this. */
export function clock12h(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m % 60).padStart(2, '0');
  return `${h}:${mm} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** A short duration: "1h 5m", "42s", "3m 12s" — mission timers and the
 * stats screen's play-time column. */
export function durationShort(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Approximately-normal random in [-1, 1] from a seeded rng — spawn
 * scatter, pedestrian speeds and damage jitter that cluster near the mean. */
export function gauss(rng) {
  return (rng.next() + rng.next() + rng.next() - 1.5) / 1.5;
}

/** Clamp a 2D vector to a maximum length, keeping its direction. */
export function clampVec2(x, z, maxLen) {
  const len = Math.hypot(x, z);
  if (len <= maxLen || len < 1e-6) return { x, z };
  const s = maxLen / len;
  return { x: x * s, z: z * s };
}

/** The nearest item in a list to (x, z), by its x/z fields — the HUD's
 * "nearest objective" and the AI's target picks share this. Returns null
 * for an empty list. */
export function nearestOf(list, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const item of list) {
    const d = dist2(x, z, item.x, item.z);
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}
