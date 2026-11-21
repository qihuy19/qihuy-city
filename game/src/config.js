// Qihuy City v6: the constants that shape the whole game — the street grid,
// the palette of a sun-soaked coastal city, the car names, the story missions
// and the tuning numbers for driving, the wanted level and combat. Nothing
// here names any real place, person or commercial game.
//
// v3 adds: a boardwalk district and an industrial port on the map, a weather
// system (clear / rain / fog / storm) with driving grip to match, three new
// story jobs (a taxi shift, an ambulance run, a timed port delivery), and
// four more hidden cash stashes, for twelve in all.
//
// v5 adds: an airport district in the north-west corner (runway, terminal,
// hangars, control tower, parked planes), three more story jobs (an airport
// heist on a motorbike, a casino-strip job, and a five-star finale on the
// runway — seventeen in all), four more stashes for twenty in all, weather
// that now trims police sight range (fog halves it), motorbike and
// safehouse-garage tuning, and two more QCPD callsigns for the 5-star chase.
//
// v6 rewrites the tuning layer into one place and grows the map: a ninth
// district (Ferry Point, south-east, with a ferry terminal and a lighthouse
// on the pier), three more story jobs (eighteen, nineteen, twenty — a
// ferry-terminal grab, a Market Row hustle and a sunset finale on the
// boardwalk), four more stashes for twenty-four in all, two more taxi
// fares, two more QCPD callsigns, an overcast weather state, and a
// data-driven DISTRICTS table so the HUD, the minimap and the save file all
// read the same district list instead of three copies of the same bounds.
// Driving gets drift tuning (handbrake slides now build a drift score that
// pays out on the next clean stop), police get spike strips at 4 stars and
// a PIT move at 3, and the helicopter gets a coordinated spotlight.

export const CITY = {
  /** Distance between the centre lines of parallel roads. */
  pitch: 62,
  /** Road indices run -4..4, so the city spans nine roads each way. */
  halfGrid: 4,
  roadHalf: 7,
  /** Half the side of a city block's buildable core. */
  blockHalf: 20,
  /** The city wall in world units; the beach and sea sit south of it. */
  bound: 272,
  /** Where the sand starts and the water starts, on the south edge. */
  beachZ: 292,
  waterZ: 318,
  /** The boardwalk deck runs along the sand, east to west. */
  boardwalkZ: 300,
  boardwalkHalf: 240,
  /** The industrial port fills the far east edge, past the last road. */
  portX: 300,
  portZ: -62,
  portHalf: 62,
  /** The marina fills the south-west corner past the last road, on the sand. */
  marinaX: -248,
  marinaZ: 217,
  /** The airport fills the north-west corner (v5): runway, terminal,
   * hangars and a control tower, with its own perimeter road. */
  airportX: -248,
  airportZ: -217,
  airportHalf: 62,
  runwayZ: -248,
  /** Old Town: the colourful low quarter in the north-east corner. */
  oldTownX: 217,
  oldTownZ: -217,
  /** Market Row runs the east edge, south of the port. */
  marketX: 217,
  marketZ: 124,
  /** Ferry Point (v6): the south-east corner past the last road — a ferry
   * terminal on the sand and a lighthouse at the end of the pier. */
  ferryX: 248,
  ferryZ: 248,
  lighthouseX: 210,
  lighthouseZ: 322,
};

/** The nine districts, as data. Each entry is an axis-aligned box on the
 * map; the first match wins, so the small special districts are listed
 * before the big generic ones. The HUD's district label, the minimap
 * legend, the explored-districts counter and the save file all read this
 * one table — there is no second copy of the bounds anywhere else. */
export const DISTRICTS = [
  {
    id: 'airport', label: 'Airport', color: 0x9a9aa2,
    x0: -310, z0: -279, x1: -186, z1: -155,
    blurb: 'Runway, terminal and hangars — planes, not patrols, own the sky here.',
  },
  {
    id: 'ferry', label: 'Ferry Point', color: 0x2b6cb0,
    x0: 186, z0: 217, x1: 310, z1: 330,
    blurb: 'The last stop south-east: a ferry terminal and the lighthouse pier.',
  },
  {
    id: 'boardwalk', label: 'Boardwalk', color: 0xa9805a,
    x0: -310, z0: 292, x1: 310, z1: 330,
    blurb: 'Stalls, a ferris wheel and the sea — the whole city comes here at dusk.',
  },
  {
    id: 'port', label: 'Industrial Port', color: 0x6a6a72,
    x0: 240, z0: -127, x1: 362, z1: 3,
    blurb: 'Containers, cranes and sheds — Mara\'s goods clear customs here.',
  },
  {
    id: 'marina', label: 'Marina', color: 0x7fb0a8,
    x0: -310, z0: 155, x1: -188, z1: 279,
    blurb: 'Moored boats, a bait shack and anglers who have seen everything.',
  },
  {
    id: 'oldtown', label: 'Old Town', color: 0x5a3a2a,
    x0: 155, z0: -248, x1: 279, z1: -155,
    blurb: 'Low painted houses, striped awnings and Dara\'s market stalls.',
  },
  {
    id: 'casino', label: 'Casino Strip', color: 0xc9a227,
    x0: 155, z0: -93, x1: 310, z1: 31,
    blurb: 'The Golden Palm and its valet forecourt — Dara\'s turf after dark.',
  },
  {
    id: 'market', label: 'Market Row', color: 0x6a4a2a,
    x0: 155, z0: 62, x1: 279, z1: 186,
    blurb: 'Six stalls down the east edge, neon signs over every awning.',
  },
  {
    id: 'downtown', label: 'Downtown', color: 0x2a3a55,
    x0: -93, z0: -248, x1: 93, z1: -124,
    blurb: 'Glass towers with neon crowns — the skyline on every postcard.',
  },
  {
    id: 'suburb', label: 'Suburb', color: 0x6a9a52,
    x0: -248, z0: 124, x1: -124, z1: 248,
    blurb: 'Quiet houses, garden trees and the safehouse on the corner.',
  },
  {
    id: 'plaza', label: 'Sunset Plaza', color: 0xd95f9e,
    x0: -76, z0: -76, x1: 14, z1: 14,
    blurb: 'The fountain at the centre of the grid — where Riko always starts.',
  },
];

