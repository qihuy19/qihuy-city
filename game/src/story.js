// The branching story arcs, v7: after twenty jobs for Mara, the story
// splits. Mission 21 — The Split — is a choice, not a delivery: Mara's
// garage (gold) or Dara's casino (pink). Whichever marker Riko drives
// to decides the last three jobs, who briefs them, where they run, what
// they pay, and which fixer remembers him.
//
// The arcs are data, applied to the linear mission list at the moment
// of the choice: the StoryArcs class rewrites missions 22–24 (title,
// brief, stages, pickup, dropoff, reward, heat, crew) and their
// visual-novel briefings from the side Riko picked, then lets the
// existing mission engine run them — no second engine, no fork in the
// update loop. Standing with the chosen fixer grows with every job
// done for them, and the next job's pay grows 5% per standing point:
// loyalty, priced.
//
// The choice itself is watched every frame while mission 21 is active:
// two beacons mark the two doors, and the first one Riko drives within
// twelve units of is the side he picks. There is no dialogue box for
// the choice — driving to a door *is* the choice, the way the rest of
// the game makes its choices.
import { MISSIONS, PLACES, BRIEFINGS } from './config.js';
import { dist2 } from './util.js';

/** The two fixers, and what siding with each one means. Mara is the
 * fixer Riko has worked for all along — her arc runs through the port,
 * the airport and the boardwalk, and ends at her garage. Dara is the
 * rival who has been watching from the casino roof — her arc runs
 * through her own casino, the ferry and Market Row, and ends on her
 * turf. Both arcs pay; neither is the "good" one. */
export const STORY_ARCS = {
  mara: {
    id: 'mara',
    name: 'Mara',
    role: 'FIXER',
    color: '#ffd94f',
    place: 'garage',
    placeLabel: "Mara's Garage",
    choiceLine: 'You chose Mara. Dara will remember this — and so will the port, the runway and the boardwalk.',
  },
  dara: {
    id: 'dara',
    name: 'Dara',
    role: 'RIVAL FIXER',
    color: '#ff5a9e',
    place: 'casino',
    placeLabel: 'Golden Palm Casino',
    choiceLine: 'You chose Dara. Mara will remember this — and so will the casino, the ferry and Market Row.',
  },
};

/** The three jobs each side offers, as full mission entries. The
 * StoryArcs class writes these over missions 22–24 when Riko picks a
 * side — the engine then runs them like any other job, with its own
 * pickup, dropoff, timer, heat and crew. */
export const SIDE_MISSIONS = {
  mara: [
    {
      id: 'mara-ledger',
      title: 'Mission 22 — Mara\'s Ledger',
      brief: 'Mara\'s ledger is at the port, and the Rimba crew is holding it for ransom. Three stars, 3:00, bring it to the garage — loyalty pays, and Mara pays best.',
      stages: ['Reach the port', 'Grab Mara\'s ledger (press E)', 'Run it to the garage before the timer ends'],
      reward: 3600,
      timeLimit: 180,
      pickup: 'port',
      dropoff: 'garage',
      starsOnPickup: 3,
      gangOnPickup: true,
    },
    {
      id: 'mara-runway',
      title: 'Mission 23 — Mara\'s Runway',
      brief: 'One case on the airport tarmac, five stars, two helicopters — the same runway that nearly ended the story last time. Five minutes. Take the case, take the runway, bring it to the hideout.',
      stages: ['Grab the tarmac case at the airport (press E)', 'Outrun two choppers and the roadblocks', 'Reach the hideout before the timer ends'],
      reward: 4200,
      timeLimit: 300,
      pickup: 'airport',
      dropoff: 'hideout',
      starsOnPickup: 5,
      gangOnPickup: true,
    },
    {
      id: 'mara-finale',
      title: 'Mission 24 — Mara\'s Finale',
      brief: 'The last job for Mara. One case on the boardwalk, a second at the ferry terminal, five stars, spike strips on the beach road and the whole QCPD out. Five minutes. Bring both home to the garage — and the city is hers.',
      stages: ['Grab the boardwalk case (press E)', 'Grab the ferry case (press E)', 'Bring both to the garage before the timer ends'],
      reward: 6000,
      timeLimit: 300,
      pickup: 'boardwalk',
      dropoff: 'garage',
      starsOnPickup: 5,
      secondPickup: 'ferry',
      gangOnPickup: true,
    },
  ],
  dara: [
    {
      id: 'dara-chips',
      title: 'Mission 22 — Dara\'s Chips',
      brief: 'Dara\'s chips are at the casino — her own house, her own crew, and she wants you to take them back from the Rimba boys who lifted them. Three stars, 3:00, run them to the hideout.',
      stages: ['Reach the Golden Palm casino', 'Grab Dara\'s chips (press E)', 'Run them to the hideout before the timer ends'],
      reward: 3400,
      timeLimit: 180,
      pickup: 'casino',
      dropoff: 'hideout',
      starsOnPickup: 3,
      gangOnPickup: true,
    },
    {
      id: 'dara-ferry',
      title: 'Mission 23 — Dara\'s Ferry',
      brief: 'Dara has a crate coming off the ferry at Ferry Point, and the Rimba crew knows the timetable. Four stars, 3:00, and the run ends on her turf — the Golden Palm.',
      stages: ['Reach the Ferry Point terminal', 'Grab the ferry crate (press E)', 'Run it to the casino before the timer ends'],
      reward: 4000,
      timeLimit: 180,
      pickup: 'ferry',
      dropoff: 'casino',
      starsOnPickup: 4,
      gangOnPickup: true,
    },
    {
      id: 'dara-finale',
      title: 'Mission 24 — Dara\'s Finale',
      brief: 'The last job for Dara. One case on Market Row, a second in Old Town, five stars, and the whole QCPD between you and the casino. Five minutes. Bring both home — and the strip is hers.',
      stages: ['Grab the Market Row case (press E)', 'Grab the Old Town case (press E)', 'Bring both to the casino before the timer ends'],
      reward: 5800,
      timeLimit: 300,
      pickup: 'market',
      dropoff: 'casino',
      starsOnPickup: 5,
      secondPickup: 'oldtown',
      gangOnPickup: true,
    },
  ],
};

