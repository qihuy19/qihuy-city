// The screenshot poses behind ?shot=chase|street|mission|start|briefing|district.
// Each one sets the real game to a real state — a helicopter chase in the
// rain, a night street on the boardwalk, the ambulance run, the title screen,
// a visual-novel briefing, an Old Town sunset — then main.js simulates it
// forward on a fixed clock so the frame is what a short game really looks
// like, and the same seed always gives the same frame.
//
// v5 adds: airport (the new district at dusk), bike (the motorbike at
// speed), heist (mission 15 at the hangar, four stars) and finale
// (mission 17 on the runway, five stars, two helicopters); the chase pose
// is now a five-star chase with two choppers and a roadblock ahead.
//
// v6 adds: ferry (mission 18 at the ferry terminal — the ferry, the
// lighthouse beam and the ticket booth at dusk), drift (a handbrake slide
// across Sunset Plaza with the drift meter banking, tyre smoke trailing)
// and market (mission 19, the market hustle — Riko on foot between the
// stalls at golden hour, a gang crew closing in). The district pose is
// now the ferry point instead of the airport apron: the new district
// deserves the showcase frame.
import { PLACES } from './config.js';

/** Put the player behind the wheel of the nearest parked car, engine running. */
function putPlayerInCar(game, car, speed) {
  const player = game.player;
  player.car = car;
  player.onFoot = false;
  player.mesh.visible = false;
  car.kind = 'player';
  car.parked = false;
  car.stolen = true;
  car.speed = speed;
  player.x = car.x;
  player.z = car.z;
  player.yaw = car.yaw;
  game.camYaw = car.yaw;
  game.camPitch = 0.3;
}

/** Stage a drift: the car is already sliding — handbrake held, a drift
 * score banked — so the frame shows the slide, the smoke and the meter. */
function stageDrift(game, car, x, z, yaw, speed) {
  putPlayerInCar(game, car, speed);
  car.x = x; car.z = z; car.yaw = yaw;
  car.syncMesh();
  game.player.x = x; game.player.z = z; game.player.yaw = yaw;
  game.player.syncMesh();
  car.driftScore = 120;
  car.driftBanked = 0;
  car.drifting = true;
  game.camYaw = yaw;
  game.camPitch = 0.28;
  game.input.setVirtual({ forward: true, handbrake: true });
}

/**
 * Set `game` to the named scene. The caller then steps the game forward on a
 * fixed clock and renders once; the frame is the screenshot.
 */
