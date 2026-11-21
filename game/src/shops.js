// The shops, v7: the two storefronts where Riko spends his money — the
// corner store (weapons, ammo, health, repairs — the v1 shop) and the
// new parts shop at the port road (engine, armour, tyres and extra
// garage slots, all through the economy). The Shops class owns the shop
// screen's DOM: which section shows for which storefront, every button's
// label and disabled state, and the income-ledger panel that shows where
// the cash came from.
//
// The screen itself is one overlay (the shop-screen div in index.html):
// the corner store shows the weapons section, the parts shop shows the
// parts section, and both show the cash line and the ledger. The game
// opens the screen through openShop(kind); the Shops class decides what
// the player sees once he is inside.
//
// Prices live in the economy (UPGRADE_DEFS, GARAGE_SLOTS) and in
// config.js (TUNE, for the legacy weapons). This class never invents a
// price — it only renders the one the catalogue names, so the button
// and the purchase can never disagree.
import { TUNE } from './config.js';
import { UPGRADE_DEFS, GARAGE_SLOTS } from './economy.js';
import { money } from './util.js';

/** The two storefronts: where they sit on the map, what they sell, and
 * what the screen header says when Riko walks in. The corner store is
 * the original shop at Sunset Plaza; the parts shop is the new one on
 * the port road, next to Mara's garage. */
export const SHOPFRONTS = {
  corner: {
    id: 'corner',
    title: '🛒 CORNER STORE',
    blurb: 'Guns, ammo, a patch-up and a repair — the plaza shop has what a wheelman needs.',
    place: 'shop',
  },
  parts: {
    id: 'parts',
    title: '🔧 RIKO\'S PARTS SHOP',
    blurb: 'Engines, armour, tyres and garage space — make the car yours before the next job.',
    place: 'parts',
  },
};

/** The parts-shop catalogue, as the screen renders it: one row per
 * upgrade line (the button always offers the *next* level, with its
 * price), plus the next garage slot. The weapons rows stay in main.js's
 * buy() — this catalogue only covers what the parts shop sells. */
export const PARTS_ROWS = [
  { kind: 'engine', button: 'buy-engine' },
  { kind: 'armor', button: 'buy-armor' },
  { kind: 'tires', button: 'buy-tires' },
];

export class Shops {
  constructor(game) {
    this.game = game;
    // Which storefront the screen is showing right now: 'corner' or
    // 'parts'. Null when the screen is closed.
    this.currentKind = null;
    // How many times Riko has walked into a shop this run — the stats
    // screen reads it as the "shopping trips" line.
    this.visits = 0;
    // What he spent in shops this run, across both storefronts.
    this.spentHere = 0;
  }

  /** Wire the parts-shop buttons. Called once, from the game's screen
   * binding — the legacy weapon buttons keep their handlers in main.js,
   * and this class only owns the buttons the parts shop adds. */
  bind() {
    const $ = (id) => document.getElementById(id);
    for (const row of PARTS_ROWS) {
      const btn = $(row.button);
      if (btn) btn.addEventListener('click', () => this.buyUpgrade(row.kind));
    }
    const slotBtn = $('buy-garage-slot');
    if (slotBtn) slotBtn.addEventListener('click', () => this.buyGarageSlot());
  }

  /** Open the shop screen for a storefront: remember which one, count
   * the visit, and refresh every label before the screen shows. */
  open(kind) {
    this.currentKind = SHOPFRONTS[kind] ? kind : 'corner';
    this.visits += 1;
    this.refresh();
  }

  /** Close the shop screen: forget the storefront, so the next open
   * starts clean instead of showing the last section. */
  close() {
    this.currentKind = null;
  }