/** Which district a world position belongs to, by the DISTRICTS table.
 * Returns the district object, or null for the generic city streets. */
export function districtAtPoint(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d;
  }
  return null;
}

/** The warm sunset palette: sand, coral, teal sea, ink shadows. v4 deepens
 * the sunset — magenta dusk overhead, hot pink mid-sky, orange at the
 * horizon — so the city glows pink and gold in every screenshot. v6 adds
 * the ferry-point blues and the lighthouse lamp for the new district. */
export const PALETTE = {
  skyTop: 0x6a2f8f,
  skyMid: 0xd95f9e,
  skyHorizon: 0xff9a5a,
  skyHorizonLow: 0xffb36b,
  sun: 0xffd9a0,
  sunCore: 0xfff3c9,
  fog: 0xf7b98a,
  duskFog: 0xe87a9a,
  road: 0x3a3f4a,
  roadLine: 0xf5d76e,
  sidewalk: 0xb9a98c,
  sand: 0xe8cf9e,
  sea: 0x1f7f8c,
  grass: 0x5d8a4a,
  boardwalk: 0xa9805a,
  container: 0xc65a3a,
  crane: 0xf2c230,
  runway: 0x2e3238,
  runwayMark: 0xf5f5f0,
  hangar: 0x8a94a6,
  terminalGlass: 0x7fa8c9,
  rainSky: 0x5a6a84,
  fogSky: 0x9aa5b5,
  neonPink: 0xff5a9e,
  neonCyan: 0x2bd9c9,
  neonGold: 0xffc94f,
  ferryBlue: 0x2b6cb0,
  ferryDeck: 0x8a94a6,
  lighthouse: 0xf2f2f2,
  lighthouseLamp: 0xffe9a0,
  overcastSky: 0x7a8494,
};

/** Weather: each state sets the sky, the fog, the rain and the road grip.
 * v4 adds 'dusk': a pink golden-hour state with long light and dry roads.
 * v5 adds `sight`: how far police can see in this weather — fog cuts the
 * perception cone to little more than half, rain and storm trim it too,
 * so the same chase plays differently under different skies.
 * v6 adds 'overcast': grey, dry, cool light — a calm state between the
 * storms, with full police sight but slightly dimmer sun. */
export const WEATHER_STATES = {
  clear: { label: 'Clear', sky: 0xf7b98a, fogNear: 180, fogFar: 520, rain: 0, grip: 1.0, light: 1.0, sight: 1.0 },
  dusk: { label: 'Golden Dusk', sky: 0xff8fa8, fogNear: 150, fogFar: 460, rain: 0, grip: 1.0, light: 0.92, sight: 1.0 },
  overcast: { label: 'Overcast', sky: 0x7a8494, fogNear: 140, fogFar: 420, rain: 0, grip: 0.96, light: 0.82, sight: 1.0 },
  rain: { label: 'Rain', sky: 0x5a6a84, fogNear: 120, fogFar: 380, rain: 1, grip: 0.72, light: 0.72, sight: 0.85 },
  fog: { label: 'Fog', sky: 0x9aa5b5, fogNear: 45, fogFar: 190, rain: 0, grip: 0.9, light: 0.85, sight: 0.55 },
  storm: { label: 'Storm', sky: 0x3a4358, fogNear: 90, fogFar: 300, rain: 2, grip: 0.6, light: 0.55, sight: 0.7 },
};

export const CAR_NAMES = [
  'Kancil GT', 'Seroja Coupe', 'Badak Pickup', 'Melati Sedan',
  'Garuda Sport', 'Komodo Van', 'Cendana Taxi', 'Lumba Cruiser',
  'Aruna Ambulance', 'Samudra Truck', 'Bintang Cab', 'Pelita Van',
];
/** Motorbike names (v5): the airport bike and the street bikes. */
export const BIKE_NAMES = ['Petir 150', 'Angin Rider', 'Kilap 250', 'Senja Runner'];
export const BIKE_COLORS = [0xd94f3d, 0x2bb3a3, 0xf2c230, 0x8a5fd0];
export const CAR_COLORS = [
  0xd94f3d, 0x3d7fd9, 0xf2c230, 0x7ac74f, 0xe8e4da, 0x8a5fd0,
  0x2bb3a3, 0xd97fb0, 0x4a4a55, 0xff8c42, 0x5ec8e8, 0xc9a06c,
];
export const POLICE_COLOR = 0x1c2f6e;
export const TAXI_COLOR = 0xf2c230;
export const AMBULANCE_COLOR = 0xf2f2f2;

