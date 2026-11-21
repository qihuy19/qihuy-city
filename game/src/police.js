// Qihuy City police brain, v6: one behaviour tree + utility scorer per
// patrol unit, on a per-unit blackboard. The tree is a reactive selector —
// the highest-priority branch that can run wins, and a running branch is
// aborted cleanly when a higher one takes over. The utility scorer picks
// the tactic (PURSUIT / RAMMING / ROADBLOCK / SEARCH / PATROL / SPIKE /
// PIT) from scored, gated candidates; pure scoring never moves a car, the
// tree's leaves do.
//
// v5: weather feeds perception — fog scales the sight range down (0.55x),
// so a chase in the fog loses the player sooner; at 4-5 stars roadblocks
// score higher and cool down faster, and the trace logs the sight factor
// alongside each transition for the NPC AI debug pass.
//
// v6 adds two new tactics: SPIKE — at 4+ stars a unit breaks off ahead of
// the player and drops a spike strip across his road — and PIT — at 3+
// stars a unit alongside the player swings into his rear quarter to spin
// him. It also adds a DISPATCHER CHATTER log (one short radio line per
// tactic change, so the roster panel can read like a dispatch feed),
// UNIT FATIGUE (a unit that has been in a high-speed chase for a long
// time scores pursuit a little lower, so fresh units take the lead), and
// HELICOPTER COORDINATION (when a chopper is overhead, the ground units'
// search scores rise — the eye in the sky narrows the search zone).
//
// Perception: a unit sees the player inside a forward cone (sight range +
// half-angle) or close enough to hear. A sighting refreshes the
// last-known position; when sight is lost the unit searches that spot, and
// the search zone on the minimap is drawn from the same blackboard the HUD
// reads — the roster and the map can never disagree with the brain.
//
// Trace: every tactic change is logged as one line-delimited event
// ({t, unit, from, to, scores}) for the NPC AI debug pass; ticks are not
// logged, only transitions.
import { TUNE } from './config.js';
import { clamp, clamp01, angleDelta, dist2 } from './util.js';

/** Dispatcher chatter: one radio line per tactic, with the unit's
 * callsign slotted in. The HUD's roster panel shows the latest line. */
export const DISPATCH_LINES = {
  PURSUIT: (unit) => `${unit} in pursuit — staying on him.`,
  RAMMING: (unit) => `${unit} going for the ram — clear the road.`,
  ROADBLOCK: (unit) => `${unit} setting a roadblock ahead of the suspect.`,
  SEARCH: (unit) => `${unit} lost visual — searching the last-known area.`,
  PATROL: (unit) => `${unit} back on patrol.`,
  SPIKE: (unit) => `${unit} deploying spike strips ahead of the suspect.`,
  PIT: (unit) => `${unit} moving in for a PIT — stand by.`,
};

/** Utility candidates. Each has gates (a zero is a veto) and a score made
 * of normalized factors, combined deliberately by sum. */