  /** Refresh every label on the shop screen: cash, health, the weapons
   * section (corner store) or the parts section (parts shop), the
   * garage-slot row and the ledger panel. Called on open and after
   * every purchase, so a button never offers what Riko cannot afford
   * or already owns. */
  refresh() {
    const $ = (id) => document.getElementById(id);
    const game = this.game;
    const econ = game.economy;
    const cashEl = $('shop-cash');
    if (cashEl) cashEl.textContent = `Cash: ${money(game.money)} · Net worth: ${money(econ.netWorth())}`;
    const healthEl = $('shop-health');
    if (healthEl) healthEl.textContent = `Health: ${Math.ceil(game.player.health)} · ${econ.fittedSummary()}`;
    const titleEl = $('shop-title');
    if (titleEl && this.currentKind) titleEl.textContent = SHOPFRONTS[this.currentKind].title;
    const blurbEl = $('shop-blurb');
    if (blurbEl && this.currentKind) blurbEl.textContent = SHOPFRONTS[this.currentKind].blurb;

    // Sections: the weapons wall shows at the corner store, the parts
    // wall at the parts shop — the other one hides, so the screen never
    // offers a gun where only spanners are sold.
    const weaponsSection = $('shop-weapons');
    if (weaponsSection) weaponsSection.style.display = this.currentKind === 'parts' ? 'none' : 'block';
    const partsSection = $('shop-parts');
    if (partsSection) partsSection.style.display = this.currentKind === 'parts' ? 'block' : 'none';

    // Legacy weapon buttons (main.js's buy() still owns the purchase):
    // their disabled state is refreshed here too, so the parts shop
    // never leaves a stale weapon button enabled behind the hidden wall.
    this.refreshWeapons();

    // Parts rows: each button offers the next level of its line — its
    // name, its price, and whether Riko can afford it — or reads MAXED
    // once the line is fully fitted.
    for (const row of PARTS_ROWS) {
      const btn = $(row.button);
      if (!btn) continue;
      const def = UPGRADE_DEFS[row.kind];
      const level = econ.upgrades[row.kind] || 0;
      if (level >= def.levels.length) {
        btn.disabled = true;
        btn.textContent = `${def.icon} ${def.label} — MAXED (${def.levels[level - 1].name})`;
        continue;
      }
      const next = def.levels[level];
      btn.disabled = game.money < next.price;
      btn.textContent = `${def.icon} ${def.label} ${next.name} — ${money(next.price)}`;
    }

    // Garage slot: the next slot's price and the capacity it buys, or
    // MAXED once both are bought.
    const slotBtn = $('buy-garage-slot');
    if (slotBtn) {
      const next = econ.nextGarageSlot();
      if (!next) {
        slotBtn.disabled = true;
        slotBtn.textContent = `🏠 Garage — MAXED (${econ.garageCapacity()} slots)`;
      } else {
        slotBtn.disabled = game.money < next.price;
        slotBtn.textContent = `🏠 ${next.name} — ${money(next.price)} (garage holds ${econ.garageCapacity()} now)`;
      }
    }

    // Ledger panel: the five newest money movements, newest first, so
    // Riko can see at a glance whether the missions or the drifting
    // paid for the engine he is about to buy.
    const ledgerEl = $('shop-ledger');
    if (ledgerEl) {
      const recent = econ.recent(5);
      const rows = recent.length === 0
        ? '<div class="log-row"><span>No earnings yet — Mara is waiting.</span></div>'
        : recent.map((e) => (
          `<div class="log-row"><span>${e.label}</span><span>${e.amount >= 0 ? '+' : '−'}$${Math.abs(e.amount).toLocaleString('en-US')}</span></div>`
        )).join('');
      ledgerEl.innerHTML = `<h4>LEDGER — ${econ.bestSourceLine()}</h4>${rows}`
        + `<div class="log-row"><span>Lifetime earned</span><span>${money(econ.lifetimeEarned)}</span></div>`
        + `<div class="log-row"><span>Lifetime spent</span><span>${money(econ.lifetimeSpent)}</span></div>`;
    }
  }