/** Vehicle classes (v6): the handling table in vehicles.js keys off these,
 * so a class change in one place retunes every car of that class at once. */
export const VEHICLE_CLASSES = {
  compact: { label: 'Compact', accel: 15, maxSpeed: 31, turn: 2.0, grip: 1.0, mass: 1.0 },
  sedan: { label: 'Sedan', accel: 16, maxSpeed: 34, turn: 1.9, grip: 1.0, mass: 1.1 },
  sport: { label: 'Sport', accel: 22, maxSpeed: 42, turn: 2.3, grip: 1.1, mass: 0.9 },
  van: { label: 'Van', accel: 13, maxSpeed: 29, turn: 1.6, grip: 1.0, mass: 1.4 },
  truck: { label: 'Truck', accel: 10, maxSpeed: 26, turn: 1.3, grip: 0.9, mass: 2.2 },
  bike: { label: 'Motorbike', accel: 26, maxSpeed: 40, turn: 2.6, grip: 0.85, mass: 0.35 },
  police: { label: 'Patrol', accel: 20, maxSpeed: 38, turn: 2.1, grip: 1.05, mass: 1.2 },
  taxi: { label: 'Taxi', accel: 15, maxSpeed: 33, turn: 1.9, grip: 1.0, mass: 1.1 },
  ambulance: { label: 'Ambulance', accel: 17, maxSpeed: 36, turn: 1.8, grip: 1.0, mass: 1.5 },
};