/** The visual-novel briefings for the side missions: Mara briefs hers,
 * Dara briefs hers, each in their own voice. The StoryArcs class
 * writes these into BRIEFINGS under the side mission's id, so the
 * briefing overlay shows the right fixer for the arc Riko picked. */
export const SIDE_BRIEFINGS = {
  mara: {
    'mara-ledger': {
      speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
      lines: [
        'You picked me, Riko. Good. Dara will sulk about it for a week — the port will not wait that long.',
        'My ledger is at the port, and the Rimba crew is holding it for ransom. Three stars, three minutes.',
        'Bring it to the garage. Loyalty pays — and I pay best.',
      ],
    },
    'mara-runway': {
      speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
      lines: [
        'One case on the airport tarmac. Five stars. Two helicopters. The same runway that nearly ended this story.',
        'Five minutes, Riko. The towers are watching, the strip is watching, the runway lights are watching.',
        'Take the case, take the runway, bring it to the hideout. Then there is one job left, and it is the big one.',
      ],
    },
    'mara-finale': {
      speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
      lines: [
        'The last job for me, Riko. One case on the boardwalk, a second at the ferry terminal.',
        'Five stars. Spike strips on the beach road. The whole QCPD out. Five minutes, two cases, one garage.',
        'Bring them both home, and Qihuy City is ours — mine, and yours. Drive like the sunset depends on it.',
      ],
    },
  },
  dara: {
    'dara-chips': {
      speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
      lines: [
        'You picked me, Riko. Mara will sulk about it for a week — my chips will not wait that long.',
        'My chips are in my own casino, and the Rimba boys lifted them anyway. Cheeky. Three stars, three minutes.',
        'Take them back, run them to the hideout, and I will make it worth your while. The house pays its friends.',
      ],
    },
    'dara-ferry': {
      speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
      lines: [
        'A crate of mine is coming off the ferry at Ferry Point, and the Rimba crew knows the timetable.',
        'Four stars, three minutes, and the run ends on my turf — the Golden Palm. The lighthouse sees everything, so make it good.',
        'Bring it home, Riko. The strip is watching.',
      ],
    },
    'dara-finale': {
      speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
      lines: [
        'The last job for me, Riko. One case on Market Row, a second in Old Town.',
        'Five stars. The whole QCPD between you and my casino. Five minutes, two cases, one Golden Palm.',
        'Bring them both home, and the strip is ours — mine, and yours. Drive like the neon depends on it.',
      ],
    },
  },
};

/** How close Riko has to drive to a choice marker for the choice to
 * count: twelve units — close enough to be deliberate, far enough that
 * a drive-by does not decide the story for him. */
const CHOICE_RADIUS2 = 144;

export class StoryArcs {
  constructor(game) {
    this.game = game;
    // The side Riko picked: null until mission 21 is decided, then
    // 'mara' or 'dara'. The other fixer remembers — the save file does.
    this.side = null;
    // Standing with each fixer: +1 for the choice itself, +1 per job
    // finished for them. The next job's pay grows 5% per standing point.
    this.standing = { mara: 0, dara: 0 };
    // Mission ids whose reward already carries the standing bonus, so
    // the bonus is applied once per job and never compounds.
    this.bonusApplied = new Set();
    // The two choice beacons, while mission 21 is active: gold for
    // Mara's garage, pink for Dara's casino.
    this.choiceBeacons = null;
    // The last mission index seen, so the class can notice when a job
    // completes and credit the standing.
    this.lastIndex = -1;
  }

  /** The arc Riko is on, or null before the choice. */
  get arc() {
    return this.side ? STORY_ARCS[this.side] : null;
  }

  /** Write a side's three jobs over missions 22–24 (indices 21–23 in
   * the list), with their briefings: the mission data, the briefing
   * overlay and the HUD all read the same rewritten entries, so the
   * choice shows up everywhere at once. */
  applySideVariants(side) {
    const missions = SIDE_MISSIONS[side];
    const briefings = SIDE_BRIEFINGS[side];
    if (!missions) return;
    for (let i = 0; i < 3; i += 1) {
      const entry = MISSIONS[21 + i];
      if (!entry) continue;
      Object.assign(entry, missions[i]);
      BRIEFINGS[missions[i].id] = briefings[missions[i].id];
    }
  }