  /** The legacy weapon buttons' disabled state, refreshed with the rest
   * of the screen. The purchase itself stays in main.js's buy() — this
   * only keeps the buttons honest. */
  refreshWeapons() {
    const $ = (id) => document.getElementById(id);
    const game = this.game;
    const p = game.player;
    const setBtn = (id, owned, price, label) => {
      const btn = $(id);
      if (!btn) return;
      btn.disabled = owned || game.money < price;
      btn.textContent = owned ? `${label} — owned` : `${label} — ${money(price)}`;
    };
    setBtn('buy-shotgun', p.owned.shotgun, TUNE.shotgunPrice, 'Shotgun');
    setBtn('buy-smg', p.owned.smg, TUNE.smgPrice, 'SMG');
    const ammoShotgun = $('buy-shotgun-ammo');
    if (ammoShotgun) ammoShotgun.disabled = !p.owned.shotgun || game.money < TUNE.shotgunAmmoPrice;
    const ammoSmg = $('buy-smg-ammo');
    if (ammoSmg) ammoSmg.disabled = !p.owned.smg || game.money < TUNE.smgAmmoPrice;
    const heal = $('buy-health');
    if (heal) heal.disabled = p.health >= TUNE.playerMaxHealth || game.money < TUNE.healthPrice;
    const repair = $('buy-repair');
    if (repair) {
      const carDamage = p.car ? p.car.damage : 0;
      repair.disabled = carDamage <= 0 || game.money < TUNE.repairPrice;
      repair.textContent = carDamage <= 0
        ? 'Repair Car — no damage'
        : `Repair Car (${Math.ceil(carDamage)}%) — ${money(TUNE.repairPrice)}`;
    }
  }

  /** Buy the next level of an upgrade line through the economy. The
   * purchase either lands (fitted, paid, announced) or it does not —
   * maxed or unaffordable — and the screen refreshes either way. */
  buyUpgrade(kind) {
    const econ = this.game.economy;
    const before = econ.upgrades[kind] || 0;
    const bought = econ.buyUpgrade(kind);
    if (bought) {
      this.spentHere += UPGRADE_DEFS[kind].levels[before].price;
      this.game.audio.chime();
    } else {
      const def = UPGRADE_DEFS[kind];
      const maxed = before >= def.levels.length;
      this.game.missions.say(
        maxed
          ? `${def.label} is already maxed — nothing left to fit.`
          : `Not enough cash for the next ${def.label.toLowerCase()} — ${money(def.levels[before].price)}.`,
        3,
      );
    }
    this.refresh();
  }

  /** Buy the next garage slot through the economy. */
  buyGarageSlot() {
    const econ = this.game.economy;
    const next = econ.nextGarageSlot();
    if (!next) {
      this.game.missions.say('The garage is already at five slots — no more room to build.', 3);
      this.refresh();
      return;
    }
    const bought = econ.buyGarageSlot();
    if (bought) {
      this.spentHere += next.price;
      this.game.audio.chime();
    } else {
      this.game.missions.say(`The ${next.name.toLowerCase()} costs ${money(next.price)} — you're short.`, 3);
    }
    this.refresh();
  }

  /** Which storefront the player is nearest to, if any — the E-key
   * handler asks this before opening the screen, so the right wall of
   * goods shows for the shop Riko actually walked into. Returns the
   * storefront id ('corner' | 'parts') or null when he is near neither. */
  nearestStorefront(x, z, places, dist2) {
    if (!places || !dist2) return null;
    if (dist2(x, z, places.parts.x, places.parts.z) < 64) return 'parts';
    if (dist2(x, z, places.shop.x, places.shop.z) < 64) return 'corner';
    return null;
  }

  // ----- save / load ------------------------------------------------------
  serialize() {
    return {
      visits: this.visits,
      spentHere: Math.floor(this.spentHere),
      currentKind: this.currentKind,
    };
  }

  restore(data) {
    if (!data) return;
    this.visits = data.visits || 0;
    this.spentHere = data.spentHere || 0;
    this.currentKind = null;
  }

  reset() {
    this.currentKind = null;
    this.visits = 0;
    this.spentHere = 0;
  }
}