/** The story: Riko Vale, a wheelman back in Qihuy City, runs jobs for Mara. */
export const MISSIONS = [
  {
    id: 'hot-wheels',
    title: 'Mission 1 — Hot Wheels',
    brief: 'Mara needs wheels. Steal any car on the street and bring it to the garage on Pelican Row.',
    stages: ['Steal a car (walk up to one and press E)', 'Drive to the garage marker'],
    reward: 150,
    needCar: true,
    dropoff: 'garage',
  },
  {
    id: 'the-package',
    title: 'Mission 2 — The Package',
    brief: 'Pick up Mara\'s package at the docks and deliver it to the Neon Palms club. The heat is on — you have 2:30.',
    stages: ['Drive to the docks pickup', 'Grab the package (press E)', 'Deliver to Neon Palms before the timer ends'],
    reward: 300,
    timeLimit: 150,
    pickup: 'docks',
    dropoff: 'club',
    starsOnPickup: 2,
  },
  {
    id: 'harbor-lights',
    title: 'Mission 3 — Harbor Lights',
    brief: 'One last job: lift the cash case from the harbor warehouse. The Rimba crew will not hand it over quietly.',
    stages: ['Reach the harbor warehouse', 'Grab the cash case (press E)', 'Lose the heat and reach the hideout'],
    reward: 600,
    pickup: 'warehouse',
    dropoff: 'hideout',
    starsOnPickup: 3,
    gangOnPickup: true,
  },
  {
    id: 'sunset-fare',
    title: 'Mission 4 — Sunset Fare',
    brief: 'Mara\'s cousin needs a ride. Pick up the fare at Sunset Plaza and get them to the Beachfront Hotel before 2:00 — smooth driving, no cops.',
    stages: ['Pick up the fare at Sunset Plaza (press E)', 'Drive them to the Beachfront Hotel before the timer ends'],
    reward: 450,
    timeLimit: 120,
    pickup: 'plaza',
    dropoff: 'hotel',
  },
  {
    id: 'warehouse-raid',
    title: 'Mission 5 — Warehouse Raid',
    brief: 'The Rimba crew stashed Mara\'s cut in the north warehouse. Take it back — they will shoot first.',
    stages: ['Reach the north warehouse', 'Grab Mara\'s cut (press E)', 'Fight clear and bring it to the garage'],
    reward: 700,
    pickup: 'warehouse2',
    dropoff: 'garage',
    starsOnPickup: 2,
    gangOnPickup: true,
  },
  {
    id: 'hospital-run',
    title: 'Mission 6 — Hospital Run',
    brief: 'A friend of Mara\'s is hurt. Collect the meds at City Hospital and run them to the hideout in 2:30. The patrols are watching the hospital.',
    stages: ['Collect the meds at City Hospital (press E)', 'Deliver to the hideout before the timer ends'],
    reward: 900,
    timeLimit: 150,
    pickup: 'hospital',
    dropoff: 'hideout',
    starsOnPickup: 2,
  },
  {
    id: 'the-big-score',
    title: 'Mission 7 — The Big Score',
    brief: 'A Garuda Sport is parked by the beach, keys in it, owner bragging. Lift it and bring it to the garage — the whole city will be looking.',
    stages: ['Steal the Garuda Sport at the beach', 'Lose the heat and bring it to the garage'],
    reward: 1100,
    needCar: true,
    dropoff: 'garage',
    starsOnSteal: 3,
    beachCar: true,
  },
  {
    id: 'last-getaway',
    title: 'Mission 8 — Last Getaway',
    brief: 'The final job. Grab Mara\'s ledger at the docks and run it to the hideout. Four stars, a helicopter overhead, 3:00 on the clock. Make it count.',
    stages: ['Grab the ledger at the docks (press E)', 'Outrun the chase and reach the hideout before the timer ends'],
    reward: 1500,
    timeLimit: 180,
    pickup: 'docks',
    dropoff: 'hideout',
    starsOnPickup: 4,
  },
  {
    id: 'taxi-shift',
    title: 'Mission 9 — Taxi Shift',
    brief: 'Mara\'s cab driver called in sick. Take the yellow Cendana Taxi, pick up three fares around town and drop each where the meter says — smooth driving earns a tip, a crash loses it.',
    stages: ['Take the taxi at the cab stand (press E)', 'Pick up fare 1 of 3', 'Drop every fare off for the tip'],
    reward: 800,
    kind: 'taxi',
    pickup: 'taxiStand',
    dropoff: 'club',
    fares: 3,
  },
  {
    id: 'ambulance-run',
    title: 'Mission 10 — Ambulance Run',
    brief: 'A dock worker is down at the port. Take the Aruna ambulance, load the patient and run them to City Hospital — sirens on, no wanted stars while the lights are flashing, but the clock is real: 3:00.',
    stages: ['Take the ambulance at the port (press E)', 'Load the patient at the docks', 'Race them to City Hospital before the timer ends'],
    reward: 1000,
    kind: 'ambulance',
    timeLimit: 180,
    pickup: 'docks',
    dropoff: 'hospital',
  },
  {
    id: 'port-delivery',
    title: 'Mission 11 — Port Delivery',
    brief: 'A container of Mara\'s goods just cleared the port crane. Haul the Samudra truck from the port to the north warehouse in 2:30 — the truck is slow, the road is wet, and the Rimba crew wants the cargo.',
    stages: ['Take the truck at the port (press E)', 'Load the container (press E)', 'Deliver to the north warehouse before the timer ends'],
    reward: 1200,
    kind: 'delivery',
    timeLimit: 150,
    pickup: 'port',
    dropoff: 'warehouse2',
    starsOnPickup: 2,
    gangOnPickup: true,
  },
  {
    id: 'neon-run',
    title: 'Mission 12 — Neon Run',
    brief: 'Mara\'s ledger pages are scattered — one set at the marina, one in Old Town. Lift the marina set first, then the Old Town set, and bring both to the hideout. Three stars from the moment you grab the first page.',
    stages: ['Grab the marina ledger (press E)', 'Grab the Old Town ledger (press E)', 'Bring both sets to the hideout'],
    reward: 1400,
    pickup: 'marina',
    dropoff: 'hideout',
    starsOnPickup: 3,
    secondPickup: 'oldtown',
    gangOnPickup: true,
  },
  {
    id: 'old-town-run',
    title: 'Mission 13 — Old Town Run',
    brief: 'The Rimba crew moved Mara\'s cut into a market stall in Old Town. Take it back, then run it to the garage through Market Row — they will be waiting on every corner, and the clock is 2:30.',
    stages: ['Reach the Old Town market stall', 'Grab Mara\'s cut (press E)', 'Run it to the garage before the timer ends'],
    reward: 1600,
    timeLimit: 150,
    pickup: 'oldtown',
    dropoff: 'garage',
    starsOnPickup: 3,
    gangOnPickup: true,
  },
  {
    id: 'the-long-sunset',
    title: 'Mission 14 — The Long Sunset',
    brief: 'The final job. One case at the marina, four stars, a helicopter overhead, and the whole QCPD roadblock squad out. Grab the case and run it to the hideout in 4:00. Drive like the sunset depends on it — it does.',
    stages: ['Grab the sunset case at the marina (press E)', 'Outrun the roadblocks and the chopper', 'Reach the hideout before the timer ends'],
    reward: 2200,
    timeLimit: 240,
    pickup: 'marina',
    dropoff: 'hideout',
    starsOnPickup: 4,
    gangOnPickup: true,
  },
  {
    id: 'airport-heist',
    title: 'Mission 15 — Airport Heist',
    brief: 'Mara has a plane-side job: a crate of her goods sits in Hangar 2 at Qihuy Airport, and a second crate waits on the runway apron. A motorbike is parked by the terminal for the getaway. Four stars the moment you touch the first crate — and the shotgun is yours for this one.',
    stages: ['Grab the hangar crate (press E)', 'Grab the runway crate (press E)', 'Escape the airport and reach the hideout'],
    reward: 2600,
    timeLimit: 300,
    pickup: 'hangar',
    dropoff: 'hideout',
    starsOnPickup: 4,
    secondPickup: 'runway',
    gangOnPickup: true,
    grantsShotgun: true,
    bikeAtStart: true,
  },
  {
    id: 'casino-strip',
    title: 'Mission 16 — Casino Strip',
    brief: 'Dara is running her own game on the casino strip — a velvet bag of her chips is sitting in the back room of the Golden Palm, and Mara wants it. Three stars, her crew on every corner, 3:00 to the garage.',
    stages: ['Reach the Golden Palm casino', 'Grab the velvet bag (press E)', 'Run it to the garage before the timer ends'],
    reward: 2800,
    timeLimit: 180,
    pickup: 'casino',
    dropoff: 'garage',
    starsOnPickup: 3,
    gangOnPickup: true,
  },
  {
    id: 'the-final-runway',
    title: 'Mission 17 — The Final Runway',
    brief: 'The last job, part two. One case on the airport tarmac, five stars, two helicopters overhead and roadblocks on every road out of the airport. Five minutes. Take the case, take the runway, and bring it home — the whole city is watching.',
    stages: ['Grab the tarmac case at the airport (press E)', 'Outrun two choppers and the roadblocks', 'Reach the hideout before the timer ends'],
    reward: 4000,
    timeLimit: 300,
    pickup: 'airport',
    dropoff: 'hideout',
    starsOnPickup: 5,
    gangOnPickup: true,
  },
  {
    id: 'ferry-terminal',
    title: 'Mission 18 — Ferry Terminal',
    brief: 'Mara\'s last crate off the island is sitting at Ferry Point, and the Rimba crew knows the ferry leaves at dusk. Grab it at the terminal, then run it up the boardwalk to the garage — three stars, 3:00, and the lighthouse watching the whole way.',
    stages: ['Reach the Ferry Point terminal', 'Grab the ferry crate (press E)', 'Run it to the garage before the timer ends'],
    reward: 3200,
    timeLimit: 180,
    pickup: 'ferry',
    dropoff: 'garage',
    starsOnPickup: 3,
    gangOnPickup: true,
  },
  {
    id: 'market-hustle',
    title: 'Mission 19 — Market Hustle',
    brief: 'Dara moved Mara\'s cut into a stall on Market Row — twice now, and twice the crew has waited on every corner. Take it back, then run it to the hideout through the port. Four stars, the crew, and 3:00 on the clock.',
    stages: ['Reach the Market Row stall', 'Grab Mara\'s cut (press E)', 'Run it to the hideout before the timer ends'],
    reward: 3400,
    timeLimit: 180,
    pickup: 'market',
    dropoff: 'hideout',
    starsOnPickup: 4,
    gangOnPickup: true,
  },
  {
    id: 'sunset-finale',
    title: 'Mission 20 — Sunset Finale',
    brief: 'The real last job. One case on the boardwalk by the ferris wheel, five stars, two helicopters, spike strips on the beach road and the whole QCPD out. Five minutes. Take the case, take the boardwalk, and bring it home — the sunset is yours.',
    stages: ['Grab the boardwalk case (press E)', 'Outrun the choppers and the spike strips', 'Reach the hideout before the timer ends'],
    reward: 5000,
    timeLimit: 300,
    pickup: 'boardwalk',
    dropoff: 'hideout',
    starsOnPickup: 5,
    gangOnPickup: true,
  },
  {
    id: 'the-split',
    title: 'Mission 21 — The Split',
    brief: 'Mara and Dara both want you — and both want the other one gone. Drive to Mara\'s garage (gold beacon) or Dara\'s casino (pink beacon). Your choice decides the last three jobs, who briefs them, and what they pay.',
    stages: ['Drive to Mara\'s garage OR Dara\'s casino', 'Pick a side — the other fixer will remember it'],
    reward: 0,
    branchChoice: true,
    dropoff: 'garage',
  },
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
];