export function stageShot(name, game) {
  game.resetWorld();
  game.audio.setMuted(true);

  if (name === 'start') {
    game.mode = 'title';
    game.showScreen('title-screen');
    game.hud.show(false);
    game.refreshTitle();
    return;
  }

  game.mode = 'play';
  game.showScreen(null);
  game.hud.show(true);
  game.missions.start();
  // The mission-1 briefing opens on start; every shot except 'briefing'
  // dismisses it (all three lines) so the world simulates behind the
  // frame instead of holding still under the dialogue overlay. v7: the
  // 'story' shot keeps its briefing too — the Split is a dialogue scene.
  if (name !== 'briefing' && name !== 'story') {
    while (game.missions.briefing) game.missions.advanceBriefing();
  }

  if (name === 'briefing') {
    // The visual-novel briefing for mission 12 (Neon Run): Mara's portrait
    // and nameplate over the sunset city, first line of dialogue showing.
    // The game is frozen behind the overlay, so the frame is the briefing.
    game.missions.index = 11;
    game.missions.stage = 0;
    game.missions.beginBriefing(game.missions.current);
    game.player.x = -31;
    game.player.z = -31;
    game.player.yaw = 2.6;
    game.player.syncMesh();
    game.camYaw = 2.6;
    game.camPitch = 0.28;
    game.camDistOverride = 14;
    return 5;
  }

  if (name === 'district') {
    // v6: the ferry point at golden dusk — Riko on foot on the pier,
    // looking south-east: the terminal hall to the left, the ferry at
    // its berth ahead with its ramp down, the lighthouse beam sweeping
    // the water beyond. The new district gets the showcase frame. (The
    // ferry moors south-east of the terminal, at 256/292 — the first
    // framing faced the lighthouse instead.)
    game.weather.setState('dusk');
    game.player.x = PLACES.ferry.x - 36;
    game.player.z = PLACES.ferry.z + 14;
    game.player.yaw = 0.96;
    game.player.syncMesh();
    game.camYaw = game.player.yaw;
    game.camPitch = 0.32;
    game.camDistOverride = 22;
    game.input.setVirtual({ forward: true });
    return 40;
  }

  if (name === 'ferry') {
    // v6: mission 18, the ferry-terminal run — Riko in a stolen sedan on
    // the pier road at dusk, two stars, a patrol car turning onto the
    // pier behind him, the ferry and the lighthouse in the frame.
    game.weather.setState('dusk');
    game.missions.index = 17;
    game.missions.stage = 1;
    game.missions.timer = 180;
    const car = game.traffic.cars.find((c) => c.parked);
    putPlayerInCar(game, car, 22);
    car.x = PLACES.ferry.x - 40; car.z = PLACES.ferry.z - 30; car.yaw = Math.PI / 4;
    car.syncMesh();
    game.player.x = car.x; game.player.z = car.z; game.player.yaw = car.yaw;
    game.player.syncMesh();
    game.camYaw = Math.PI / 4;
    game.setWanted(2);
    game.traffic.spawnPolice(car.x - 16, car.z + 6);
    game.camDistOverride = 15;
    game.camPitch = 0.28;
    game.missions.say('Ferry ticket secured — two stars, and the pier is the only way out.', 6);
    game.input.setVirtual({ forward: true });
    return 50;
  }

  if (name === 'drift') {
    // v6: a handbrake slide down the airport runway — the coupe already
    // sliding, the drift meter banking, tyre smoke trailing the rear
    // wheels, the terminal and the tower in the frame. The runway is open
    // tarmac, so the slide has room and the score survives the settle;
    // the steering input is what builds the points (a straight slide
    // does not drift).
    game.weather.setState('clear');
    const car = game.traffic.cars.find((c) => c.parked);
    stageDrift(game, car, -280, -248, Math.PI / 2, 24);
    game.input.setVirtual({ forward: true, handbrake: true, left: true });
    game.camDistOverride = 14;
    game.missions.say('Hold the handbrake through the turn — the slide pays.', 5);
    return 45;
  }

  if (name === 'market') {
    // v6: mission 19, the market hustle — Riko on foot between the Market
    // Row stalls at golden hour, a gang crew closing in from the far end,
    // the awnings and the produce crates in the frame.
    game.weather.setState('dusk');
    game.missions.index = 18;
    game.missions.stage = 1;
    game.missions.timer = 150;
    // On foot at the south end of Market Row, facing north into the
    // stalls — the gang crew spawns at PLACES.market just ahead.
    game.player.x = 205;
    game.player.z = 142;
    game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.camPitch = 0.3;
    game.camDistOverride = 13;
    game.spawnGangCrew('market');
    game.missions.say('The hustle is on — the stalls are cover, not shelter.', 6);
    game.input.setVirtual({ forward: true });
    return 30;
  }

  if (name === 'airport') {
    // v5: down the runway at dusk — Riko on foot at the runway threshold,
    // the centreline dashes and edge lights running away to the terminal,
    // a plane on the apron and the tower against the pink sky.
    game.weather.setState('dusk');
    game.player.x = -296;
    game.player.z = -248;
    game.player.yaw = Math.PI / 2;
    game.player.syncMesh();
    game.camYaw = game.player.yaw;
    game.camPitch = 0.26;
    game.camDistOverride = 12;
    game.input.setVirtual({ forward: true });
    return 40;
  }

  if (name === 'bike') {
    // v5: the motorbike at speed — Riko leaning a Petir 150 down the
    // boardwalk road at dusk, the ferris wheel ahead, the bike's lean
    // reading in the frame.
    game.weather.setState('dusk');
    const bike = game.traffic.spawnBike(-62, 268, Math.PI);
    putPlayerInCar(game, bike, 30);
    game.camDistOverride = 13;
    game.camPitch = 0.26;
    game.missions.say('The bike is quick — and it has no cage. Don\'t crash it.', 5);
    game.input.setVirtual({ forward: true });
    return 50;
  }

  if (name === 'heist') {
    // v5: mission 15, the airport heist — Riko on foot at Hangar 2 with
    // the first crate grabbed, four stars, a gang crew closing in and a
    // patrol car already turning onto the apron.
    game.missions.index = 14;
    game.missions.stage = 2;
    game.missions.packageTaken = true;
    game.missions.timer = 240;
    game.player.owned.shotgun = true;
    game.player.ammo.shotgun = 12;
    game.player.weapon = 'shotgun';
    // Stand south-east of Hangar 2 facing west, so the hangar, the gang
    // crew closing on it and the patrol car all read in one frame —
    // standing at the hangar's own corner filled the shot with one wall.
    game.player.x = PLACES.hangar.x + 24;
    game.player.z = PLACES.hangar.z + 18;
    game.player.yaw = -Math.PI / 2;
    game.player.syncMesh();
    game.setWanted(4);
    game.spawnGangCrew('hangar');
    game.traffic.spawnPolice(-272, -182);
    game.camYaw = -Math.PI / 2;
    game.camPitch = 0.3;
    game.camDistOverride = 15;
    game.missions.say('Hangar crate grabbed! Four stars — now the runway crate.', 6);
    return 30;
  }

  if (name === 'finale') {
    // v5: mission 17, the final runway — Riko in a stolen coupe on the
    // runway itself, five stars, two helicopters overhead and a roadblock
    // forming ahead of him on the tarmac.
    game.weather.setState('dusk');
    const car = game.traffic.cars.find((c) => c.parked);
    putPlayerInCar(game, car, 26);
    car.x = -280; car.z = -248; car.yaw = Math.PI / 2;
    car.syncMesh();
    game.player.x = -280; game.player.z = -248; game.player.yaw = Math.PI / 2;
    game.player.syncMesh();
    game.camYaw = Math.PI / 2;
    game.setWanted(5);
    game.traffic.spawnPolice(-200, -248);
    game.traffic.spawnPolice(-196, -236);
    for (const cop of game.traffic.police) cop.speed = 28;
    const heli = game.traffic.spawnHeli(car.x + 34, car.z - 12);
    heli.fixed = true;
    heli.y = 14;
    heli.mesh.position.set(heli.x, heli.y, heli.z);
    const heli2 = game.traffic.spawnHeli2(car.x - 20, car.z + 30);
    heli2.fixed = true;
    heli2.y = 18;
    heli2.mesh.position.set(heli2.x, heli2.y, heli2.z);
    game.camDistOverride = 15;
    game.camPitch = 0.28;
    game.missions.index = 16;
    game.missions.stage = 2;
    game.missions.timer = 240;
    game.missions.say('Tarmac case grabbed! Five stars, two choppers — run for the hideout!', 6);
    game.input.setVirtual({ forward: true });
    return 60;
  }

  if (name === 'mission') {
    // The ambulance run (mission 10): Riko racing the Aruna ambulance from
    // the docks to City Hospital, patient aboard at 82 HP, sirens on, the
    // timer running, no wanted stars while the lights flash.
    game.missions.index = 9;
    game.missions.stage = 2;
    game.missions.timer = 132;
    game.missions.patientHealth = 82;
    game.missions.packageTaken = true;
    const ambulance = game.spawnJobVehicle();
    putPlayerInCar(game, ambulance, 26);
    game.player.car.jobKind = 'ambulance';
    // Mid-run on the hospital road: the ambulance races north up the x=0
    // road toward City Hospital, beacon ahead, instead of nosing into the
    // port's container stacks.
    ambulance.x = 0; ambulance.z = 210; ambulance.yaw = Math.PI;
    ambulance.syncMesh();
    game.player.x = 0; game.player.z = 210; game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.setWanted(0);
    game.camDistOverride = 16;
    game.camPitch = 0.24;
    game.missions.say('Patient aboard — 2:12 to City Hospital. Don\'t crash!', 6);
    game.input.setVirtual({ forward: true });
    return 60;
  }

  if (name === 'street') {
    // Night on the boardwalk: Riko on foot by the food stalls, the ferris
    // wheel lit ahead of him to the west, lamps glowing, a parked car
    // waiting to be stolen.
    game.cycleT = 0.5;
    game.updateDayNight(0);
    game.player.x = -120;
    game.player.z = PLACES.boardwalk.z + 5;
    game.player.yaw = -1.65;
    game.player.syncMesh();
    game.camYaw = game.player.yaw;
    game.camPitch = 0.3;
    game.input.setVirtual({ forward: true });
    return;
  }

  if (name === 'traffic') {
    // v7: rush hour with the traffic director staging — Riko in a stolen
    // sedan on the main road at 8 in the morning, a convoy of three
    // trucks ahead of him, roadworks cones narrowing the lane, and the
    // street thick with cars the director spawned around him.
    game.dayNight.t = 0.5833; // 08:00 — morning rush hour
    game.updateDayNight(0);
    game.weather.setState('clear');
    const car = game.traffic.cars.find((c) => c.parked);
    putPlayerInCar(game, car, 20);
    car.x = 0; car.z = 60; car.yaw = Math.PI;
    car.syncMesh();
    game.player.x = 0; game.player.z = 60; game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.setWanted(3);
    game.traffic.spawnPolice(-8, 44);
    game.trafficDirector.startConvoy();
    game.trafficDirector.startRoadworks();
    for (let i = 0; i < 6; i += 1) game.trafficDirector.spawnNearPlayer();
    game.camDistOverride = 16;
    game.camPitch = 0.28;
    game.missions.index = 1;
    game.missions.stage = 2;
    game.missions.timer = 96;
    game.missions.say('Rush hour — the convoy ahead, roadworks on the lane, and the whole city in the mirror.', 6);
    game.input.setVirtual({ forward: true });
    return 50;
  }

  if (name === 'story') {
    // v7: mission 21, The Split — Mara's briefing over the sunset city,
    // the choice ahead of Riko: her garage (gold beacon) or Dara's
    // casino (pink beacon). The briefing stays open, like 'briefing'.
    game.missions.debugJump(20);
    game.missions.beginBriefing(game.missions.current);
    game.story.showChoiceBeacons(game);
    game.player.x = -31;
    game.player.z = -31;
    game.player.yaw = 2.6;
    game.player.syncMesh();
    game.camYaw = 2.6;
    game.camPitch = 0.28;
    game.camDistOverride = 14;
    return 5;
  }

  if (name === 'vigilante') {
    // v7: the vigilante shift — Riko deputised, chasing the red-marked
    // suspect down the main road at dusk, the marker bobbing over the
    // suspect's roof and the shift clock running. The story is set
    // aside, not finished, so the complete screen stays down.
    game.missions.index = -1;
    game.missions.done = true;
    game.completedShown = true;
    game.modes.start('vigilante');
    const suspect = game.modes.suspects[0];
    const car = game.traffic.cars.find((c) => c.parked);
    putPlayerInCar(game, car, 24);
    if (suspect) {
      // Behind the suspect, on its own road, facing the way it flees —
      // so the red marker reads ahead of Riko in the frame.
      const s = suspect.car;
      if (s.axis === 'x') {
        car.x = s.x - s.dir * 28; car.z = s.z; car.yaw = s.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.z = s.z - s.dir * 28; car.x = s.x; car.yaw = s.dir > 0 ? 0 : Math.PI;
      }
    } else {
      car.x = 0; car.z = 60; car.yaw = Math.PI;
    }
    car.syncMesh();
    game.player.x = car.x; game.player.z = car.z; game.player.yaw = car.yaw;
    game.player.syncMesh();
    game.camYaw = car.yaw;
    game.weather.setState('dusk');
    game.camDistOverride = 15;
    game.camPitch = 0.28;
    game.missions.say('Vigilante shift — follow the red marker and ram the suspect off the road.', 6);
    game.input.setVirtual({ forward: true });
    return 45;
  }

  if (name === 'shop') {
    // v7: inside the corner store — Riko on foot between the shelves,
    // the keeper behind the counter, the crate of shells by the wall,
    // and the green doorway behind him. The interior, not the street.
    // The room is only 13 units deep, so the camera stays close (5) —
    // a chase-cam distance would sit outside the south wall, looking
    // over it at the street instead of into the room.
    game.interiors.enter('shop', game);
    game.player.x = 900;
    game.player.z = 900;
    game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.camPitch = 0.35;
    game.camDistOverride = 5;
    game.missions.say('Inside the corner store — shelves, a counter, and the smell of coffee and gun oil.', 6);
    return 30;
  }

  if (name === 'heli') {
    // v8: the helicopter pursuit — Riko in a stolen sedan on the main
    // road at dusk, three stars, AIR-1 overhead with its searchlight
    // holding him, the lock meter climbing, a patrol car closing in
    // behind. The chopper is staged close and low, so the beam is on
    // the player and the lock builds through the settle.
    game.weather.setState('dusk');
    const car = game.traffic.cars.find((c) => c.parked);
    putPlayerInCar(game, car, 24);
    car.x = 0; car.z = 60; car.yaw = Math.PI;
    car.syncMesh();
    game.player.x = 0; game.player.z = 60; game.player.yaw = Math.PI;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.setWanted(3);
    game.traffic.spawnPolice(-8, 44);
    // Staged close and low, NOT fixed: the pursuit brain hovers the
    // chopper over Riko (a fixed chopper would be dragged 34 m ahead
    // by the traffic system's staged track, out of the beam's reach).
    const heli = game.traffic.spawnHeli(car.x + 12, car.z - 10);
    heli.y = 16;
    // Staged with full hit points so the pursuit brain does not treat
    // it as a fresh airframe and zero the staged lock below.
    heli.hp = 120; heli.maxHp = 120;
    heli.mesh.position.set(heli.x, heli.y, heli.z);
    heli.mesh.rotation.y = Math.atan2(car.x - heli.x, car.z - heli.z);
    game.heliPursuit.units[0].lock = 0.72;
    game.heliPursuit.units[0].lastKnown = { x: car.x, z: car.z };
    game.camDistOverride = 15;
    game.camPitch = 0.28;
    game.missions.index = 1;
    game.missions.stage = 2;
    game.missions.timer = 96;
    game.missions.say('Three stars — AIR-1 has the spotlight on you. Break the beam in a doorway, or shoot it down.', 6);
    // Parked: driving forward would outrun the staged hover and bleed
    // the lock before the shot's settle finishes.
    return 50;
  }

  if (name === 'boat') {
    // v8: boats on the water — Riko aboard the Speedboat off the
    // Marina at dusk, a smuggling crate aboard with a run already
    // ticking, the wake trailing behind the hull and the dock markers
    // in the frame. The boat runs east along the coast, so the sea
    // and the beach both read.
    game.weather.setState('dusk');
    const boat = game.boats.boats.find((b) => b.kind === 'speedboat');
    game.player.x = boat.x;
    game.player.z = boat.z;
    game.boats.boardBoat(game, boat);
    boat.speed = 18;
    game.camYaw = boat.yaw;
    game.camPitch = 0.28;
    game.camDistOverride = 16;
    game.missions.say('Aboard the Speedboat — crate in the hold, open water ahead. The docks pay for fast runs.', 6);
    game.input.setVirtual({ forward: true });
    return 50;
  }

  // Default: 'chase' — the cover. v5: a five-star chase — Riko fleeing
  // down the main road in a stolen coupe in the rain, two patrol cars on
  // his tail, a third holding a roadblock ahead, and TWO police
  // helicopters overhead, the package timer running.
  game.weather.setState('rain');
  const car = game.traffic.cars.find((c) => c.parked);
  putPlayerInCar(game, car, 24);
  game.setWanted(5);
  // Patrol cars close behind and offset to the sides, so the chase reads in frame.
  game.traffic.spawnPolice(car.x - 8, car.z + 5.5);
  game.traffic.spawnPolice(car.x - 12, car.z - 5.5);
  // A third unit ahead, holding the roadblock the brain picked for him.
  const blocker = game.traffic.spawnPolice(car.x + 55, car.z + 2);
  if (blocker.brain) blocker.brain.blackboard.tactic = 'ROADBLOCK';
  // Already rolling at speed, so they hold their distance instead of falling
  // behind the player's car during the settle.
  for (const cop of game.traffic.police) cop.speed = 28;
  // The helicopter, held in frame ahead of the car (fixed: it keeps its
  // staged height and tracks a point ahead of the player while the shot
  // settles). Low enough and flat enough a camera to read clearly.
  const heli = game.traffic.spawnHeli(car.x + 34, car.z - 12);
  heli.fixed = true;
  heli.y = 14;
  heli.mesh.position.set(heli.x, heli.y, heli.z);
  heli.mesh.rotation.y = Math.atan2(car.x - heli.x, car.z - heli.z);
  // The second chopper (v5): higher, on the far side, so both rotors read.
  const heli2 = game.traffic.spawnHeli2(car.x - 26, car.z + 22);
  heli2.fixed = true;
  heli2.y = 20;
  heli2.mesh.position.set(heli2.x, heli2.y, heli2.z);
  heli2.mesh.rotation.y = Math.atan2(car.x - heli2.x, car.z - heli2.z);
  game.camDistOverride = 14;
  game.camPitch = 0.3;
  game.missions.index = 1;
  game.missions.stage = 2;
  game.missions.timer = 96;
  game.missions.say('Package secured. 1:36 to Neon Palms — and the cops are watching.', 6);
  game.input.setVirtual({ forward: true });
  // A short settle: after ~2.3 s the patrol cars are a few metres behind the
  // player's car, in frame between the camera and the coupe.
  return 70;
}