  /** Mark the two doors of the choice: a gold beacon over Mara's
   * garage and a pink one over Dara's casino, so the choice reads on
   * the street instead of only in the briefing. */
  showChoiceBeacons(game) {
    if (this.choiceBeacons) return;
    const gold = game.fx.beacon(PLACES.garage.x, PLACES.garage.z, 0xffd94f);
    const pink = game.fx.beacon(PLACES.casino.x, PLACES.casino.z, 0xff5a9e);
    this.choiceBeacons = [gold, pink];
  }

  /** Take the beacons down — the choice is made, the doors are just
   * doors again. */
  clearChoiceBeacons(game) {
    if (!this.choiceBeacons) return;
    for (const handle of this.choiceBeacons) game.fx.clearBeacon(handle);
    this.choiceBeacons = null;
  }

  /** Make the choice: record the side and the standing, rewrite the
   * last three jobs for that side, and complete mission 21 through the
   * normal engine — so the mission log, the briefing of mission 22
   * and the save all see a clean, ordinary completion. */
  choose(side, game) {
    if (this.side) return;
    this.side = side;
    this.standing[side] = (this.standing[side] || 0) + 1;
    this.applySideVariants(side);
    this.clearChoiceBeacons(game);
    game.audio.jingle();
    game.fx.confetti(game.player.x, 2, game.player.z);
    game.missions.completeMission(game);
    game.missions.say(STORY_ARCS[side].choiceLine, 7);
  }

  /** The per-frame watch: the choice itself, the standing credit when
   * a side job completes, and the one-time loyalty bonus on the next
   * job's pay. */
  update(dt, game) {
    const missions = game.missions;
    const current = missions.current;

    // Standing credit: when the mission index moves past a side job,
    // the job just finished was for the chosen fixer.
    if (missions.index !== this.lastIndex) {
      const finishedId = this.lastIndex >= 0 && this.lastIndex < MISSIONS.length
        ? MISSIONS[this.lastIndex].id : null;
      if (finishedId && this.side) {
        const sideIds = SIDE_MISSIONS[this.side].map((m) => m.id);
        if (sideIds.includes(finishedId)) {
          this.standing[this.side] += 1;
        }
      }
      this.lastIndex = missions.index;
    }

    if (!current) return;

    // The choice: while mission 21 is active, show both beacons and
    // watch both doors. The first door Riko drives within twelve
    // units of is the side he picks — driving is the choice.
    if (current.branchChoice && !this.side) {
      this.showChoiceBeacons(game);
      const player = game.player;
      if (dist2(player.x, player.z, PLACES.garage.x, PLACES.garage.z) < CHOICE_RADIUS2) {
        this.choose('mara', game);
        return;
      }
      if (dist2(player.x, player.z, PLACES.casino.x, PLACES.casino.z) < CHOICE_RADIUS2) {
        this.choose('dara', game);
        return;
      }
      return;
    }

    // Loyalty bonus: a side job's pay grows 5% per standing point with
    // the fixer who set it, applied once when the job becomes current.
    if (this.side && current.id && !this.bonusApplied.has(current.id)) {
      const sideIds = SIDE_MISSIONS[this.side].map((m) => m.id);
      if (sideIds.includes(current.id)) {
        const bonus = this.standing[this.side] || 0;
        if (bonus > 0) {
          current.reward = Math.round(current.reward * (1 + 0.05 * bonus));
        }
        this.bonusApplied.add(current.id);
      }
    }
  }

  /** One line for the stats screen: which fixer Riko sided with, and
   * how deep the loyalty runs. */
  get standingLine() {
    if (!this.side) return 'No side chosen yet — mission 21 decides it.';
    const arc = STORY_ARCS[this.side];
    const standing = this.standing[this.side] || 0;
    const other = this.side === 'mara' ? 'dara' : 'mara';
    return `Sided with ${arc.name} — standing ${standing} · ${STORY_ARCS[other].name} remembers`;
  }

  // ----- save / load --------------------------------------------------------
  serialize() {
    return {
      side: this.side,
      standing: { ...this.standing },
      bonusApplied: [...this.bonusApplied],
    };
  }

  restore(data) {
    if (!data) return;
    this.side = data.side || null;
    this.standing = { mara: 0, dara: 0, ...(data.standing || {}) };
    this.bonusApplied = new Set(Array.isArray(data.bonusApplied) ? data.bonusApplied : []);
    // A loaded side rewrites the last three jobs before the engine
    // reads them, so Continue resumes the arc Riko picked — not the
    // placeholder entries the list shipped with.
    if (this.side) this.applySideVariants(this.side);
    this.lastIndex = -1;
  }

  reset() {
    this.side = null;
    this.standing = { mara: 0, dara: 0 };
    this.bonusApplied = new Set();
    this.choiceBeacons = null;
    this.lastIndex = -1;
  }
}