/** Key places on the map, in world coordinates. */
export const PLACES = {
  garage: { x: 124, z: -124, label: 'Mara\'s Garage' },
  docks: { x: -186, z: 186, label: 'Docks Pickup' },
  club: { x: 186, z: 62, label: 'Neon Palms Club' },
  warehouse: { x: -186, z: -186, label: 'Harbor Warehouse' },
  warehouse2: { x: 186, z: -186, label: 'North Warehouse' },
  hideout: { x: 62, z: -186, label: 'Hideout' },
  hospital: { x: 0, z: 124, label: 'City Hospital' },
  spawn: { x: 0, z: 0, label: 'Sunset Plaza' },
  plaza: { x: -31, z: -31, label: 'Sunset Plaza' },
  hotel: { x: 0, z: 248, label: 'Beachfront Hotel' },
  shop: { x: 62, z: 62, label: 'Riko\'s Corner Store' },
  safehouse: { x: -124, z: 124, label: 'Safehouse' },
  beachCar: { x: 62, z: 248, label: 'Garuda Sport' },
  boardwalk: { x: -62, z: 300, label: 'Boardwalk' },
  pier: { x: 124, z: 306, label: 'Pier' },
  port: { x: 300, z: -62, label: 'Industrial Port' },
  taxiStand: { x: -62, z: 62, label: 'Cab Stand' },
  clinic: { x: -124, z: -62, label: 'Port Clinic' },
  marina: { x: -248, z: 217, label: 'Marina Docks' },
  oldtown: { x: 217, z: -217, label: 'Old Town Market' },
  market: { x: 217, z: 124, label: 'Market Row' },
  airport: { x: -248, z: -217, label: 'Qihuy Airport' },
  hangar: { x: -262, z: -196, label: 'Hangar 2' },
  runway: { x: -226, z: -248, label: 'Runway Apron' },
  casino: { x: 186, z: -62, label: 'Golden Palm Casino' },
  terminal: { x: -222, z: -196, label: 'Airport Terminal' },
  /** v6: Ferry Point — the terminal building on the sand, and the
   * lighthouse at the end of the pier, past the boardwalk's east end. */
  ferry: { x: 248, z: 248, label: 'Ferry Point Terminal' },
  lighthouse: { x: 210, z: 322, label: 'Lighthouse Pier' },
  /** v7: Riko's Parts Shop — engines, armour, tyres and garage slots,
   * on the port road next to Mara's garage. */
  parts: { x: 186, z: -124, label: "Riko's Parts Shop" },
};

