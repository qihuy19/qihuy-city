// Save and load: one localStorage slot holding the money, the mission
// progress, the collected stashes, the player's spot, his weapons, the
// weather and the run's stats. The game autosaves on mission completion and
// on pause; Continue on the title screen picks it back up. Nothing leaves
// the browser.
//
// v2 of the format (Qihuy City v3) adds the weather state and the stats
// block; a v1 save still loads, with weather defaulting to clear and stats
// to zero.
//
// v3 of the format (Qihuy City v4) adds the districts the player has
// visited and the mission briefings already seen, so the briefing overlay
// can skip a repeat and the save screen can show the explored map. v1 and
// v2 saves still load, with the new fields defaulting to empty.
//
// v4 of the format (Qihuy City v5) adds the safehouse garage — whether it
// is bought and which stolen cars are parked in it (up to three) — and the
// extended stats the pause-menu stats screen reads: cars stolen, best
// wanted level reached, and total play time. v1–v3 saves still load, with
// the garage unowned and empty and the new stats defaulting to zero.
//
// v5 of the format (Qihuy City v6) adds the mission log (every completed
// mission and side job, newest first, with the payout), the side jobs done
// and their count, the drift earnings the driver banked, the day/night
// clock (so Continue resumes at the same hour, not always at dusk), and the
// taxi reputation (fares completed and tips earned). v1–v4 saves still load,
// with the log empty, side jobs at zero, drift earnings at zero, the clock
// at the v5 default dusk, and reputation at zero. The slot key moves to
// v5; the old keys are read as legacy and cleared on the next save.
const KEY = 'qihuy-city-save-v5';
const LEGACY_KEYS = [
  'qihuy-city-save-v4', 'qihuy-city-save-v3', 'qihuy-city-save-v2', 'qihuy-city-save-v1',
];

/** The v5 default stats: every field the stats screen reads, zeroed. */
export function defaultStats() {
  return {
    fares: 0, crashes: 0, repairs: 0, missionsDone: 0,
    carsStolen: 0, bestWanted: 0, playTime: 0,
    // v5: the drift ledger and the taxi reputation.
    driftEarned: 0, driftBest: 0, sideJobsDone: 0,
    faresCompleted: 0, tipsEarned: 0,
  };
}

/** The v5 default garage: unowned, no cars parked. */
export function defaultGarage() {
  return { owned: false, cars: [] };
}

/** The v5 default mission log: an empty history, newest first. */
export function defaultMissionLog() {
  return [];
}

/** The v5 default taxi reputation: no fares, no tips. */
export function defaultReputation() {
  return { faresCompleted: 0, tipsEarned: 0, stars: 0 };
}

/** The v5 default clock: dusk, the same hour a fresh game starts at. */
export function defaultClock() {
  return { dayNightT: 0 };
}

/** The v7 defaults, riding in the v5 slot: the economy (upgrades, garage
 * slots, ledger), the story side and standing, the shops' visit counts,
 * the modes' best scores and the interiors' visit counts. A v5 save
 * without them loads with everything stock and unchosen. */
export function defaultEconomySave() {
  return {
    upgrades: { engine: 0, armor: 0, tires: 0 },
    extraSlots: 0, ledger: [], lifetimeEarned: 0, lifetimeSpent: 0,
  };
}

export function defaultStorySave() {
  return { side: null, standing: { mara: 0, dara: 0 }, bonusApplied: [] };
}

export function defaultShopsSave() {
  return { visits: 0, spentHere: 0 };
}

export function defaultModesSave() {
  return { best: { vigilante: 0, taxi: 0 } };
}

export function defaultInteriorsSave() {
  return { visits: { shop: 0, casino: 0, safehouse: 0 }, gambles: 0, gambleWon: 0 };
}

/** The v8 defaults, riding in the v5 slot: the helicopter pursuit
 * stats (choppers down, air hits, evasions, bounties) and the boats'
 * fleet (bought kinds, smuggling runs, earnings, sinkings). A v5 save
 * without them loads with a quiet sky and an empty fleet. */
export function defaultHeliSave() {
  return {
    helisDowned: 0, shotsLanded: 0, evasions: 0,
    bountiesEarned: 0, lockSeconds: 0, lockPeaked: 0,
  };
}

