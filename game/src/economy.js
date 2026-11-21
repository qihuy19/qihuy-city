// The economy, v7: Riko's wallet, the income ledger, the car-upgrade
// catalogue and the extra garage slots. Everything Riko earns — mission
// payouts, drift cash, taxi tips, stash finds, side-job pay, vigilante
// bounties — flows through here as a ledger entry, so the pause screen
// and the shop can show *where* the money came from instead of one bare
// number. Everything he spends — engine, armour, tyres, garage slots —
// is an upgrade level the game applies to whatever car he is driving.
//
// The economy owns no DOM and no scene: it is pure state plus the
// purchase rules. The Shops class renders it; the Game wires the
// per-frame application of upgrades onto the player's car.
//
// Money itself still lives on the game (game.money) — the economy is the
// bookkeeper and the parts catalogue, not a second wallet. That keeps
// every existing system (missions, drift payout, fines, shop prices)
// working exactly as before, while the ledger gives each of them a
// paper trail.
import { TUNE } from './config.js';
import { money } from './util.js';

/** The three upgrade lines, each with three levels. A level's price is
 * what the next purchase costs; its effects are what applyToCar() writes
 * onto the car. Engine buys acceleration and top speed; armour buys
 * damage resistance (a fraction of every crash is shrugged off); tyres
 * buy top speed and — at level 3 — spike-proof rubber, so a strip
 * shreds nothing and the speed cap never bites. */
export const UPGRADE_DEFS = {
  engine: {
    label: 'Engine',
    icon: '🔧',
    blurb: 'Bigger block, hotter cam — faster off the line, higher top speed.',
    levels: [
      { price: 300, accel: 1.12, top: 1.08, name: 'Mk I Tuned' },
      { price: 700, accel: 1.25, top: 1.16, name: 'Mk II Street' },
      { price: 1500, accel: 1.4, top: 1.25, name: 'Mk III Race' },
    ],
  },
  armor: {
    label: 'Armour',
    icon: '🛡️',
    blurb: 'Plated doors and a reinforced frame — every crash hurts less.',
    levels: [
      { price: 250, factor: 0.85, name: 'Light Plating' },
      { price: 600, factor: 0.7, name: 'Street Armour' },
      { price: 1200, factor: 0.55, name: 'Full Cage' },
    ],
  },
  tires: {
    label: 'Tyres',
    icon: '🛞',
    blurb: 'Stickier rubber, stiffer sidewalls — and at Mk III, run-flats that laugh at spike strips.',
    levels: [
      { price: 200, top: 1.05, spikeProof: false, name: 'Sport Compound' },
      { price: 500, top: 1.1, spikeProof: false, name: 'Track Compound' },
      { price: 1000, top: 1.12, spikeProof: true, name: 'Run-Flat Mk III' },
    ],
  },
};

/** Extra garage slots, bought one at a time at the parts shop. The
 * safehouse garage holds three cars by default; each slot adds one more
 * parking space, up to five in total. A slot is a one-time purchase — it
 * stays bought across saves, like the upgrades. */
export const GARAGE_SLOTS = [
  { price: 800, capacity: 4, name: '4th Garage Slot' },
  { price: 1500, capacity: 5, name: '5th Garage Slot' },
];

/** Where money comes from, in the ledger's own words. Every source the
 * game can pay Riko through has an entry here, so the ledger never shows
 * a bare code name — 'Drift' reads as drift cash, 'Vigilante' as a
 * bounty, and so on. */
export const EARN_SOURCES = {
  mission: 'Story mission',
  sidejob: 'Side job',
  drift: 'Drift cash',
  stash: 'Cash stash',
  taxi: 'Taxi fares',
  vigilante: 'Vigilante bounty',
  casino: 'Casino winnings',
  refund: 'Refund',
  sale: 'Sale',
};

export class Economy {
  constructor(game) {
    this.game = game;
    // Upgrade levels: 0 (stock) to 3 (max) per line.
    this.upgrades = { engine: 0, armor: 0, tires: 0 };
    // Extra garage slots bought: 0, 1 or 2.
    this.extraSlots = 0;
    // The income ledger: newest first, capped at 60 entries so the save
    // slot stays small. Each entry is { source, label, amount, time } —
    // amount positive for earnings, negative for spending.
    this.ledger = [];
    // Lifetime totals, for the stats screen and the shop's summary line.
    this.lifetimeEarned = 0;
    this.lifetimeSpent = 0;
  }