/** Taxi fares: where a fare waits and where they want to go. v6 adds two
 * more — the ferry terminal and the lighthouse pier — so the cab shift
 * can send Riko to the new district too. */
export const TAXI_FARES = [
  { from: 'plaza', to: 'hotel', base: 60 },
  { from: 'club', to: 'safehouse', base: 80 },
  { from: 'taxiStand', to: 'boardwalk', base: 70 },
  { from: 'hotel', to: 'garage', base: 90 },
  { from: 'safehouse', to: 'pier', base: 75 },
  { from: 'ferry', to: 'casino', base: 95 },
  { from: 'boardwalk', to: 'ferry', base: 85 },
];

/** Twenty-four cash stashes hidden around the city for free-roam collecting
 * — v4 adds four in the new districts: two at the marina, two in Old Town.
 * v5 adds four more: two at the airport, two on the casino strip.
 * v6 adds four more: two at Ferry Point, one on the lighthouse pier, one
 * in the downtown towers. */
export const STASH_SPOTS = [
  { x: -155, z: -31 }, { x: 155, z: -93 }, { x: -93, z: 155 },
  { x: 93, z: -155 }, { x: -31, z: -93 }, { x: 217, z: 31 },
  { x: -217, z: 93 }, { x: 31, z: 217 },
  { x: -200, z: 300 }, { x: 200, z: 300 }, { x: 300, z: -120 },
  { x: 300, z: 20 },
  { x: -248, z: 248 }, { x: -220, z: 190 }, { x: 217, z: -248 },
  { x: 248, z: -186 },
  { x: -262, z: -226 }, { x: -226, z: -186 }, { x: 186, z: -31 },
  { x: 155, z: -62 },
  { x: 248, z: 268 }, { x: 272, z: 224 }, { x: 210, z: 312 },
  { x: 62, z: -93 },
];

/** QCPD patrol callsigns: each police unit gets its own name, so the live
 * roster reads like a real dispatch board instead of numbered clones.
 * v6 adds two more for the five-star response: KITE and SWIFT. */
export const POLICE_CALLSIGNS = [
  { name: 'FALCON', unit: 'QCPD-11' },
  { name: 'HERON', unit: 'QCPD-23' },
  { name: 'KESTREL', unit: 'QCPD-37' },
  { name: 'OSPREY', unit: 'QCPD-42' },
  { name: 'MERLIN', unit: 'QCPD-58' },
  { name: 'HARRIER', unit: 'QCPD-64' },
  { name: 'CONDOR', unit: 'QCPD-71' },
  { name: 'SPARROW', unit: 'QCPD-79' },
  { name: 'KITE', unit: 'QCPD-84' },
  { name: 'SWIFT', unit: 'QCPD-91' },
];

/** Visual-novel mission briefings: Mara (and once, the rival fixer Dara)
 * talks Riko through the job before it starts. Each line is one dialogue
 * beat; the briefing overlay types them out in order. v6 adds the three
 * new jobs' briefings — the ferry job from Mara, the market hustle from
 * Dara, and the finale from Mara. */