export function defaultBoatsSave() {
  return {
    ownedKinds: [], runsDone: 0, runsFailed: 0, earned: 0,
    boatsBought: 0, boatsStolen: 0, boatsSunk: 0, bestTime: 0,
  };
}

/** The full v5 shape, for the title screen's "New Game" reset and for the
 * load path to fill in whatever an older save is missing. */
export function defaultSaveData() {
  return {
    version: 5,
    money: 0,
    missionIndex: 0,
    stashesCollected: 0,
    stashesTaken: [],
    player: { x: 0, z: 0, health: 100 },
    weapons: {
      weapon: 'pistol',
      owned: { pistol: true, shotgun: false, smg: false },
      ammo: { shotgun: 0, smg: 0 },
    },
    weather: 'clear',
    stats: defaultStats(),
    districtsVisited: [],
    briefingsSeen: [],
    garage: defaultGarage(),
    // v5 fields:
    missionLog: defaultMissionLog(),
    sideJobsDone: 0,
    driftEarned: 0,
    clock: defaultClock(),
    reputation: defaultReputation(),
    // v7 fields, riding in the v5 slot:
    economy: defaultEconomySave(),
    story: defaultStorySave(),
    shops: defaultShopsSave(),
    modes: defaultModesSave(),
    interiors: defaultInteriorsSave(),
    // v8 fields, riding in the v5 slot:
    heli: defaultHeliSave(),
    boats: defaultBoatsSave(),
    time: 0,
  };
}