  // ----- the ledger -------------------------------------------------------
  /** Record a money movement: positive for earnings, negative for
   * spending. The game itself moves game.money; this is the paper trail
   * that says why. Spending entries are recorded by spend(); earnings
   * by earn(). */
  record(source, amount, label) {
    const entry = {
      source,
      label: label || EARN_SOURCES[source] || source,
      amount: Math.round(amount),
      time: this.game ? this.game.time : 0,
    };
    this.ledger.unshift(entry);
    if (this.ledger.length > 60) this.ledger.length = 60;
    if (amount > 0) this.lifetimeEarned += amount;
    else this.lifetimeSpent += -amount;
    return entry;
  }

  /** Pay Riko: add cash to the wallet and write the ledger line. */
  earn(source, amount, label) {
    if (!this.game || amount <= 0) return 0;
    this.game.money += amount;
    this.record(source, amount, label);
    return amount;
  }

  /** Charge Riko: take cash from the wallet and write the ledger line.
   * Returns false when he cannot afford it — the caller keeps the item. */
  spend(amount, label) {
    if (!this.game || this.game.money < amount) return false;
    this.game.money -= amount;
    this.record('sale', -amount, label || 'Purchase');
    return true;
  }

  /** Total earned from one source, across the whole run. */
  totalFor(source) {
    let total = 0;
    for (const e of this.ledger) {
      if (e.source === source) total += e.amount;
    }
    return total;
  }

  /** The ledger's newest entries, for the shop's summary panel. */
  recent(count) {
    return this.ledger.slice(0, count || 5);
  }

  /** One line for the shop: what Riko earned most from, and how much. */
  bestSourceLine() {
    let best = null;
    let bestTotal = 0;
    for (const source of Object.keys(EARN_SOURCES)) {
      const total = this.totalFor(source);
      if (total > bestTotal) {
        bestTotal = total;
        best = source;
      }
    }
    if (!best) return 'No earnings yet — Mara is waiting.';
    return `Best earner: ${EARN_SOURCES[best]} — ${money(bestTotal)} so far.`;
  }

  // ----- upgrades ---------------------------------------------------------
  /** The definition of the next level of an upgrade line, or null when
   * the line is already maxed out. */
  nextLevel(kind) {
    const def = UPGRADE_DEFS[kind];
    if (!def) return null;
    const level = this.upgrades[kind] || 0;
    return level >= def.levels.length ? null : def.levels[level];
  }

  /** What the next level of a line costs, or null when maxed. */
  nextPrice(kind) {
    const next = this.nextLevel(kind);
    return next ? next.price : null;
  }

  /** Buy the next level of an upgrade line. Returns the bought level's
   * name, or null when maxed or unaffordable. The money moves through
   * spend() so the ledger shows the purchase. */
  buyUpgrade(kind) {
    const def = UPGRADE_DEFS[kind];
    if (!def) return null;
    const next = this.nextLevel(kind);
    if (!next) return null;
    if (!this.spend(next.price, `${def.label} ${next.name}`)) return null;
    this.upgrades[kind] += 1;
    if (this.game) {
      this.game.audio.purchase();
      this.game.missions.say(
        `${def.icon} ${def.label} ${next.name} fitted — ${def.blurb}`,
        5,
      );
    }
    return next.name;
  }

  /** The combined acceleration multiplier from the engine line. */
  get engineAccel() {
    const level = this.upgrades.engine || 0;
    if (level <= 0) return 1;
    return UPGRADE_DEFS.engine.levels[level - 1].accel;
  }

  /** The combined top-speed multiplier from engine + tyres. */
  get topSpeedMult() {
    let mult = 1;
    if (this.upgrades.engine > 0) mult *= UPGRADE_DEFS.engine.levels[this.upgrades.engine - 1].top;
    if (this.upgrades.tires > 0) mult *= UPGRADE_DEFS.tires.levels[this.upgrades.tires - 1].top;
    return mult;
  }

  /** The crash-damage fraction the armour line leaves behind. */
  get armorFactor() {
    const level = this.upgrades.armor || 0;
    if (level <= 0) return 1;
    return UPGRADE_DEFS.armor.levels[level - 1].factor;
  }

  /** True once the tyres line is maxed: spike strips do nothing. */
  get spikeProof() {
    const level = this.upgrades.tires || 0;
    if (level <= 0) return false;
    return !!UPGRADE_DEFS.tires.levels[level - 1].spikeProof;
  }