export const BRIEFINGS = {
  'hot-wheels': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'Riko. You\'re back in Qihuy City at last.',
      'I need wheels, and I need them quiet. Steal any car on the street and bring it to my garage on Pelican Row.',
      'The patrols are bored tonight. Don\'t give them a reason to wake up.',
    ],
  },
  'the-package': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'A package is waiting at the docks. Neon Palms wants it before the crowd does.',
      'Two and a half minutes, Riko. The heat will be on the moment you touch it.',
      'Drive like you mean it. I\'ll be listening on the radio.',
    ],
  },
  'harbor-lights': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'The Rimba crew took my cash case to the harbor warehouse.',
      'They won\'t hand it over. They never do. Bring it back and I\'ll make it worth your while.',
      'If they shoot first — and they will — shoot back.',
    ],
  },
  'sunset-fare': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'My cousin needs a ride, and she does not wait for anyone.',
      'Sunset Plaza to the Beachfront Hotel, two minutes, smooth as glass. No cops, no crashes.',
      'She tips well when the ride is smooth. She walks when it isn\'t.',
    ],
  },
  'warehouse-raid': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'The Rimba crew moved my cut to the north warehouse.',
      'They will shoot first. That is their whole personality.',
      'Take it back, bring it to the garage, and try not to bleed on the money.',
    ],
  },
  'hospital-run': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'A friend of mine is hurt, and the hospital is out of the meds he needs.',
      'Collect them at City Hospital and run them to the hideout. Two and a half minutes.',
      'The patrols watch the hospital. Smile at them. Then drive.',
    ],
  },
  'the-big-score': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'There is a Garuda Sport parked by the beach. Keys in it. Owner bragging about it.',
      'Lift it, lose the heat, bring it to the garage. Three stars from the moment you touch the door.',
      'It is the fastest thing in this city, Riko. Prove it.',
    ],
  },
  'last-getaway': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'The ledger is at the docks, and the whole city wants it.',
      'Four stars. A helicopter. Three minutes. This is the one they will tell stories about.',
      'Run it to the hideout, Riko. Then we are done — and the city is ours.',
    ],
  },
  'taxi-shift': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'My cab driver called in sick, and the fares are piling up at the stand.',
      'Take the yellow Cendana, pick up three fares, drop each where the meter says.',
      'Smooth driving earns a tip. A crash loses it. You know how to drive smooth, don\'t you?',
    ],
  },
  'ambulance-run': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'A dock worker is down at the port, and the ambulance is waiting for a driver.',
      'Load the patient, sirens on, three minutes to City Hospital.',
      'Sirens on means the city gives you a pass. A crash does not — the patient feels every bump.',
    ],
  },
  'port-delivery': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'A container of my goods just cleared the crane at the port.',
      'Haul the Samudra truck to the north warehouse. Two and a half minutes, and the truck is slow.',
      'The Rimba crew wants the cargo. Drive like it is yours — because it is about to be.',
    ],
  },
  'neon-run': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'My ledger is in two pieces now. One at the marina, one in Old Town.',
      'Three stars the second you grab the first page — the whole city will know your name by sunset.',
      'Two stops, one hideout. Don\'t stop for anything.',
    ],
  },
  'old-town-run': {
    speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
    lines: [
      'So Mara sent you to Old Town. Cute. My crew is already there, Riko.',
      'The market stall has her cut. My boys have the corners. Two and a half minutes, if you\'re fast.',
      'Take it, if you can. I\'ll be watching from the roof.',
    ],
  },
  'the-long-sunset': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'Last job, Riko. One case at the marina. Four stars. A chopper. Roadblocks on every road out.',
      'Four minutes. That\'s the whole plan — four minutes of driving like the sunset depends on it.',
      'Because it does. Bring it home.',
    ],
  },
  'airport-heist': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'There\'s a crate of mine in Hangar 2 at the airport, and a second one out on the runway apron.',
      'Four stars the moment you touch the first crate — so take the bike by the terminal. It\'s fast, it\'s nimble, and it fits between their roadblocks.',
      'And Riko — the shotgun is yours for this one. No charge. Bring both crates to the hideout.',
    ],
  },
  'casino-strip': {
    speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
    lines: [
      'Well, well. Mara sent you to my casino. The Golden Palm, back room, velvet bag of my chips.',
      'My crew owns every corner of the strip, Riko. Three stars, three minutes, and a garage run.',
      'Take the bag if you can. I\'ll be counting the chips from the roof.',
    ],
  },
  'the-final-runway': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'One case on the airport tarmac. Five stars. Two helicopters. Roadblocks on every road out of the airport.',
      'Five minutes, Riko. The whole city is watching this one — the towers, the strip, the runway lights.',
      'Take the case, take the runway, and bring it home. Then we are done — and Qihuy City is ours.',
    ],
  },
  'ferry-terminal': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'My last crate off the island is at Ferry Point, and the ferry leaves at dusk.',
      'The Rimba crew knows the timetable too. Three stars, three minutes, up the boardwalk to the garage.',
      'The lighthouse sees the whole beach, Riko. Make sure it sees you winning.',
    ],
  },
  'market-hustle': {
    speaker: 'DARA', role: 'RIVAL FIXER', color: '#ff5a9e', initial: 'D',
    lines: [
      'Back to Market Row, Riko? My crew moved Mara\'s cut there twice now, and twice you took it.',
      'Four stars this time, and the port road is mine. Three minutes, if you\'re fast.',
      'Take it, if you can. Third time\'s the charm — for one of us.',
    ],
  },
  'sunset-finale': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'The real last job, Riko. One case on the boardwalk by the ferris wheel.',
      'Five stars. Two helicopters. Spike strips on the beach road. The whole QCPD is out.',
      'Five minutes. Take the case, take the boardwalk, and bring it home. The sunset is yours.',
    ],
  },
  'the-split': {
    speaker: 'MARA', role: 'FIXER', color: '#ffd94f', initial: 'M',
    lines: [
      'Twenty jobs, Riko. Twenty. And now it comes down to this.',
      'Dara wants you on her side. I want you on mine. There is no third door — drive to my garage, or drive to her casino.',
      'Pick carefully. The last three jobs, the pay, the turf — all of it follows the door you choose. And the other one of us will remember.',
    ],
  },
};