const TACTICS = {
  PURSUIT: {
    gates: (b) => (b.wanted > 0 && b.seenRecently ? 1 : 0),
    score: (b) => {
      const closeness = clamp01(1 - b.dist / 220);
      const heat = b.wanted / 5;
      // Base 0.45: close in, RAMMING outscores pursuit inside 25 m.
      // v6 fatigue: a unit that has chased hard for a while scores a
      // little lower, so a fresher unit takes the lead.
      const fatigue = clamp01((b.chaseSeconds || 0) / 90) * 0.08;
      return 0.45 + 0.3 * closeness + 0.15 * heat - fatigue;
    },
  },
  RAMMING: {
    gates: (b) => (b.wanted > 0 && b.seenRecently && b.playerInCar && b.dist < TUNE.policeRamMaxDist ? 1 : 0),
    score: (b) => {
      const closeness = clamp01(1 - b.dist / TUNE.policeRamMaxDist);
      const speed = clamp01(b.playerSpeed / 34);
      // Base 0.65: inside ramming range this beats pursuit outright.
      return 0.65 + 0.25 * closeness + 0.1 * speed;
    },
  },
  ROADBLOCK: {
    gates: (b) => (b.wanted >= TUNE.policeRoadblockMinStars && b.seenRecently
      && b.dist > TUNE.policeRoadblockMinDist && !b.roadblockCooldown ? 1 : 0),
    score: (b) => {
      const far = clamp01((b.dist - TUNE.policeRoadblockMinDist) / 160);
      const heat = b.wanted / 5;
      // v5: at 4-5 stars roadblocks outscore pursuit more often — the
      // city tries to box the player in instead of just chasing him.
      const highStar = b.wanted >= 4 ? TUNE.policeRoadblockHighStarBonus : 0;
      return 0.45 + 0.35 * far + 0.2 * heat + highStar;
    },
  },
  // v6 SPIKE: at 4+ stars, when the player is far and fast and the strip
  // is off cooldown, breaking off to lay a strip beats chasing him.
  SPIKE: {
    gates: (b) => (b.wanted >= TUNE.spikeStripMinStars && b.seenRecently
      && b.dist > 60 && b.playerSpeed > 14 && !b.spikeCooldown ? 1 : 0),
    score: (b) => {
      const far = clamp01((b.dist - 60) / 140);
      const speed = clamp01(b.playerSpeed / 34);
      return 0.5 + 0.3 * far + 0.2 * speed;
    },
  },
  // v6 PIT: at 3+ stars, alongside the player and close, the PIT swing
  // outscores a straight ram — it costs him speed without a head-on hit.
  PIT: {
    gates: (b) => (b.wanted >= TUNE.pitMinStars && b.seenRecently
      && b.playerInCar && b.dist < TUNE.pitMaxDist + 6 && b.dist > 3
      && !b.pitCooldown ? 1 : 0),
    score: (b) => {
      const closeness = clamp01(1 - b.dist / (TUNE.pitMaxDist + 6));
      const speed = clamp01(b.playerSpeed / 34);
      return 0.62 + 0.28 * closeness + 0.1 * speed;
    },
  },
  SEARCH: {
    gates: (b) => (b.wanted > 0 && !b.seenRecently && b.lastKnown ? 1 : 0),
    score: (b) => {
      const freshness = clamp01(1 - b.sinceSeen / TUNE.policeMemorySeconds);
      // v6: a helicopter overhead narrows the search — the ground units
      // sweep harder while the eye in the sky holds the last-known spot.
      const heliBonus = b.heliOverhead ? 0.12 : 0;
      return 0.5 + 0.5 * freshness + heliBonus;
    },
  },
  PATROL: {
    gates: () => 1,
    score: () => 0.1,
  },
};

/** Score every tactic for a blackboard; returns { name, scores } where
 * scores is the full table for the trace log. Ineligible tactics score 0
 * and are never picked; an empty eligible list is impossible (PATROL is
 * always gated open), so this never returns a random fallback. */