export function saveGame(game) {
  try {
    const data = {
      version: 5,
      money: game.money,
      missionIndex: game.missions.index,
      stashesCollected: game.missions.stashesCollected,
      stashesTaken: game.missions.stashes.map((s) => s.taken),
      player: { x: game.player.x, z: game.player.z, health: game.player.health },
      weapons: {
        weapon: game.player.weapon,
        owned: game.player.owned,
        ammo: { shotgun: game.player.ammo.shotgun, smg: game.player.ammo.smg },
      },
      weather: game.weather ? game.weather.state : 'clear',
      stats: { ...defaultStats(), ...(game.stats || {}) },
      districtsVisited: [...(game.districtsVisited || [])],
      briefingsSeen: [...(game.missions.briefingsSeen || [])],
      garage: game.garage ? {
        owned: !!game.garage.owned,
        cars: (game.garage.cars || []).map((c) => ({
          name: c.name, bodyKind: c.bodyKind, color: c.color, damage: c.damage || 0,
        })),
      } : defaultGarage(),
      // v5: the mission log (newest first, capped at 30 entries so the
      // slot stays small), the side-job count, the drift ledger, the
      // day/night clock and the taxi reputation.
      missionLog: (game.missions.log || []).slice(0, 30).map((e) => ({
        id: e.id, title: e.title, reward: e.reward || 0, time: e.time || 0,
      })),
      sideJobsDone: game.missions.sideJobsDone || 0,
      driftEarned: game.driftEarned || 0,
      clock: { dayNightT: game.dayNight ? game.dayNight.t : 0 },
      reputation: {
        faresCompleted: game.stats ? game.stats.faresCompleted || 0 : 0,
        tipsEarned: game.stats ? game.stats.tipsEarned || 0 : 0,
        // The star rating is one star per five fares, capped at five.
        stars: Math.min(5, Math.floor((game.stats ? game.stats.faresCompleted || 0 : 0) / 5)),
      },
      // v7: the economy, the story side, the shops, the modes' best
      // scores and the interiors — each system serializes itself, and
      // each one is guarded so an older game object still saves.
      economy: game.economy ? game.economy.serialize() : defaultEconomySave(),
      story: game.story ? game.story.serialize() : defaultStorySave(),
      shops: game.shops ? game.shops.serialize() : defaultShopsSave(),
      modes: game.modes ? game.modes.serialize() : defaultModesSave(),
      interiors: game.interiors ? game.interiors.serialize() : defaultInteriorsSave(),
      // v8: the helicopter pursuit stats and the boats' fleet — each
      // system serializes itself, guarded like the v7 ones.
      heli: game.heliPursuit ? game.heliPursuit.serialize() : defaultHeliSave(),
      boats: game.boats ? game.boats.serialize() : defaultBoatsSave(),
      time: game.time,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    // A fresh v5 save makes the legacy slots redundant — clear them so an
    // old save can never shadow the new one on a later load.
    for (const legacy of LEGACY_KEYS) {
      try { localStorage.removeItem(legacy); } catch (err) {}
    }
    return true;
  } catch (err) {
    return false;
  }
}

/** Fill every field an older save is missing, so the game never has to
 * null-check a save field again. v1–v4 saves are upgraded in place. */
export function upgradeSave(data) {
  const d = { ...defaultSaveData(), ...data };
  if (data.version === 1) {
    // v1 saves carry no weather or stats: the game defaults them.
    d.weather = 'clear';
    d.stats = defaultStats();
  }
  if (data.version < 3) {
    // v1/v2 saves carry no district or briefing history.
    d.districtsVisited = [];
    d.briefingsSeen = [];
  }
  if (data.version < 4) {
    // v1–v3 saves carry no garage and no extended stats.
    d.garage = defaultGarage();
    d.stats = { ...defaultStats(), ...(data.stats || {}) };
  }
  if (data.version < 5) {
    // v1–v4 saves carry no mission log, side jobs, drift ledger, clock
    // or reputation — the run's history simply starts empty.
    d.missionLog = defaultMissionLog();
    d.sideJobsDone = 0;
    d.driftEarned = 0;
    d.clock = defaultClock();
    d.reputation = defaultReputation();
  }
  // v7 fields ride in the v5 slot: a save written before v7 has none of
  // them, and loads with everything stock and the story unchosen.
  d.economy = data.economy && typeof data.economy === 'object'
    ? { ...defaultEconomySave(), ...data.economy }
    : defaultEconomySave();
  d.story = data.story && typeof data.story === 'object'
    ? { ...defaultStorySave(), ...data.story }
    : defaultStorySave();
  d.shops = data.shops && typeof data.shops === 'object'
    ? { ...defaultShopsSave(), ...data.shops }
    : defaultShopsSave();
  d.modes = data.modes && typeof data.modes === 'object'
    ? { ...defaultModesSave(), ...data.modes }
    : defaultModesSave();
  d.interiors = data.interiors && typeof data.interiors === 'object'
    ? { ...defaultInteriorsSave(), ...data.interiors }
    : defaultInteriorsSave();
  // v8 fields ride in the v5 slot: a save written before v8 has none
  // of them, and loads with a quiet sky and an empty fleet.
  d.heli = data.heli && typeof data.heli === 'object'
    ? { ...defaultHeliSave(), ...data.heli }
    : defaultHeliSave();
  d.boats = data.boats && typeof data.boats === 'object'
    ? { ...defaultBoatsSave(), ...data.boats }
    : defaultBoatsSave();
  // Merge, never replace: a v5 save that is missing one field (a hand-edited
  // slot, an interrupted write) still loads with that field defaulted.
  d.stats = { ...defaultStats(), ...(data.stats || {}) };
  d.garage = { ...defaultGarage(), ...(data.garage || {}) };
  d.reputation = { ...defaultReputation(), ...(data.reputation || {}) };
  d.clock = { ...defaultClock(), ...(data.clock || {}) };
  d.missionLog = Array.isArray(data.missionLog) ? data.missionLog : defaultMissionLog();
  d.districtsVisited = Array.isArray(data.districtsVisited) ? data.districtsVisited : [];
  d.briefingsSeen = Array.isArray(data.briefingsSeen) ? data.briefingsSeen : [];
  d.stashesTaken = Array.isArray(data.stashesTaken) ? data.stashesTaken : [];
  d.version = 5;
  return d;
}

export function loadGame() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      for (const legacy of LEGACY_KEYS) {
        raw = localStorage.getItem(legacy);
        if (raw) break;
      }
    }
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.version !== 'number' || data.version < 1 || data.version > 5) return null;
    return upgradeSave(data);
  } catch (err) {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
    for (const legacy of LEGACY_KEYS) localStorage.removeItem(legacy);
  } catch (err) {}
}