export const TUNE = {
  walkSpeed: 6.5,
  sprintSpeed: 10.5,
  jumpSpeed: 8.5,
  gravity: 24,
  carAccel: 16,
  carBrake: 30,
  carReverse: 10,
  carMaxSpeed: 34,
  carMaxReverse: 12,
  carTurn: 1.9,
  trafficSpeed: 9,
  policeSpeed: 37,
  pedSpeed: 2.2,
  punchRange: 2.2,
  punchDamage: 34,
  gunDamage: 45,
  gunRange: 70,
  gunCooldown: 0.32,
  shotgunDamage: 26, // per pellet, 5 pellets
  shotgunPellets: 5,
  shotgunRange: 30,
  shotgunCooldown: 0.85,
  smgDamage: 18,
  smgRange: 50,
  smgCooldown: 0.09,
  shotgunPrice: 150,
  smgPrice: 250,
  shotgunAmmoPrice: 40, // 12 shells
  smgAmmoPrice: 60, // 60 rounds
  pistolAmmoPrice: 30, // 24 rounds (pistol starts with 24)
  healthPrice: 50, // full heal
  repairPrice: 60, // full car repair at Mara's garage
  playerMaxHealth: 100,
  wantedDecaySeconds: 18,
  bustedHoldSeconds: 1.6,
  stashReward: 50,
  stealFine: 50,
  wastedFine: 100,
  // Taxi: the meter ticks per metre driven with a fare aboard; a smooth
  // ride (no crashes, no wanted stars) pays a tip on top of the fare.
  taxiMeterPerMetre: 0.35,
  taxiTipSmooth: 40,
  taxiTipCrash: 0,
  // Ambulance: sirens on means no new wanted stars, but the patient
  // loses health on every hard crash — lose them and the job fails.
  ambulancePatientHealth: 100,
  ambulanceCrashDamage: 18,
  // Stamina: sprint drains it, walking and standing still refill it.
  staminaMax: 100,
  staminaDrain: 22,
  staminaRegen: 16,
  // Vehicles: a crash over this speed damages the car; at 0 it stalls.
  carDamageSpeed: 9,
  carMaxDamage: 100,
  carSmokeAt: 55,
  weatherChangeSeconds: 75,
  // Police brain (v4): perception cone, last-known position, utility scores.
  policeSightRange: 95,
  policeSightHalfAngle: 1.22, // ~70 degrees each side of the heading
  policeHearRange: 26, // close enough to hear, even out of sight
  policeMemorySeconds: 14, // how long a last-known position stays fresh
  policeRoadblockMinStars: 3,
  policeRoadblockMinDist: 70, // only set a roadblock when the player is far
  policeRamMaxDist: 26, // inside this range, ramming outscores pursuit
  policeUtilityHysteresis: 0.08, // stick with the current tactic on near-ties
  // v5 escalation: at 4-5 stars roadblocks score higher and cool down
  // faster, and a second helicopter joins at 5 stars.
  policeRoadblockHighStarBonus: 0.18,
  policeRoadblockCooldownSeconds: 12,
  policeRoadblockCooldownHighStars: 7,
  policeSecondHeliStars: 5,
  policeMaxUnits: 4, // 3 cars at 4 stars, 4 at 5 stars
  // Motorbike (v5): quicker off the line and sharper in a turn than any
  // car, but a crash hurts the rider — no steel cage around him.
  bikeAccel: 26,
  bikeMaxSpeed: 40,
  bikeTurn: 2.6,
  bikeCrashPlayerDamage: 8,
  // Shotgun (v5): the heist gun — five pellets, a wide cone, and a hard
  // shove that knocks a gunman off his feet.
  shotgunKnockback: 1.6,
  shotgunPumpMs: 0, // pump is instant; the 0.85 s cooldown is the pump
  // Safehouse garage (v5): buy the garage once, then park up to three
  // stolen cars in it — they persist across saves.
  garagePrice: 500,
  garageCapacity: 3,
  // Game feel (v4): hit-stop freezes the sim briefly on a landed hit.
  hitstopPunchMs: 55,
  hitstopShotMs: 70,
  hitstopCrashMs: 90,
  hitstopRamMs: 110,
  // Chase camera (v4): C cycles the follow distance.
  camDistances: [8, 12.5, 18],
  // --- v6: drift, police v2 and the helicopter spotlight -------------------
  // Drift: holding the handbrake through a fast turn builds a drift score
  // (points per metre slid); it banks when the car straightens out cleanly
  // and pays out as cash at the next full stop. A crash wipes it.
  driftMinSpeed: 12,
  driftPointsPerMetre: 2,
  driftBankSeconds: 1.2, // straight driving this long banks the drift
  driftMaxBank: 400,
  // Spike strips (v6): at 4+ stars a patrol unit may drop a strip across
  // the road ahead of the player; driving over one shreds the tyres and
  // caps the car's speed until repaired.
  spikeStripMinStars: 4,
  spikeStripCooldownSeconds: 18,
  spikeStripSpeedCap: 12,
  // PIT manoeuvre (v6): at 3+ stars a unit alongside the player may swing
  // into his rear quarter to spin him; the spin costs speed, not health.
  pitMinStars: 3,
  pitMaxDist: 8,
  pitSpinSeconds: 0.9,
  // Helicopter spotlight (v6): at night the chopper's beam tracks the
  // player and pins him — while the beam is on him, wanted decay pauses.
  heliSpotlightNightOnly: true,
  heliSpotlightRadius: 9,
  // On-foot v6: a dodge roll (double-tap Shift while moving) gives a short
  // burst of speed and a half-second of knockback immunity.
  rollSpeed: 16,
  rollSeconds: 0.45,
  rollCooldownSeconds: 1.2,
  // --- v7: the traffic director, the branching story and the modes -------
  // Traffic director: the density the clock aims for — rush hour thick,
  // deep night thin, the rest of the day in between — and how far a car
  // has to drift from the player before the director despawns it.
  trafficRushTarget: 30,
  trafficNightTarget: 12,
  trafficDayTarget: 20,
  trafficDespawnDist: 280,
  // Vigilante shift: five minutes, six suspects, $150 a bust.
  vigilanteShiftSeconds: 300,
  vigilanteSuspects: 6,
  vigilanteBustReward: 150,
  // Taxi career shift: four minutes of endless fares.
  taxiShiftSeconds: 240,
};