export function scoreTactics(blackboard) {
  const scores = {};
  let best = 'PATROL';
  let bestScore = -1;
  for (const [name, tactic] of Object.entries(TACTICS)) {
    const gate = tactic.gates(blackboard);
    const score = gate === 0 ? 0 : clamp01(tactic.score(blackboard));
    scores[name] = { score, eligible: gate !== 0 };
    if (gate !== 0 && score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return { name: best, scores };
}

/** A tiny behaviour-tree runtime: nodes return 'running' | 'success' |
 * 'failure'. A reactive selector re-evaluates from the top every tick and
 * aborts a lower branch when a higher one takes over; a sequence runs its
 * children in order and remembers where it stopped. */
export function makeSelector(children) {
  let running = -1;
  return {
    tick(bb, dt, api) {
      for (let i = 0; i < children.length; i += 1) {
        const result = children[i].tick(bb, dt, api);
        if (result === 'running') {
          if (running !== -1 && running !== i && children[running].abort) {
            children[running].abort(bb);
          }
          running = i;
          return 'running';
        }
        if (result === 'success') {
          if (running !== -1 && running !== i && children[running].abort) {
            children[running].abort(bb);
          }
          running = -1;
          return 'success';
        }
      }
      running = -1;
      return 'failure';
    },
    abort(bb) {
      if (running !== -1 && children[running].abort) children[running].abort(bb);
      running = -1;
    },
  };
}

export function makeSequence(children) {
  let at = 0;
  return {
    tick(bb, dt, api) {
      while (at < children.length) {
        const result = children[at].tick(bb, dt, api);
        if (result === 'running') return 'running';
        if (result === 'failure') {
          at = 0;
          return 'failure';
        }
        at += 1;
      }
      at = 0;
      return 'success';
    },
    abort() { at = 0; },
  };
}

function makeCondition(predicate) {
  return { tick: (bb) => (predicate(bb) ? 'success' : 'failure') };
}

function makeAction(fn, abortFn) {
  return {
    tick: (bb, dt, api) => fn(bb, dt, api),
    abort: abortFn ? (bb) => abortFn(bb) : undefined,
  };
}

/** A decorator node: runs its child only while `predicate` holds, and
 * aborts it the moment the predicate fails — the tree's way of saying
 * "keep doing this, but stop the instant the situation changes". */
export function makeGuard(predicate, child) {
  return {
    tick(bb, dt, api) {
      if (!predicate(bb)) {
        if (child.abort) child.abort(bb);
        return 'failure';
      }
      return child.tick(bb, dt, api);
    },
    abort(bb) { if (child.abort) child.abort(bb); },
  };
}

/** An inverter: flips a condition's success/failure, so a branch can run
 * on the *absence* of a state — e.g. "not seen recently". */
export function makeInverter(child) {
  return {
    tick(bb, dt, api) {
      const result = child.tick(bb, dt, api);
      if (result === 'success') return 'failure';
      if (result === 'failure') return 'success';
      return result;
    },
    abort(bb) { if (child.abort) child.abort(bb); },
  };
}

/** One police unit's brain: blackboard, tactic scorer, behaviour tree and
 * the trace log. `api` is supplied by the traffic system each tick:
 * { driveTo(x, z, speed), ram(), waitAt(x, z), player, now }. */
export class PoliceBrain {
  constructor(unitName, callsign) {
    this.unitName = unitName; // e.g. 'QCPD-11'
    this.callsign = callsign; // e.g. 'FALCON'
    this.blackboard = {
      wanted: 0,
      dist: 999,
      seenRecently: false,
      sinceSeen: 99,
      lastKnown: null,
      lastSeenAt: -99,
      playerInCar: false,
      playerSpeed: 0,
      roadblockCooldown: false,
      spikeCooldown: false,
      pitCooldown: false,
      tactic: 'PATROL',
      tacticSince: 0,
      chaseSeconds: 0, // v6 fatigue: seconds spent in active pursuit
      heliOverhead: false, // v6: a chopper is up, search scores rise
    };
    this.trace = []; // transition events only, for the AI debug pass
    this.chatter = []; // v6 dispatcher lines, one per tactic change
    this.decisionTimer = 0;
    this.searchSweep = 0;
    this.tree = this.buildTree();
  }

  get tactic() { return this.blackboard.tactic; }

  get lastKnown() { return this.blackboard.lastKnown; }

  /** The latest dispatcher line for this unit, or null before its first
   * tactic change. The roster panel shows it under the unit's row. */
  get lastChatter() {
    return this.chatter.length > 0 ? this.chatter[this.chatter.length - 1] : null;
  }

  /** The search zone the minimap draws: the last-known spot, growing as
   * the memory goes stale. Null when there is nothing to search. */
  get searchZone() {
    const bb = this.blackboard;
    if (!bb.lastKnown || bb.wanted === 0 || bb.seenRecently) return null;
    return {
      x: bb.lastKnown.x,
      z: bb.lastKnown.z,
      radius: 18 + bb.sinceSeen * 2.2,
      age: bb.sinceSeen,
    };
  }

  buildTree() {
    const bb = () => this.blackboard;
    // SPIKE branch (v6): tactic is SPIKE -> drive ahead and drop the strip.
    const spike = makeSequence([
      makeCondition(() => bb().tactic === 'SPIKE'),
      makeAction((b, dt, api) => api.spike(b, dt)),
    ]);
    // PIT branch (v6): tactic is PIT -> pull alongside and swing in.
    const pit = makeSequence([
      makeCondition(() => bb().tactic === 'PIT'),
      makeAction((b, dt, api) => api.pit(b, dt)),
    ]);
    // ROADBLOCK branch: tactic is ROADBLOCK -> drive to the intercept
    // point ahead of the player and wait there, lights flashing.
    const roadblock = makeSequence([
      makeCondition(() => bb().tactic === 'ROADBLOCK'),
      makeAction((b, dt, api) => api.roadblock(b, dt)),
    ]);
    // RAMMING branch: tactic is RAMMING -> aim at the player's car and
    // hit it. The leaf returns running while the ram is on.
    const ramming = makeSequence([
      makeCondition(() => bb().tactic === 'RAMMING'),
      makeAction((b, dt, api) => api.ram(b, dt)),
    ]);
    // PURSUIT branch: tactic is PURSUIT -> chase the player's position.
    const pursuit = makeSequence([
      makeCondition(() => bb().tactic === 'PURSUIT'),
      makeAction((b, dt, api) => api.pursue(b, dt)),
    ]);
    // SEARCH branch: tactic is SEARCH -> drive to the last-known spot,
    // then sweep around it until the memory goes stale.
    const search = makeSequence([
      makeCondition(() => bb().tactic === 'SEARCH'),
      makeAction((b, dt, api) => api.search(b, dt)),
    ]);
    // PATROL branch: nothing to do — cruise slowly near the spawn.
    const patrol = makeSequence([
      makeCondition(() => bb().tactic === 'PATROL'),
      makeAction((b, dt, api) => api.patrol(b, dt)),
    ]);
    // Priority order: the spike and PIT moves pre-empt a plain roadblock
    // when the scorer picks them, and ramming still pre-empts pursuit.
    return makeSelector([spike, pit, roadblock, ramming, pursuit, search, patrol]);
  }

  /** Perception: cone + hearing. A sighting refreshes the last-known
   * position and the memory clock; losing sight starts the search timer.
   * v5: `sightFactor` (1.0 clear, 0.55 fog) scales the sight range — fog
   * genuinely blinds a unit, so a chase in the fog loses the player
   * sooner and the search zone opens up earlier. v6: `heliOverhead`
   * marks whether a chopper is up — the search scorer reads it. */
  perceive(self, player, now, wanted, sightFactor, heliOverhead) {
    const bb = this.blackboard;
    bb.wanted = wanted;
    bb.dist = Math.sqrt(dist2(self.x, self.z, player.x, player.z));
    bb.playerInCar = !player.onFoot;
    bb.playerSpeed = player.car ? Math.abs(player.car.speed) : 0;
    bb.sightFactor = sightFactor ?? 1;
    bb.heliOverhead = !!heliOverhead;
    const headingToPlayer = Math.atan2(player.x - self.x, player.z - self.z);
    const facing = angleDelta(self.yaw, headingToPlayer);
    const sightRange = TUNE.policeSightRange * bb.sightFactor;
    const inCone = bb.dist < sightRange
      && Math.abs(facing) < TUNE.policeSightHalfAngle;
    const heard = bb.dist < TUNE.policeHearRange;
    if ((inCone || heard) && wanted > 0) {
      bb.lastKnown = { x: player.x, z: player.z };
      bb.lastSeenAt = now;
      bb.seenRecently = true;
      bb.sinceSeen = 0;
    } else {
      bb.sinceSeen = now - bb.lastSeenAt;
      bb.seenRecently = bb.sinceSeen < 2.5 && wanted > 0;
    }
    if (wanted === 0) {
      bb.lastKnown = null;
      bb.seenRecently = false;
      bb.sinceSeen = 99;
    }
    return bb;
  }

  /** Re-score the tactic on a 0.4 s cadence (not every frame), with
   * hysteresis so near-ties do not flip the unit back and forth. */
  decide(now) {
    const bb = this.blackboard;
    const { name, scores } = scoreTactics(bb);
    const current = bb.tactic;
    const currentScore = scores[current] ? scores[current].score : 0;
    const nextScore = scores[name].score;
    const switchNow = name !== current
      && (nextScore > currentScore + TUNE.policeUtilityHysteresis
        || currentScore === 0
        || now - bb.tacticSince > 6);
    if (switchNow) {
      this.trace.push({
        t: +now.toFixed(2), unit: this.unitName, from: current, to: name,
        scores: Object.fromEntries(
          Object.entries(scores).map(([k, v]) => [k, +v.score.toFixed(2)]),
        ),
      });
      if (this.trace.length > 200) this.trace.shift();
      // v6 dispatcher chatter: one radio line per switch, capped at 20.
      const line = DISPATCH_LINES[name]
        ? DISPATCH_LINES[name](`${this.unitName} ${this.callsign}`)
        : `${this.unitName} switching to ${name}.`;
      this.chatter.push({ t: +now.toFixed(2), text: line });
      if (this.chatter.length > 20) this.chatter.shift();
      if (name === 'ROADBLOCK') {
        // v5: one roadblock per 12 s — or per 7 s at 4-5 stars, when the
        // city is trying hardest to box the player in.
        const cooldown = bb.wanted >= 4
          ? TUNE.policeRoadblockCooldownHighStars
          : TUNE.policeRoadblockCooldownSeconds;
        bb.roadblockCooldownUntil = now + cooldown;
      }
      if (name === 'SPIKE') {
        bb.spikeCooldownUntil = now + TUNE.spikeStripCooldownSeconds;
      }
      if (name === 'PIT') {
        bb.pitCooldownUntil = now + 10;
      }
      bb.tactic = name;
      bb.tacticSince = now;
    }
    return bb.tactic;
  }

  /** One tick: perceive, maybe re-decide, then run the tree. Returns the
   * tactic the unit is executing, for the roster panel. `wanted` is the
   * live wanted level — the blackboard only ever holds what perceive was
   * last told, so the caller must pass the real number every tick.
   * `sightFactor` is the weather's police-sight multiplier (v5).
   * `heliOverhead` (v6) is true while a chopper is up. */
  tick(self, player, now, dt, api, wanted, sightFactor, heliOverhead) {
    this.perceive(self, player, now, wanted, sightFactor, heliOverhead);
    // Cooldowns are timestamps, not timers — deterministic and safe in
    // headless/virtual-time runs.
    this.blackboard.roadblockCooldown = now < (this.blackboard.roadblockCooldownUntil || 0);
    this.blackboard.spikeCooldown = now < (this.blackboard.spikeCooldownUntil || 0);
    this.blackboard.pitCooldown = now < (this.blackboard.pitCooldownUntil || 0);
    // v6 fatigue: chase seconds accumulate while the unit is in an active
    // tactic and bleed off on patrol, so a fresh unit outscores a tired one.
    const active = ['PURSUIT', 'RAMMING', 'PIT', 'ROADBLOCK', 'SPIKE'].includes(this.blackboard.tactic);
    this.blackboard.chaseSeconds = clamp(
      (this.blackboard.chaseSeconds || 0) + (active ? dt : -dt * 2), 0, 120,
    );
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.4;
      this.decide(now);
    }
    this.tree.tick(this.blackboard, dt, api);
    return this.blackboard.tactic;
  }

  /** The unit stands down: abort the running branch, keep the cooldowns. */
  reset() {
    this.tree.abort(this.blackboard);
    this.blackboard.tactic = 'PATROL';
    this.blackboard.lastKnown = null;
    this.blackboard.seenRecently = false;
    this.blackboard.sinceSeen = 99;
    this.blackboard.wanted = 0;
    this.blackboard.chaseSeconds = 0;
  }
}

/** Foot-cop brain: a smaller tree — CHASE the player while seen, SEARCH
 * the last-known spot when sight is lost, ARREST on contact. Shares the
 * same perception and last-known rules as the patrol cars. v6: a foot cop
 * who has lost the player twice in a row searches a wider arc, and a cop
 * who just saw the player sprint past remembers the direction he ran. */
export class FootCopBrain {
  constructor() {
    this.lastKnown = null;
    this.lastSeenAt = -99;
    this.state = 'PATROL';
    this.searchSweep = 0;
    this.lostCount = 0; // v6: consecutive losses widen the search arc
    this.lastRunDir = null; // v6: the heading the player ran when last seen
  }

  perceive(self, player, now, wanted, sightFactor) {
    const d = Math.sqrt(dist2(self.x, self.z, player.x, player.z));
    const heading = Math.atan2(player.x - self.x, player.z - self.z);
    // v5: fog trims a foot cop's sight too, like the patrol cars'.
    const sightRange = 60 * (sightFactor ?? 1);
    const inCone = d < sightRange && Math.abs(angleDelta(self.yaw, heading)) < 1.3;
    const heard = d < 14;
    if ((inCone || heard) && wanted > 0 && player.onFoot) {
      if (this.state !== 'CHASE') this.lostCount = 0;
      this.lastKnown = { x: player.x, z: player.z };
      this.lastSeenAt = now;
      this.lastRunDir = player.car ? null : Math.atan2(
        Math.sin(player.yaw), Math.cos(player.yaw),
      );
      this.state = 'CHASE';
      return 'CHASE';
    }
    if (wanted > 0 && this.lastKnown && now - this.lastSeenAt < TUNE.policeMemorySeconds) {
      if (this.state !== 'SEARCH') {
        this.lostCount += 1;
        this.searchSweep = 0;
      }
      this.state = 'SEARCH';
      return 'SEARCH';
    }
    this.state = 'PATROL';
    this.lastKnown = null;
    return 'PATROL';
  }

  /** The search sweep radius: wider every time the cop loses the player,
   * so a repeat escape is searched harder than the first. */
  get searchRadius() {
    return 12 + Math.min(24, this.lostCount * 8);
  }
}