  /** Write the upgrade effects onto a car. The driving model reads
   * car.tuneAccel / car.tuneTop / car.armorFactor / car.spikeProof, so
   * this is the one place the upgrade state touches the physics — a car
   * that never gets this call drives stock, whatever Riko bought. The
   * game calls it every frame for the player's car, so a purchase made
   * mid-drive applies to the car already under him. */
  applyToCar(car) {
    if (!car) return;
    car.tuneAccel = this.engineAccel;
    car.tuneTop = this.topSpeedMult;
    car.armorFactor = this.armorFactor;
    car.spikeProof = this.spikeProof;
  }

  /** A one-line summary of the fitted kit, for the shop and the stats. */
  fittedSummary() {
    const parts = [];
    for (const kind of ['engine', 'armor', 'tires']) {
      const level = this.upgrades[kind] || 0;
      if (level > 0) {
        parts.push(`${UPGRADE_DEFS[kind].label} ${UPGRADE_DEFS[kind].levels[level - 1].name}`);
      }
    }
    return parts.length > 0 ? parts.join(' · ') : 'Stock — no upgrades fitted';
  }

  // ----- garage slots -----------------------------------------------------
  /** The garage's capacity: three by default, plus one per slot bought. */
  garageCapacity() {
    return TUNE.garageCapacity + this.extraSlots;
  }

  /** The next slot for sale, or null when both are bought. */
  nextGarageSlot() {
    return this.extraSlots >= GARAGE_SLOTS.length ? null : GARAGE_SLOTS[this.extraSlots];
  }

  /** Buy the next garage slot. Returns the slot name, or null when
   * maxed or unaffordable. */
  buyGarageSlot() {
    const next = this.nextGarageSlot();
    if (!next) return null;
    if (!this.spend(next.price, next.name)) return null;
    this.extraSlots += 1;
    if (this.game) {
      this.game.audio.purchase();
      this.game.missions.say(
        `${next.name} bought — the safehouse garage now holds ${next.capacity} cars.`,
        5,
      );
    }
    return next.name;
  }

  // ----- net worth --------------------------------------------------------
  /** What Riko is worth: cash on hand, plus what he spent on upgrades
   * and garage slots (sunk, but it is still value fitted to his cars),
   * plus a flat value per car parked in the garage. The pause screen
   * reads this as the "worth" line — a richer number than the wallet. */
  netWorth() {
    let worth = this.game ? this.game.money : 0;
    for (const kind of ['engine', 'armor', 'tires']) {
      const level = this.upgrades[kind] || 0;
      for (let i = 0; i < level; i += 1) {
        worth += UPGRADE_DEFS[kind].levels[i].price;
      }
    }
    for (let i = 0; i < this.extraSlots; i += 1) {
      worth += GARAGE_SLOTS[i].price;
    }
    const parked = this.game && this.game.garage ? this.game.garage.cars.length : 0;
    worth += parked * 200;
    return Math.floor(worth);
  }

  // ----- save / load ------------------------------------------------------
  serialize() {
    return {
      upgrades: { ...this.upgrades },
      extraSlots: this.extraSlots,
      ledger: this.ledger.slice(0, 30).map((e) => ({
        source: e.source, label: e.label, amount: e.amount, time: e.time,
      })),
      lifetimeEarned: Math.floor(this.lifetimeEarned),
      lifetimeSpent: Math.floor(this.lifetimeSpent),
    };
  }

  restore(data) {
    if (!data) return;
    if (data.upgrades) {
      this.upgrades = {
        engine: data.upgrades.engine || 0,
        armor: data.upgrades.armor || 0,
        tires: data.upgrades.tires || 0,
      };
    }
    this.extraSlots = data.extraSlots || 0;
    this.ledger = Array.isArray(data.ledger) ? data.ledger.slice(0, 60) : [];
    this.lifetimeEarned = data.lifetimeEarned || 0;
    this.lifetimeSpent = data.lifetimeSpent || 0;
  }

  /** A fresh game: stock car, no slots, an empty ledger. */
  reset() {
    this.upgrades = { engine: 0, armor: 0, tires: 0 };
    this.extraSlots = 0;
    this.ledger = [];
    this.lifetimeEarned = 0;
    this.lifetimeSpent = 0;
  }
}
