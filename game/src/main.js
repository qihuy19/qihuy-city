// Qihuy City — the game itself, v6. Boots the renderer, builds the city,
// wires every system together and runs the loop: title screen, free roam,
// missions, wanted level, busted and wasted. Played with keyboard and
// mouse, saved to localStorage, and shot-ready: ?shot=chase|street|mission|
// start stages a deterministic pose and freezes it for a screenshot.
//
// v3 wires in the new systems: a weather cycle (clear / rain / fog / storm)
// that changes road grip and light, headlights for night driving (L), car
// damage with garage repair (G), and the three vehicle jobs — taxi shift,
// ambulance run and port delivery — each with its own special vehicle.
//
// v4: the police brain (behaviour tree + utility AI per patrol unit, with a
// live roster and a search zone on the minimap), a deeper pink-orange
// sunset with ACES tone mapping and pulsing neon, three more districts
// (Old Town, the marina, Market Row) and three more story missions (14 in
// all), visual-novel briefings before each story job, and the game-feel
// layer — hit-stop on landed hits, trauma camera shake, a chase camera
// whose distance cycles with C, and a fourth radio station.
//
// v5: the airport district and missions 15–17, the motorbike, the shotgun
// heist, five-star escalation (second helicopter + coordinated roadblocks),
// weather gameplay (rain wetness, fog-blinded police), the buyable
// safehouse garage (up to 3 stored cars, save format v4), the pause-menu
// stats screen (P), and a debug boot — ?start=airport drops Riko at the
// terminal with the game already running.
//
// v6 rewrites the core loop around an explicit STATE MACHINE (title /
// play / paused / shop / busted / wasted / complete, with one setMode()
// that owns every screen, HUD and autosave transition), a DAY/NIGHT
// DRIVER that moves the sun and moon along real arcs, blends the sky
// gradient between four keyframes and drives the street lamps, and a
// CITY ANIMATION layer: the traffic lights cycle on a shared timer, the
// ferris wheel turns, the lighthouse beam sweeps the water, the tower
// beacon blinks, and the ferry bobs at its mooring. New gameplay: drift
// points bank into cash at the next full stop, spike strips shred tyres
// until repaired, the helicopter spotlight pauses wanted decay at night,
// and three repeatable side jobs (courier, wheelman, lookout) keep the
// city paying after the twenty-story-mission arc ends. The ninth district
// (Ferry Point) joins the map, and the debug boot gains ?start=ferry.
import * as THREE from 'three';
import { CITY, MISSIONS, PLACES, TUNE, PALETTE, DISTRICTS } from './config.js';
import { buildCity } from './city.js';
import { Traffic } from './vehicles.js';
import { People } from './people.js';
import { Player } from './player.js';
import { MissionManager } from './missions.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { Effects } from './fx.js';
import { Weather, makeHeadlight } from './weather.js';
import { saveGame, loadGame, hasSave, clearSave, defaultStats, defaultGarage } from './save.js';
import { stageShot } from './shots.js';
import { makeRng, clamp, dist2, angleDelta, lerp } from './util.js';
// v7: the economy and shops, the enterable interiors, the AI traffic
// director, the branching story arcs and the extra game modes.
import { Economy } from './economy.js';
import { Shops } from './shops.js';
import { Interiors } from './interiors.js';
import { TrafficDirector } from './traffic.js';
import { StoryArcs } from './story.js';
import { GameModes } from './modes.js';
// v8: the police helicopter pursuit brain, and the boats + water
// gameplay (docks, smuggling runs, fuel, sinking).
import { HeliPursuit } from './heli.js';
import { Boats } from './boats.js';

const SEED = 20261118;

/** The game's modes. Every transition goes through setMode(), so a screen,
 * the HUD visibility and the autosave can never disagree about the mode. */
export const GAME_MODES = ['title', 'play', 'paused', 'shop', 'busted', 'wasted', 'complete'];

const MODE_SCREENS = {
  title: 'title-screen',
  paused: 'pause-screen',
  shop: 'shop-screen',
  busted: 'busted-screen',
  wasted: 'wasted-screen',
  complete: 'complete-screen',
  play: null,
};

/** Day/night keyframes: the sky gradient, fog colour and light level at
 * four points of the cycle, blended smoothly as the sun travels. */
const SKY_KEYS = [
  { t: 0.0, top: 0x6a2f8f, mid: 0xd95f9e, horizon: 0xff9a5a, fog: 0xf7b98a, sun: 2.4 },
  { t: 0.25, top: 0x2a2a55, mid: 0x4a3a7a, horizon: 0x8a5a8a, fog: 0x6a5a7a, sun: 1.2 },
  { t: 0.5, top: 0x050914, mid: 0x101a3a, horizon: 0x2a2a4a, fog: 0x0a0e24, sun: 0.35 },
  { t: 0.75, top: 0x3a2a6a, mid: 0x7a4a8a, horizon: 0xff8a6a, fog: 0xc97a8a, sun: 1.4 },
];

/** Blend two hex colours by t (0..1). */
function blendHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/** The day/night driver: owns the cycle position, the sun/moon arcs and
 * the sky keyframe blending. The game asks it for dayness, nightness and
 * the sun elevation each frame; it never touches the HUD. */
export class DayNightCycle {
  constructor() {
    this.t = 0; // 0 = sunset, 0.5 = deep night, 1 = sunset again
    this.dayLengthSeconds = 240; // 4 minutes per full day
  }

  get dayness() {
    return 0.5 + 0.5 * Math.cos(this.t * Math.PI * 2);
  }

  get nightness() {
    return 1 - this.dayness;
  }

  get isNight() {
    return this.nightness > 0.6;
  }

  /** The game clock: the 4-minute cycle is one full day, starting at 18:00. */
  get clockMinutes() {
    return Math.floor(18 * 60 + this.t * 24 * 60) % (24 * 60);
  }

  get day() {
    return 1;
  }

  advance(dt) {
    this.t = (this.t + dt / this.dayLengthSeconds) % 1;
  }

  jumpHalfDay() {
    this.t = (this.t + 0.5) % 1;
  }

  /** The keyframe blend for the current cycle position. */
  keyframe() {
    const t = this.t;
    let i = SKY_KEYS.length - 1;
    for (let k = 0; k < SKY_KEYS.length; k += 1) {
      if (SKY_KEYS[k].t <= t) i = k;
    }
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[(i + 1) % SKY_KEYS.length];
    const span = (b.t - a.t + 1) % 1 || 1;
    const f = ((t - a.t + 1) % 1) / span;
    return {
      top: blendHex(a.top, b.top, f),
      mid: blendHex(a.mid, b.mid, f),
      horizon: blendHex(a.horizon, b.horizon, f),
      fog: blendHex(a.fog, b.fog, f),
      sun: lerp(a.sun, b.sun, f),
    };
  }

  /** The sun's position on its arc: east at dawn, west at sunset, below
   * the horizon at night. Returns a unit-ish direction. */
  sunDirection() {
    const a = this.t * Math.PI * 2;
    return {
      x: -Math.cos(a),
      y: Math.sin(a) * 0.8 + 0.15,
      z: -0.4,
    };
  }
}

export class Game {
  constructor() {
    this.time = 0;
    this.money = 0;
    this.wanted = 0;
    this.wantedTimer = 0;
    this.mode = 'title';
    this.seed = SEED;
    this.rng = makeRng(SEED);
    this.lastDamageAt = -99;
    this.prevHealth = TUNE.playerMaxHealth;
    this.completedShown = false;
    this.prevFlash = 0;
    this.headlights = false;
    this.stats = {
      fares: 0, crashes: 0, repairs: 0, missionsDone: 0,
      carsStolen: 0, bestWanted: 0, playTime: 0,
    };
    // v5: the safehouse garage — buy it once at the safehouse, then park
    // up to three stolen cars in it. Saved in the v4 save format.
    this.garage = defaultGarage();
    // v6: drift cash banked this run, and the traffic-light cycle clock.
    this.driftEarned = 0;
    this.trafficLightTimer = 0;
    this.trafficLightPhase = 0; // 0 green NS / red EW, 1 amber, 2 green EW, 3 amber

    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // v4: ACES filmic tone mapping, so the pink-orange sunset grades like
    // a photograph instead of clipping to flat yellow.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene = new THREE.Scene();
    // A painted sunset gradient for the sky — v4 goes deeper: magenta dusk
    // overhead, hot pink mid-sky, orange at the horizon — and a low sun
    // disc to the west with a soft glow sprite around it.
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 512;
    const skyCtx = skyCanvas.getContext('2d');
    const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 512);
    skyGrad.addColorStop(0, '#6a2f8f');
    skyGrad.addColorStop(0.34, '#b84a8e');
    skyGrad.addColorStop(0.52, '#e85f8e');
    skyGrad.addColorStop(0.68, '#ff8a6a');
    skyGrad.addColorStop(0.82, '#ffb36b');
    skyGrad.addColorStop(1, '#ffcf8a');
    skyCtx.fillStyle = skyGrad;
    skyCtx.fillRect(0, 0, 4, 512);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.daySkyTex = skyTex;
    // A night sky: deep blue with a few painted stars. The canvas is wide
    // on purpose: a 4 px-wide texture stretches every 1 px star into a
    // horizontal streak across the screen.
    const nightCanvas = document.createElement('canvas');
    nightCanvas.width = 512;
    nightCanvas.height = 512;
    const nctx = nightCanvas.getContext('2d');
    const nightGrad = nctx.createLinearGradient(0, 0, 0, 512);
    nightGrad.addColorStop(0, '#050914');
    nightGrad.addColorStop(0.6, '#101a3a');
    nightGrad.addColorStop(1, '#2a2a4a');
    nctx.fillStyle = nightGrad;
    nctx.fillRect(0, 0, 512, 512);
    nctx.fillStyle = '#ffffff';
    const starRng = makeRng(7);
    for (let i = 0; i < 90; i += 1) {
      nctx.globalAlpha = starRng.range(0.3, 1);
      nctx.fillRect(starRng.range(0, 512), starRng.range(0, 300), 2, 2);
    }
    nctx.globalAlpha = 1;
    const nightTex = new THREE.CanvasTexture(nightCanvas);
    nightTex.colorSpace = THREE.SRGBColorSpace;
    this.nightSkyTex = nightTex;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog(PALETTE.fog, 180, 520);
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(30, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }),
    );
    sunDisc.position.set(-320, 130, -420);
    sunDisc.lookAt(0, 20, 0);
    this.scene.add(sunDisc);
    this.sunDisc = sunDisc;
    // A soft glow halo around the sun: a radial-gradient sprite, additive,
    // so the sunset reads as light in the air, not a flat disc.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const glowGrad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    glowGrad.addColorStop(0, 'rgba(255, 220, 160, 0.85)');
    glowGrad.addColorStop(0.35, 'rgba(255, 150, 110, 0.35)');
    glowGrad.addColorStop(1, 'rgba(255, 120, 90, 0)');
    gctx.fillStyle = glowGrad;
    gctx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, fog: false,
    }));
    sunGlow.scale.set(340, 340, 1);
    sunGlow.position.copy(sunDisc.position);
    this.scene.add(sunGlow);
    this.sunGlow = sunGlow;
    // A pale moon for the night half of the cycle.
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(18, 32),
      new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false }),
    );
    moonDisc.position.set(280, 180, -380);
    moonDisc.lookAt(0, 20, 0);
    moonDisc.visible = false;
    this.scene.add(moonDisc);
    this.moonDisc = moonDisc;
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

    // Sunset: a low warm sun and a soft sky fill.
    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.4);
    sun.position.set(-140, 120, -80);
    this.scene.add(sun);
    this.sunLight = sun;
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a6a4a, 0.9);
    this.scene.add(hemi);
    this.hemiLight = hemi;

    // Day/night cycle (v6): the driver owns the cycle position; the game
    // reads dayness/nightness/isNight from it, and cycleT stays the
    // plain number the HUD and the shots read.
    this.dayNight = new DayNightCycle();
    this.cycleT = 0;
    this.nightness = 0;
    this.isNight = false;
    if (new URLSearchParams(window.location.search).get('night') === '1') {
      this.dayNight.t = 0.5;
      this.cycleT = 0.5;
    }

    const built = buildCity(this.scene, SEED);
    this.colliders = built.colliders;
    this.neonSigns = built.neonSigns || [];
    // v6 animated landmarks from the city builder.
    this.trafficLights = built.trafficLights || [];
    this.ferrisWheel = built.ferrisWheel || null;
    this.lighthouse = built.lighthouse || null;
    this.ferry = built.ferry || null;
    this.towerBeacon = built.towerBeacon || null;
    this.districts = built.districts || DISTRICTS;
    this.districtsVisited = new Set();
    this.rosterVisible = true;
    this.camDistIndex = 1; // TUNE.camDistances: close / medium / far
    this.lastTraceCount = 0; // police-brain trace lines already heard
    this.weather = new Weather(this.scene, makeRng(SEED + 5));
    this.traffic = new Traffic(this.scene, this.colliders, makeRng(SEED + 1));
    this.traffic.spawnTraffic(20);
    this.traffic.spawnParked([
      { x: 24, z: 3.5, yaw: Math.PI / 2 },
      { x: -40, z: -3.5, yaw: -Math.PI / 2 },
      { x: 65.5, z: 93, yaw: 0 },
      { x: -65.5, z: -93, yaw: Math.PI },
      { x: 155, z: 58.5, yaw: Math.PI / 2 },
      { x: -155, z: -58.5, yaw: -Math.PI / 2 },
      { x: 93, z: 155, yaw: Math.PI },
      { x: PLACES.beachCar.x, z: PLACES.beachCar.z, yaw: Math.PI / 2 },
    ]);
    // v5: parked motorbikes — one by the airport terminal, one at Sunset
    // Plaza, one on the boardwalk. Stealable like any parked car.
    this.traffic.spawnBikes([
      { x: PLACES.terminal.x, z: PLACES.terminal.z + 8, yaw: Math.PI / 2 },
      { x: -31, z: -40, yaw: 0 },
      { x: -62, z: 296, yaw: Math.PI },
    ]);
    this.people = new People(this.scene, this.colliders, built.wanderPoints, makeRng(SEED + 2));
    this.people.spawnPeds(36);
    this.people.spawnWorkers(8);
    this.people.spawnMedics(3);
    this.people.spawnFares(4);
    this.people.spawnVendors(6);
    // v5: airport travelers and ground crew walk the terminal apron.
    this.people.spawnTravelers(8);
    // v6: joggers on the boardwalk, buskers by the fountain, cyclists on
    // the road grid — the new street life.
    this.people.spawnJoggers(6);
    this.people.spawnBuskers(3);
    this.people.spawnCyclists(5);
    this.player = new Player(this.scene, PLACES.spawn.x, PLACES.spawn.z);
    this.missions = new MissionManager(this.scene);
    this.missions.spawnStashes();
    // v7 systems: the economy (wallet ledger + upgrades), the shops
    // (corner store + parts shop screens), the interiors (walk-in rooms),
    // the traffic director (density + events + jaywalkers), the branching
    // story arcs (Mara vs Dara, from mission 21) and the extra modes
    // (vigilante + taxi career, from the title screen).
    this.economy = new Economy(this);
    this.shops = new Shops(this);
    this.interiors = new Interiors(this.scene, this);
    this.trafficDirector = new TrafficDirector(this.scene, this);
    this.story = new StoryArcs(this);
    this.modes = new GameModes(this);
    // v8: the helicopter pursuit brain (the eye in the sky, with a
    // searchlight lock Riko can break or shoot down) and the boats
    // (docks, water physics, smuggling runs, fuel, sinking).
    this.heliPursuit = new HeliPursuit(this);
    this.boats = new Boats(this.scene, this);
    // Shop + safehouse: fixed spots with a marker and a minimap position.
    this.shopPos = PLACES.shop;
    this.safePos = PLACES.safehouse;
    this.insideSafehouse = false;
    this.buildLandmark(PLACES.shop.x, PLACES.shop.z, 0x2a7a3a, '$');
    this.buildLandmark(PLACES.safehouse.x, PLACES.safehouse.z, 0x2a6a8a, 'H');
    this.buildLandmark(PLACES.taxiStand.x, PLACES.taxiStand.z, 0xf2c230, 'T');
    this.buildLandmark(PLACES.port.x, PLACES.port.z, 0xc65a3a, 'P');
    // v6: a ferry marker at Ferry Point, so the new district reads on the map.
    this.buildLandmark(PLACES.ferry.x, PLACES.ferry.z, 0x2b6cb0, 'F');
    // v7: a parts-shop marker on the port road, next to Mara's garage.
    this.buildLandmark(PLACES.parts.x, PLACES.parts.z, 0xff8c42, 'W');
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.fx = new Effects(this.scene);
    const { light, target } = makeHeadlight();
    this.headlight = light;
    this.headlightTarget = target;
    this.scene.add(light);
    this.scene.add(target);
    this.headlight.intensity = 0;

    this.camYaw = Math.PI;
    this.camPitch = 0.32;
    this.camDist = 11;
    this.camDistOverride = null;
    this.lastDragAt = -99;

    window.addEventListener('resize', () => this.onResize());
    this.bindScreens();
    this.hud.show(false);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** The one mode transition: sets the mode, shows the right screen, and
   * autosaves on the modes that leave play. Every caller goes through
   * here, so the mode, the screen and the save can never disagree. */
  setMode(mode) {
    if (!GAME_MODES.includes(mode)) return;
    const leavingPlay = this.mode === 'play' && mode !== 'play';
    this.mode = mode;
    this.showScreen(MODE_SCREENS[mode]);
    this.hud.show(mode === 'play');
    if (leavingPlay && (mode === 'paused' || mode === 'title')) saveGame(this);
    if (mode === 'play') this.audio.ensure();
  }

  // ----- screens ------------------------------------------------------------
  bindScreens() {
    const $ = (id) => document.getElementById(id);
    const startNew = () => {
      this.audio.ensure();
      clearSave();
      this.resetWorld();
      this.setMode('play');
      this.missions.start();
      this.spawnJobVehicle();
      this.missions.say('Mara: Riko, you\'re back. Steal a car and bring it to my garage.', 6);
    };
    const continueGame = () => {
      this.audio.ensure();
      const data = loadGame();
      this.resetWorld();
      if (data) this.applySave(data);
      this.setMode('play');
      this.spawnJobVehicle();
      if (this.missions.index < 0) {
        this.missions.say('Welcome back, Riko. Qihuy City is yours — free roam.', 5);
      } else {
        this.missions.say(`Welcome back, Riko. ${this.missions.current.title}`, 5);
      }
    };
    $('btn-start').addEventListener('click', startNew);
    $('btn-continue').addEventListener('click', continueGame);
    $('btn-resume').addEventListener('click', () => this.setMode('play'));
    $('btn-restart-mission').addEventListener('click', () => {
      this.missions.stage = 0;
      this.missions.timer = 0;
      this.missions.packageTaken = false;
      this.missions.secondPickupDone = false;
      this.missions.briefing = null;
      this.missions.fare = null;
      this.missions.scriptStep = 0;
      this.missions.checkpoints = [];
      this.missions.patientHealth = TUNE.ambulancePatientHealth;
      this.setWanted(0);
      this.player.x = PLACES.spawn.x;
      this.player.z = PLACES.spawn.z;
      if (this.player.car) this.player.exitCar();
      this.setMode('play');
      this.spawnJobVehicle();
      this.missions.say('Mission restarted.', 3);
    });
    $('btn-quit-title').addEventListener('click', () => {
      saveGame(this);
      this.setMode('title');
      this.refreshTitle();
    });
    $('btn-busted-ok').addEventListener('click', () => this.respawn('busted'));
    $('btn-wasted-ok').addEventListener('click', () => this.respawn('wasted'));
    $('btn-complete-ok').addEventListener('click', () => this.setMode('play'));
    $('btn-mute').addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      $('btn-mute').textContent = this.audio.muted ? '🔇 Sound: Off' : '🔊 Sound: On';
    });
    // Visual-novel briefing: one click advances one line of dialogue.
    $('btn-briefing-next').addEventListener('click', () => {
      this.audio.blip(880, 0.06, 0.12);
      this.missions.advanceBriefing();
    });
    $('btn-shop-close').addEventListener('click', () => this.closeShop());
    $('buy-health').addEventListener('click', () => this.buy('health'));
    $('buy-shotgun').addEventListener('click', () => this.buy('shotgun'));
    $('buy-smg').addEventListener('click', () => this.buy('smg'));
    $('buy-shotgun-ammo').addEventListener('click', () => this.buy('shotgun-ammo'));
    $('buy-smg-ammo').addEventListener('click', () => this.buy('smg-ammo'));
    $('buy-repair').addEventListener('click', () => this.buy('repair'));
    // v7: the parts-shop buttons live in the Shops class, and the title
    // screen gains the two extra modes — a vigilante shift and a taxi
    // career shift, each starting from a fresh world with the story set aside.
    this.shops.bind();
    const modeVigilante = $('btn-mode-vigilante');
    if (modeVigilante) modeVigilante.addEventListener('click', () => this.startMode('vigilante'));
    const modeTaxi = $('btn-mode-taxi');
    if (modeTaxi) modeTaxi.addEventListener('click', () => this.startMode('taxi'));
    // v6 side jobs: the pause menu offers the three repeatable jobs once
    // the story is done — one click starts the courier run from the docks.
    const sideBtn = $('btn-side-courier');
    if (sideBtn) sideBtn.addEventListener('click', () => this.startSideJobFromMenu('courier'));
    const sideBtn2 = $('btn-side-wheelman');
    if (sideBtn2) sideBtn2.addEventListener('click', () => this.startSideJobFromMenu('wheelman'));
    const sideBtn3 = $('btn-side-lookout');
    if (sideBtn3) sideBtn3.addEventListener('click', () => this.startSideJobFromMenu('lookout'));
    this.refreshTitle();
  }

  /** Start a side job from the pause menu (v6): only once the story is
   * done, and only from the pause screen — the world resumes in play. */
  startSideJobFromMenu(id) {
    if (!this.missions.done) {
      this.missions.say('Finish the story first — Mara\'s side jobs come after.', 4);
      return;
    }
    if (this.missions.startSideJob(id)) {
      this.setMode('play');
    }
  }

  /** Start an extra mode from the title screen (v7): a fresh world,
   * the story set aside (missions done, free roam), and the mode's own
   * shift running. Finishing the shift drops Riko back into free roam.
   * The meta-progression — upgrades, garage slots, the story side and
   * standing, the shops' visits, the modes' best scores, the casino
   * ledger — survives the mode: a shift is a detour, not a new game,
   * so pausing mid-shift must not autosave over it. */
  startMode(id) {
    this.audio.ensure();
    const meta = {
      economy: this.economy.serialize(),
      story: this.story.serialize(),
      shops: this.shops.serialize(),
      modes: this.modes.serialize(),
      interiors: this.interiors.serialize(),
      heli: this.heliPursuit.serialize(),
      boats: this.boats.serialize(),
    };
    this.resetWorld();
    this.economy.restore(meta.economy);
    this.story.restore(meta.story);
    this.shops.restore(meta.shops);
    this.modes.restore(meta.modes);
    this.interiors.restore(meta.interiors);
    this.heliPursuit.restore(meta.heli);
    this.boats.restore(meta.boats);
    this.missions.index = -1;
    this.missions.done = true;
    // The story is set aside, not finished: never show the STORY
    // COMPLETE screen for a mode — a shift is a detour, and the
    // complete screen would swallow the mode on its first frame.
    this.completedShown = true;
    this.setMode('play');
    this.modes.start(id);
  }

  refreshTitle() {
    const cont = document.getElementById('btn-continue');
    cont.style.display = hasSave() ? 'inline-block' : 'none';
  }

  showScreen(id) {
    for (const name of ['title-screen', 'pause-screen', 'busted-screen', 'wasted-screen', 'complete-screen', 'shop-screen']) {
      document.getElementById(name).style.display = name === id ? 'flex' : 'none';
    }
  }

  /** Spawn (or remove) the current mission's special vehicle. */
  spawnJobVehicle() {
    const spec = this.missions.jobSpec();
    if (!spec) {
      this.traffic.removeJobVehicle();
      return null;
    }
    const place = PLACES[spec.place];
    return this.traffic.spawnJobVehicle(spec.kind, place.x, place.z, Math.PI / 2);
  }

  resetWorld() {
    this.money = 0;
    this.time = 0;
    this.setWanted(0);
    this.player.health = TUNE.playerMaxHealth;
    this.player.stamina = TUNE.staminaMax;
    this.player.exhausted = false;
    this.player.wasted = false;
    this.player.busted = false;
    if (this.player.car) this.player.exitCar();
    this.player.boat = null;
    // v8: a fresh start is on foot — without this, a reset while aboard
    // a boat left onFoot false with no boat, and E could neither board
    // nor exit (the boat-buy test caught it).
    this.player.onFoot = true;
    this.player.x = PLACES.spawn.x;
    this.player.z = PLACES.spawn.z;
    this.player.yaw = Math.PI;
    this.player.syncMesh();
    this.missions.index = 0;
    this.missions.stage = 0;
    this.missions.timer = 0;
    this.missions.done = false;
    this.missions.packageTaken = false;
    this.missions.stashesCollected = 0;
    this.missions.fare = null;
    this.missions.faresDone = 0;
    this.missions.fareIndex = 0;
    this.missions.secondPickupDone = false;
    this.missions.briefing = null;
    this.missions.briefingsSeen = [];
    this.missions.script = [];
    this.missions.scriptStep = 0;
    this.missions.checkpoints = [];
    this.missions.log = [];
    this.missions.sideJob = null;
    this.missions.sideJobsDone = 0;
    this.districtsVisited = new Set();
    this.lastTraceCount = 0;
    this.camDistIndex = 1;
    this.rosterVisible = true;
    this.missions.patientHealth = TUNE.ambulancePatientHealth;
    for (const stash of this.missions.stashes) {
      if (stash.taken) {
        stash.taken = false;
        this.scene.add(stash.mesh);
      }
    }
    this.completedShown = false;
    this.people.removeGang();
    this.people.removeCops();
    this.traffic.removePolice();
    this.traffic.removeHeli();
    this.traffic.removeHeli2();
    this.traffic.removeJobVehicle();
    // v7: a fresh game resets the new systems too — the economy back to
    // stock, the story unchosen, the modes idle, the director quiet and
    // Riko back on the street (never inside a room on a fresh start).
    this.economy.reset();
    this.story.reset();
    this.modes.reset();
    this.trafficDirector.reset();
    this.interiors.reset();
    this.shops.reset();
    // v8: a fresh game resets the sky and the sea too — no lock, no
    // run, the fleet back at its starting moorings.
    this.heliPursuit.reset();
    this.boats.reset();
    this.weather.setState('clear');
    this.headlights = false;
    this.headlight.intensity = 0;
    this.stats = defaultStats();
    this.garage = defaultGarage();
    this.player.carsStolen = 0;
    this.driftEarned = 0;
    // Fresh start: fists and pistol only, no bought guns.
    this.player.weapon = 'pistol';
    this.player.owned = { pistol: true, shotgun: false, smg: false };
    this.player.ammo = { pistol: Infinity, shotgun: 0, smg: 0 };
  }

  applySave(data) {
    this.money = data.money || 0;
    this.missions.index = data.missionIndex ?? 0;
    this.missions.stage = 0;
    this.missions.timer = 0;
    this.missions.done = this.missions.index < 0 || this.missions.index >= MISSIONS.length;
    if (this.missions.done) this.missions.index = -1;
    if (data.weapons) {
      this.player.weapon = data.weapons.weapon || 'pistol';
      this.player.owned = { pistol: true, shotgun: !!data.weapons.owned?.shotgun, smg: !!data.weapons.owned?.smg };
      this.player.ammo.shotgun = data.weapons.ammo?.shotgun || 0;
      this.player.ammo.smg = data.weapons.ammo?.smg || 0;
    }
    this.missions.stashesCollected = data.stashesCollected || 0;
    (data.stashesTaken || []).forEach((taken, i) => {
      const stash = this.missions.stashes[i];
      if (taken && stash && !stash.taken) {
        stash.taken = true;
        this.scene.remove(stash.mesh);
      }
    });
    if (data.stats) this.stats = { ...defaultStats(), ...data.stats };
    if (data.stats && data.stats.carsStolen) this.player.carsStolen = data.stats.carsStolen;
    // v5: the safehouse garage round-trips through the v4 save — owned
    // flag plus up to three stored cars, restored as parked cars.
    if (data.garage) {
      this.garage = { owned: !!data.garage.owned, cars: [...(data.garage.cars || [])] };
    }
    if (data.weather) this.weather.setState(data.weather);
    if (data.districtsVisited) this.districtsVisited = new Set(data.districtsVisited);
    if (data.briefingsSeen) this.missions.briefingsSeen = [...data.briefingsSeen];
    // v6: the mission log and side-job count round-trip when the save has them.
    if (data.missionLog) this.missions.log = [...data.missionLog];
    if (data.sideJobsDone) this.missions.sideJobsDone = data.sideJobsDone;
    if (data.driftEarned) this.driftEarned = data.driftEarned;
    // v6: the day/night clock round-trips too — Continue resumes at the
    // same hour the save was written, not always at dusk.
    if (data.clock && typeof data.clock.dayNightT === 'number') {
      this.dayNight.t = ((data.clock.dayNightT % 1) + 1) % 1;
    }
    // v7: the economy (upgrades, garage slots, ledger), the story side
    // and standing, the shops' visit counts and the modes' best scores
    // round-trip with the save — a Continue resumes the arc Riko picked.
    if (data.economy) this.economy.restore(data.economy);
    if (data.story) this.story.restore(data.story);
    if (data.shops) this.shops.restore(data.shops);
    if (data.modes) this.modes.restore(data.modes);
    if (data.interiors) this.interiors.restore(data.interiors);
    // v8: the helicopter pursuit stats and the boats' fleet round-trip
    // with the save — a Continue keeps his bounties and his boats.
    if (data.heli) this.heliPursuit.restore(data.heli);
    if (data.boats) this.boats.restore(data.boats);
    this.player.x = data.player?.x ?? PLACES.spawn.x;
    this.player.z = data.player?.z ?? PLACES.spawn.z;
    this.player.health = data.player?.health ?? TUNE.playerMaxHealth;
    this.player.syncMesh();
    this.time = data.time || 0;
  }

  respawn(kind) {
    const fine = kind === 'busted' ? TUNE.stealFine : TUNE.wastedFine;
    this.money = Math.max(0, this.money - fine);
    this.setWanted(0);
    this.player.health = TUNE.playerMaxHealth;
    this.player.wasted = false;
    this.player.busted = false;
    if (this.player.car) this.player.exitCar();
    // v8: a respawn never leaves Riko aboard a boat mid-sea — off the
    // hull, on foot, visible again, the boat left where it was.
    if (this.player.boat) {
      this.player.boat = null;
      this.boats.playerBoat = null;
      this.player.onFoot = true;
      this.player.mesh.visible = true;
    }
    this.player.x = PLACES.hospital.x;
    this.player.z = PLACES.hospital.z;
    this.player.syncMesh();
    this.setMode('play');
    this.missions.say(kind === 'busted'
      ? `Busted. The cops took $${fine} and dropped you at City Hospital.`
      : `Wasted. The medics patched you up — minus $${fine}.`, 5);
    saveGame(this);
  }

  // ----- wanted level ---------------------------------------------------------
  setWanted(n) {
    this.wanted = clamp(Math.round(n), 0, 5);
    this.wantedTimer = 0;
    const m = this.missions.current;
    const medicRun = m && m.kind === 'ambulance' && this.missions.stage === 2;
    this.audio.siren(this.wanted > 0, medicRun ? 'medic' : 'police');
  }

  crime(stars, message) {
    // Sirens on during the ambulance run: the city gives the ambulance a
    // pass, so no new stars while the patient is aboard.
    const m = this.missions.current;
    if (m && m.kind === 'ambulance' && this.missions.stage === 2) {
      if (message) this.missions.say(message, 4);
      return;
    }
    if (this.wanted < 5) this.setWanted(this.wanted + stars);
    if (message) this.missions.say(message, 4);
  }

  spawnGangCrew(placeKey) {
    const base = PLACES[placeKey] || PLACES.warehouse;
    this.people.spawnGang(base.x + 8, base.z + 6);
    this.people.spawnGang(base.x - 8, base.z + 10);
    this.people.spawnGang(base.x + 2, base.z - 12);
  }

  /** A small glowing marker post for the shop / safehouse / taxi stand / port. */
  buildLandmark(x, z, color, label) {
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 6, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2c313a }),
    );
    post.position.y = 3;
    group.add(post);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 2.0, 0.3),
      new THREE.MeshBasicMaterial({ color }),
    );
    sign.position.y = 6.4;
    group.add(sign);
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 0.2, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }),
    );
    glow.position.y = 0.12;
    group.add(glow);
    group.position.set(x, 0, z);
    this.scene.add(group);
    return group;
  }

  // ----- shop + safehouse -----------------------------------------------------
  /** Open the shop screen for a storefront: 'corner' for the plaza
   * shop's weapons wall, 'parts' for the parts shop's upgrades wall.
   * The Shops class decides what the screen shows once it is open. */
  openShop(kind) {
    this.setMode('shop');
    this.shops.open(kind || 'corner');
  }

  closeShop() {
    this.shops.close();
    this.setMode('play');
  }

  refreshShop() {
    this.shops.refresh();
  }

  buy(kind) {
    const p = this.player;
    // v7: every purchase writes a ledger line through the economy, so
    // the shop's ledger panel can show what the money went on.
    const pay = (price, label) => {
      if (this.money < price) { this.missions.say('Not enough cash.', 3); return false; }
      this.money -= price;
      this.economy.record('sale', -price, label || 'Purchase');
      return true;
    };
    if (kind === 'health' && pay(TUNE.healthPrice, 'Full heal')) {
      p.heal(TUNE.playerMaxHealth);
      this.missions.say('Patched up — full health.', 3);
    } else if (kind === 'shotgun' && !p.owned.shotgun && pay(TUNE.shotgunPrice, 'Shotgun')) {
      p.owned.shotgun = true;
      p.ammo.shotgun += 12;
      this.missions.say('Shotgun bought — 12 shells included. Press 3 to draw it.', 4);
    } else if (kind === 'smg' && !p.owned.smg && pay(TUNE.smgPrice, 'SMG')) {
      p.owned.smg = true;
      p.ammo.smg += 60;
      this.missions.say('SMG bought — 60 rounds included. Press 4 to draw it.', 4);
    } else if (kind === 'shotgun-ammo' && p.owned.shotgun && pay(TUNE.shotgunAmmoPrice, '12 shotgun shells')) {
      p.ammo.shotgun += 12;
      this.missions.say('Bought 12 shotgun shells.', 3);
    } else if (kind === 'smg-ammo' && p.owned.smg && pay(TUNE.smgAmmoPrice, '60 SMG rounds')) {
      p.ammo.smg += 60;
      this.missions.say('Bought 60 SMG rounds.', 3);
    } else if (kind === 'repair' && p.car && p.car.damage > 0 && pay(TUNE.repairPrice, 'Car repair')) {
      p.repairCar();
      this.stats.repairs += 1;
      this.missions.say('Car repaired — good as new.', 3);
    }
    this.audio.chime();
    this.refreshShop();
  }

  /** The safehouse garage (v5): E near the safehouse buys it once, then
   * parks the stolen car Riko is driving (up to three — or five, once
   * the parts shop's extra slots are bought, v7), or — on foot with
   * cars parked — takes the most recent one back out. */
  handleGarage() {
    const p = this.player;
    const g = this.garage;
    const capacity = this.economy.garageCapacity();
    if (!g.owned) {
      if (this.money < TUNE.garagePrice) {
        this.missions.say(`The safehouse garage costs $${TUNE.garagePrice} — you're $${TUNE.garagePrice - Math.floor(this.money)} short.`, 4);
        return true;
      }
      this.money -= TUNE.garagePrice;
      g.owned = true;
      this.audio.purchase();
      this.missions.say(`Garage bought — park up to ${capacity} stolen cars here. Drive one in and press E.`, 5);
      saveGame(this);
      return true;
    }
    if (!p.onFoot && p.car) {
      if (g.cars.length >= capacity) {
        this.missions.say(`The garage is full — ${capacity} cars already parked.`, 4);
        return true;
      }
      if (!p.car.stolen) {
        this.missions.say('Only stolen cars go in the garage.', 3);
        return true;
      }
      const car = p.car;
      const color = car.mesh.userData.bodyColor ?? 0x888888;
      p.exitCar();
      this.traffic.cars = this.traffic.cars.filter((c) => c !== car);
      this.scene.remove(car.mesh);
      g.cars.push({ name: car.name, bodyKind: car.bodyKind, color, damage: car.damage });
      this.audio.purchase();
      this.missions.say(`Parked the ${car.name} in the garage (${g.cars.length}/${capacity}).`, 4);
      saveGame(this);
      return true;
    }
    if (p.onFoot && g.cars.length > 0) {
      const stored = g.cars.pop();
      const spot = { x: PLACES.safehouse.x + 8, z: PLACES.safehouse.z + 6 };
      this.traffic.spawnStoredCar(stored, spot.x, spot.z, Math.PI / 2);
      this.missions.say(`Took the ${stored.name} out of the garage (${g.cars.length}/${capacity} left).`, 4);
      saveGame(this);
      return true;
    }
    this.missions.say('Garage is empty — bring a stolen car here and press E to park it.', 3);
    return true;
  }

  /** Repair at Mara's garage (G): drive in damaged, pay, drive out fixed. */
  tryGarageRepair() {
    const p = this.player;
    if (p.onFoot || !p.car) return false;
    if (dist2(p.x, p.z, PLACES.garage.x, PLACES.garage.z) >= 144) return false;
    if (p.car.damage <= 0) {
      this.missions.say('The car is already in one piece.', 2);
      return true;
    }
    if (this.money < TUNE.repairPrice) {
      this.missions.say(`Repair costs $${TUNE.repairPrice} — you're short.`, 3);
      return true;
    }
    this.money -= TUNE.repairPrice;
    p.repairCar();
    this.stats.repairs += 1;
    this.audio.chime();
    this.missions.say(`Garage fixed the car — $${TUNE.repairPrice}.`, 3);
    return true;
  }

  // ----- day / night ----------------------------------------------------------
  updateDayNight(dt) {
    this.dayNight.advance(dt);
    this.cycleT = this.dayNight.t;
    const dayness = this.dayNight.dayness;
    this.nightness = this.dayNight.nightness;
    this.isNight = this.dayNight.isNight;
    const lightLevel = this.weather.lightLevel;
    // The sun travels its arc: position and intensity follow the driver,
    // and the sky keyframes blend the fog and the background.
    const dir = this.dayNight.sunDirection();
    this.sunLight.position.set(dir.x * 180, Math.max(8, dir.y * 160), dir.z * 180 - 40);
    const key = this.dayNight.keyframe();
    this.sunLight.intensity = key.sun * lightLevel;
    this.hemiLight.intensity = (0.22 + dayness * 0.68) * lightLevel;
    this.scene.fog.color.setHex(this.nightness > 0.5 ? 0x0a0e24 : key.fog);
    this.scene.background = this.nightness > 0.5 ? this.nightSkyTex : this.daySkyTex;
    this.sunDisc.visible = this.nightness <= 0.5;
    this.sunGlow.visible = this.nightness <= 0.5;
    this.sunDisc.position.set(dir.x * 320, Math.max(30, dir.y * 220), -420);
    this.sunGlow.position.copy(this.sunDisc.position);
    this.moonDisc.visible = this.nightness > 0.5;
    this.dayness = dayness;
  }

  /** The city animation layer (v6): traffic lights cycle on a shared
   * timer, the ferris wheel turns, the lighthouse beam sweeps, the tower
   * beacon blinks and the ferry bobs at its mooring. */
  updateCityAnimation(dt) {
    // Traffic lights: 8 s green, 2 s amber, 8 s green the other way, 2 s
    // amber — the heads flip on the shared phase, so every intersection
    // agrees with every other one.
    this.trafficLightTimer += dt;
    const phaseLength = [8, 2, 8, 2];
    let phase = this.trafficLightPhase;
    if (this.trafficLightTimer >= phaseLength[phase]) {
      this.trafficLightTimer = 0;
      phase = (phase + 1) % 4;
      this.trafficLightPhase = phase;
      for (const light of this.trafficLights) {
        const lamps = light.userData.lamps;
        if (!lamps) continue;
        // One head per intersection, on the shared cycle: green on the
        // two green phases, amber on the two amber phases, red in between
        // is implied by the other direction's green — the head shows the
        // direction that may go, so red only lights while amber is on.
        const green = phase === 0 || phase === 2;
        const amber = phase === 1 || phase === 3;
        lamps.green.material.opacity = green ? 1 : 0.25;
        lamps.amber.material.opacity = amber ? 1 : 0.25;
        lamps.red.material.opacity = amber ? 0.6 : 0.25;
      }
    }
    if (this.ferrisWheel) {
      this.ferrisWheel.rotation.z += dt * 0.12;
    }
    if (this.lighthouse) {
      const beam = this.lighthouse.userData.beam;
      if (beam) beam.rotation.y += dt * 0.5;
      const lamp = this.lighthouse.userData.lamp;
      if (lamp) lamp.material.color.setHex(Math.sin(this.time * 4) > 0 ? 0xffe9a0 : 0xfff6c9);
    }
    if (this.towerBeacon) {
      this.towerBeacon.visible = Math.sin(this.time * 3) > 0;
    }
    if (this.ferry) {
      this.ferry.position.y = Math.sin(this.time * 0.8) * 0.15;
      this.ferry.rotation.z = Math.sin(this.time * 0.6) * 0.01;
    }
  }

  // ----- per-frame ------------------------------------------------------------
  update(dt) {
    this.time += dt;
    // v5 stats: play time ticks while playing, best wanted only ever
    // climbs, and the stolen-car count mirrors the player's own counter.
    if (this.mode === 'play') {
      this.stats.playTime = (this.stats.playTime || 0) + dt;
      this.stats.bestWanted = Math.max(this.stats.bestWanted || 0, this.wanted);
      this.stats.carsStolen = this.player.carsStolen;
    }
    if (this.mode !== 'play') {
      this.fx.update(dt);
      // v5: while paused, P (or Esc) resumes — otherwise a keyboard-only
      // player could pause with P and never get back without the mouse.
      // Edges are consumed in every non-play mode, so a key pressed on a
      // menu screen never leaks into play as a stale edge.
      const edges = this.input.consumeEdges();
      if (this.mode === 'paused' && (edges.p || edges.esc)) {
        this.setMode('play');
      }
      return;
    }
    // A visual-novel briefing is open: the world holds still behind the
    // dialogue overlay, and the HUD keeps rendering the current line.
    if (this.missions.briefing) {
      this.input.consumeEdges();
      this.fx.update(dt);
      this.hud.update(this);
      return;
    }
    // v7: inside a building interior — the street world freezes and the
    // interior owns Riko's movement (its own WASD walk, its own walls),
    // until he steps back out through the glowing doorway. The camera
    // still follows him: without updateCamera here it would stay frozen
    // on the street outside, looking at the room's outer wall.
    if (this.interiors.inside) {
      this.interiors.update(dt, this);
      this.fx.update(dt);
      this.updateCamera(dt);
      this.hud.update(this);
      return;
    }
    this.updateDayNight(dt);
    this.updateCityAnimation(dt);
    // Neon signs pulse at dusk, each on its own phase.
    for (const sign of this.neonSigns) {
      sign.mesh.material.opacity = 0.72 + 0.28 * Math.sin(this.time * 2.4 + sign.phase);
    }
    // Districts visited: the save file remembers the explored map.
    const here = this.hud.districtAt(this.player.x, this.player.z);
    if (here && here !== 'Qihuy City') this.districtsVisited.add(here);
    // Weather: cycle, rain, lightning; rain sound follows the rain level.
    // The fx layer gets rain splash rings on the street while it rains.
    this.weather.update(dt, this.player.x, this.player.z, this.sunLight, this.hemiLight, this.dayness, this.fx);
    this.audio.rain(this.weather.isRaining ? this.weather.def.rain * 0.5 : 0);
    if (this.weather.flash > 0 && this.prevFlash <= 0) this.audio.thunder();
    this.prevFlash = this.weather.flash;
    const edges = this.input.consumeEdges();
    const camDrag = this.input.consumeCamera();
    if (camDrag.x !== 0 || camDrag.y !== 0) this.lastDragAt = this.time;
    this.camYaw -= camDrag.x * 0.005;
    this.camPitch = clamp(this.camPitch + camDrag.y * 0.004, 0.08, 1.1);

    if (edges.m) {
      this.audio.setMuted(!this.audio.muted);
    }
    if (edges.n) {
      // Jump to the other half of the day.
      this.dayNight.jumpHalfDay();
      this.updateDayNight(0);
      this.missions.say(this.isNight ? 'Night falls over Qihuy City. The searchlight is out.' : 'Sunset again over Qihuy City.', 3);
    }
    if (edges.v) {
      this.weather.next();
      const state = this.weather.state;
      this.missions.say(`Weather: ${this.weather.label} — roads are ${state === 'clear' ? 'dry' : state === 'fog' ? 'foggy' : 'wet, grip down'}.`, 4);
    }
    if (edges.l) {
      this.headlights = !this.headlights;
      this.missions.say(this.headlights ? 'Headlights on.' : 'Headlights off.', 2);
    }
    if (edges.g) {
      // v8: G aboard a boat refuels at a dock; on land it is still the
      // garage repair, as before.
      if (this.player.boat) this.boats.tryRefuel(this);
      else this.tryGarageRepair();
    }
    if (edges.r && !this.player.onFoot) {
      const name = this.audio.cycleStation();
      this.missions.say('Radio: ' + name, 3);
    }
    if (edges.c) {
      // Chase camera: C cycles close / medium / far follow distance.
      this.camDistIndex = (this.camDistIndex + 1) % TUNE.camDistances.length;
      this.camDistOverride = null;
      const names = ['close', 'medium', 'far'];
      this.missions.say(`Camera: ${names[this.camDistIndex]} chase view.`, 2);
    }
    if (edges.q) {
      // Q toggles the live police roster panel.
      this.rosterVisible = !this.rosterVisible;
      this.missions.say(this.rosterVisible ? 'Police roster shown.' : 'Police roster hidden.', 2);
    }
    if (edges.weapon) {
      const names = { 1: 'fists', 2: 'pistol', 3: 'shotgun', 4: 'smg' };
      const name = names[edges.weapon];
      if (name && this.player.switchWeapon(name)) {
        this.missions.say(name === 'fists' ? 'Fists out.' : `Drew the ${name}.`, 2);
      } else if (name) {
        this.missions.say(`No ${name} yet — buy one at the corner store ($).`, 3);
      }
    }
    if (edges.esc) {
      this.setMode('paused');
      return;
    }
    // v5: P opens the stats screen — the pause menu with the lifetime
    // stats — from play, and resumes from pause.
    if (edges.p) {
      this.setMode('paused');
      return;
    }

    const player = this.player;
    if (edges.e) {
      if (this.boats.handleInteract(this)) {
        // v8: spent on a boat — boarded it, got off at a dock, or was
        // told the water is too deep to step off here.
      } else if (this.missions.tryInteract(this)) {
        // Spent on the mission: a pickup, a fare, a patient.
      } else if (this.modes.tryInteract(this)) {
        // v7: spent on the mode — a taxi fare pickup. It must not fall
        // through to the garage below: one fare starts at the safehouse.
      } else if (player.onFoot && this.interiors.tryEnter(this)) {
        // v7: stepped through a doorway into the shop, the casino or the safehouse.
      } else if (player.onFoot) {
        // v7: the parts shop on the port road sells upgrades, the corner
        // store sells guns — the screen shows the right wall for the
        // shop Riko actually walked into.
        const storefront = this.shops.nearestStorefront(player.x, player.z, PLACES, dist2);
        if (storefront) {
          this.openShop(storefront);
          // The shop screen owns the rest of the frame: opening it
          // changes the mode, so the world stops here, as before.
          return;
        } else if (dist2(player.x, player.z, PLACES.safehouse.x, PLACES.safehouse.z) < 64) {
          // v5: the safehouse garage — E near the H marker buys it, parks a
          // stolen car, or takes one back out.
          this.handleGarage();
        } else if (this.missions.done && !this.missions.sideJob) {
          // v6 side jobs: E at the docks, the beach car or the warehouse
          // starts a repeatable job once the story is done.
          if (dist2(player.x, player.z, PLACES.docks.x, PLACES.docks.z) < 64) {
            this.missions.startSideJob('courier');
          } else if (dist2(player.x, player.z, PLACES.beachCar.x, PLACES.beachCar.z) < 36) {
            this.missions.startSideJob('wheelman');
          } else if (dist2(player.x, player.z, PLACES.warehouse.x, PLACES.warehouse.z) < 64) {
            this.missions.startSideJob('lookout');
          } else {
            const got = player.tryEnterCar(this.traffic);
            if (got) {
              if (got.stalled) {
                this.missions.say('This car is wrecked — repair it at Mara\'s garage first.', 4);
              } else if (got.stolen) {
                this.crime(1, `You stole the ${got.car.name}!`);
              } else {
                this.missions.say(`In the ${got.car.name}.`, 2);
              }
              this.audio.engine(0, true);
            }
          }
        } else {
          const got = player.tryEnterCar(this.traffic);
          if (got) {
            if (got.stalled) {
              this.missions.say('This car is wrecked — repair it at Mara\'s garage first.', 4);
            } else if (got.stolen) {
              this.crime(1, `You stole the ${got.car.name}!`);
            } else {
              this.missions.say(`In the ${got.car.name}.`, 2);
            }
            this.audio.engine(0, true);
          }
        }
      } else if (dist2(player.x, player.z, PLACES.safehouse.x, PLACES.safehouse.z) < 64) {
        // Driving: E near the safehouse parks the stolen car.
        this.handleGarage();
      } else {
        player.exitCar();
      }
    }
    if (edges.f) player.punch(this.people, this.fx, this.audio);
    // v6: X rolls in the current movement direction (camera-relative), or
    // forward if Riko is standing still. A roll that lands is a short
    // burst of speed with knockback immunity.
    if (edges.x && player.onFoot) {
      const fwd = (this.input.forward ? 1 : 0) - (this.input.back ? 1 : 0);
      const strafe = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      const dx = sin * fwd + cos * strafe;
      const dz = cos * fwd - sin * strafe;
      if (player.roll(dx, dz)) this.audio.roll();
    }
    if (edges.h && !player.onFoot) {
      this.audio.blip(196, 0.25, 0.3);
      setTimeout(() => this.audio.blip(196, 0.25, 0.3), 180);
    }
    if (this.input.consumeShoot() && player.onFoot) {
      const aim = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
      player.shoot(this.people, aim, this.fx, this.audio, (s, m) => this.crime(s, m));
      // v8: the same shot may hit a helicopter overhead — the pursuit
      // brain checks the aim ray against both choppers.
      this.heliPursuit.registerShot(aim, player.weapon);
    }

    // Movement: on foot, or behind the wheel.
    if (player.onFoot) {
      player.update(dt, this.input, this.camYaw, this.colliders, this.traffic, this.fx);
    } else if (player.car) {
      // v7: the fitted upgrades ride with the car — engine, armour and
      // tyres apply to whatever Riko is driving, every frame, so a
      // purchase made mid-drive takes effect on the car under him.
      this.economy.applyToCar(player.car);
      const drive = this.traffic.drivePlayer(player.car, this.input, dt, this.weather.grip, this.fx);
      // v5: a motorbike revs higher than a car — the engine voice knows.
      this.audio.engine(drive.speed / TUNE.carMaxSpeed, true, player.car.isBike);
      // v6: while a drift is building, pale tyre smoke trails the rear
      // wheels — throttled to one puff per frame at most.
      if (drive.drifted) {
        const car = player.car;
        const bx = car.x - Math.sin(car.yaw) * 1.6;
        const bz = car.z - Math.cos(car.yaw) * 1.6;
        this.fx.driftSmoke(bx, 0.4, bz);
      }
      // v6 drift: banked points pay out as cash at the next full stop.
      if (drive.driftBanked > 0) {
        this.money += drive.driftBanked;
        this.driftEarned += drive.driftBanked;
        // v7: the drift cash writes a ledger line, like every other earning.
        this.economy.record('drift', drive.driftBanked, 'Drift cash');
        this.missions.say(`Drift banked — +$${Math.floor(drive.driftBanked)} for clean driving.`, 3);
        this.audio.chime();
        this.fx.confetti(player.car.x, 2, player.car.z);
      }
      if (drive.spinning) {
        this.missions.say('PIT spin! The patrol spun you around.', 3);
      }
      if (drive.crashed) {
        this.stats.crashes += 1;
        // v7: a crash in a taxi career shift costs the tip, like the
        // story taxi mission — the mode hears about every crash.
        this.modes.onCrash();
        // v5: a bike crash hurts the rider too — no steel cage around him.
        if (player.car.isBike) {
          player.damage(TUNE.bikeCrashPlayerDamage);
          this.missions.say('That crash hurt — bikes have no cage.', 3);
        }
        this.audio.scrape();
        this.audio.thud();
        this.fx.hitStop('crash', performance.now());
        this.fx.burst(player.car.x, 1.2, player.car.z, 0x9aa0b0, 10, 3);
        this.missions.onCrash(this);
        if (player.car.damage >= TUNE.carSmokeAt) {
          this.fx.burst(player.car.x, 1.4, player.car.z, 0x555555, 8, 2);
        }
        if (player.car.stalled) {
          this.missions.say('The car is wrecked — get it to Mara\'s garage (or press G there).', 5);
        }
      }
      // Running a pedestrian over is a crime the whole street sees.
      for (const ped of this.people.peds) {
        if (ped.dead) continue;
        if (dist2(player.car.x, player.car.z, ped.x, ped.z) < 5 && Math.abs(player.car.speed) > 4) {
          ped.dead = true;
          ped.mesh.rotation.x = -Math.PI / 2;
          ped.mesh.position.y = 0.3;
          this.fx.burst(ped.x, 1.2, ped.z, 0xff5040, 10, 4);
          this.people.scare(ped.x, ped.z, 30);
          this.crime(1, 'You hit a pedestrian!');
          this.audio.thud();
          break;
        }
      }
      player.x = player.car.x;
      player.z = player.car.z;
      player.yaw = player.car.yaw;
    }

    // Headlights: a spotlight ahead of the car when on and dark or wet.
    const darkOut = this.isNight || this.weather.state === 'fog' || this.weather.state === 'storm';
    if (this.headlights && !player.onFoot && player.car && darkOut) {
      const car = player.car;
      this.headlight.intensity = 60;
      this.headlight.position.set(car.x, 1.4, car.z);
      this.headlightTarget.position.set(
        car.x + Math.sin(car.yaw) * 18, 0.4, car.z + Math.cos(car.yaw) * 18,
      );
    } else {
      this.headlight.intensity = 0;
    }

    // Camera follows the car when driving, the player when on foot —
    // frame-rate-independent damping, so the yaw settles smoothly instead
    // of snapping after a sharp turn.
    if (!player.onFoot && player.car && this.time - this.lastDragAt > 1.2) {
      const diff = angleDelta(this.camYaw, player.car.yaw);
      this.camYaw += diff * (1 - Math.exp(-1.6 * dt));
    }

    // v5: weather feeds the police — fog and rain trim every unit's sight
    // range, in the patrol cars and on foot.
    this.traffic.weatherSight = this.weather.sightFactor;
    this.people.weatherSight = this.weather.sightFactor;
    this.traffic.update(dt, player, this.wanted, this.time, (cop, car) => {
      // A ramming patrol unit made contact: dent the car, freeze the sim
      // for a beat, kick the camera and play the skid.
      car.damage = Math.min(TUNE.carMaxDamage, car.damage + 7);
      this.fx.hitStop('ram', performance.now());
      this.fx.burst(car.x, 1.2, car.z, 0xff5040, 10, 4);
      this.fx.impactRing(car.x, car.z, 0xff5040);
      this.audio.skid();
      this.audio.thud();
      this.missions.onCrash(this);
    });
    // A police brain that just changed tactic fires one dispatch blip —
    // the trace log grows by one line per transition, so the count is the
    // signal, not the per-frame tactic.
    let traceCount = 0;
    for (const cop of this.traffic.police) {
      if (cop.brain) traceCount += cop.brain.trace.length;
    }
    if (traceCount > this.lastTraceCount) {
      this.lastTraceCount = traceCount;
      this.audio.dispatch();
    }
    this.traffic.updateHeli(dt, player, this.wanted, this.isNight);
    // v8: the helicopter pursuit brain (searchlight lock, ground
    // coordination, shoot-downs) and the boats (driving, runs, fuel,
    // sinking) tick right after the traffic helicopters they watch.
    this.heliPursuit.update(dt);
    this.boats.update(dt);
    this.people.update(dt, player, this.wanted, (gunman, d) => {
      // A gang gunman fires: an inaccurate shot that can still hurt.
      this.audio.shot();
      this.fx.tracer(
        { x: gunman.x, y: 1.5, z: gunman.z },
        { x: player.x, y: 1.3, z: player.z },
      );
      // v6: the HUD's damage-direction indicator points at the shooter.
      this.hud.markHit(Math.atan2(gunman.x - player.x, gunman.z - player.z), this.time);
      if (Math.random() < 0.45) {
        player.damage(7);
        this.fx.burst(player.x, 1.4, player.z, 0xff5040, 6, 3);
      }
    });

    // Wanted decay: stay out of sight of every cop car and it fades.
    // v6: the helicopter spotlight pauses the decay at night — while the
    // beam is on the player, the heat does not cool off.
    if (this.wanted > 0) {
      const seen = this.traffic.police.some((cop) => dist2(cop.x, cop.z, player.x, player.z) < 6400)
        || this.people.cops.some((cop) => dist2(cop.x, cop.z, player.x, player.z) < 3600);
      const pinned = (this.isNight && this.traffic.spotlightOnPlayer)
        // v8: a full searchlight lock pins the wanted level too, day
        // or night — while the beam holds Riko, the heat does not cool.
        || this.heliPursuit.locked;
      // v6: the rotor loop follows the helicopter — audible while a heli
      // is overhead, silent when it leaves.
      this.audio.heli(this.traffic.heli || this.traffic.heli2);
      if (seen || pinned) this.wantedTimer = 0;
      else {
        this.wantedTimer += dt;
        // v8: laying low on the safehouse grounds clears the heat fast —
        // one star a second under cover, so a chase ends once Riko breaks
        // the beam instead of a star every 18 s. (Interiors never reach
        // here: update() returns early while inside.)
        const decaySeconds = this.heliPursuit.playerUnderCover() ? 1 : TUNE.wantedDecaySeconds;
        if (this.wantedTimer > decaySeconds) {
          this.setWanted(this.wanted - 1);
          this.missions.say(this.wanted > 0 ? 'The heat is cooling off…' : 'You lost the cops.', 3);
        }
      }
    }

    // Health creeps back when the player has been out of trouble a while.
    if (player.health < this.prevHealth) this.lastDamageAt = this.time;
    this.prevHealth = player.health;
    if (player.health > 0 && player.health < TUNE.playerMaxHealth && this.time - this.lastDamageAt > 6) {
      player.heal(2.5 * dt);
    }

    // v7: the branching story ticks BEFORE the missions — it watches
    // mission 21's two doors, so the choice always wins the race to
    // the garage door over the engine's own reach-and-complete.
    this.story.update(dt, this);
    this.missions.update(dt, this);
    // v7: the traffic director stages its events and the modes count
    // their shifts down, after the missions have had their say.
    this.trafficDirector.update(dt, this);
    this.modes.update(dt, this);
    this.fx.update(dt);

    // Safehouse: step inside and the heat is gone, progress saved.
    const nearSafe = dist2(player.x, player.z, PLACES.safehouse.x, PLACES.safehouse.z) < 64;
    if (nearSafe && !this.insideSafehouse) {
      this.insideSafehouse = true;
      if (this.wanted > 0) {
        this.setWanted(0);
        this.missions.say('Safehouse — the heat is off. Progress saved.', 4);
      } else {
        this.missions.say('Safehouse — progress saved.', 3);
      }
      saveGame(this);
    } else if (!nearSafe) {
      this.insideSafehouse = false;
    }

    if (player.busted) {
      this.setMode('busted');
      this.audio.siren(false);
      return;
    }
    if (player.wasted) {
      this.setMode('wasted');
      this.audio.siren(false);
      return;
    }
    if (this.missions.done && !this.completedShown) {
      this.completedShown = true;
      this.setMode('complete');
      saveGame(this);
      return;
    }

    this.updateCamera(dt);
    this.hud.update(this);
  }

  updateCamera(dt) {
    const target = this.player.onFoot || !this.player.car
      ? { x: this.player.x, y: 1.6 + this.player.y, z: this.player.z }
      : { x: this.player.car.x, y: 1.8, z: this.player.car.z };
    // Chase camera: C cycles the follow distance; a shot's override wins.
    const dist = this.camDistOverride
      || (this.player.onFoot ? 9 : TUNE.camDistances[this.camDistIndex]);
    // Chase cam: the field of view widens with speed, so a flat-out chase
    // feels faster than a crawl through the plaza.
    const driving = !this.player.onFoot && this.player.car;
    const speed01 = driving ? clamp(Math.abs(this.player.car.speed) / TUNE.carMaxSpeed, 0, 1.2) : 0;
    const fov = 62 + speed01 * 9;
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const height = Math.sin(this.camPitch) * dist;
    const flat = Math.cos(this.camPitch) * dist;
    const cx = target.x - Math.sin(this.camYaw) * flat;
    const cz = target.z - Math.cos(this.camYaw) * flat;
    // Trauma shake: a decaying visual delta on the camera only — the
    // player, the cars and the aim ray never move with it.
    const shake = this.fx.shakeSample(dt, this.time);
    this.camera.position.set(
      cx + shake.x,
      target.y + height + shake.y,
      cz + shake.x * 0.5,
    );
    this.camera.lookAt(target.x, target.y + 0.6, target.z);
  }

  /** One frame: step the world (in play) and draw. The hit-stop manager
   * scales the simulation step — a landed hit freezes the world for a few
   * dozen milliseconds while the camera keeps rendering. */
  frame(dt) {
    const scale = this.fx.hitstop.tick(performance.now());
    this.update(dt * scale);
    if (this.mode === 'title') {
      // Slow orbit around Sunset Plaza behind the title screen.
      const a = this.time * 0.05;
      this.camera.position.set(Math.sin(a) * 60, 26, Math.cos(a) * 60 - 31);
      this.camera.lookAt(-31, 4, -31);
      this.hud.show(false);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// ----- boot -------------------------------------------------------------------
const game = new Game();
// Exposed for live play-testing through the console (position, wanted level,
// mission state); the game itself never reads it.
window.__game = game;
// v8 feature flags, for the play-test harness and the dossier: what this
// build adds over v7, in one place.
window.__qihuy = {
  version: 8,
  game: 'Qihuy City',
  features: [
    'ferry-point', 'missions-18-20', 'drift-scoring', 'spike-strips',
    'pit-manoeuvre', 'traffic-lights', 'side-jobs', 'district-system',
    'day-night-driver', 'state-machine',
    'economy-ledger', 'parts-shop', 'upgrades', 'garage-slots',
    'interiors', 'casino-slots', 'traffic-director', 'roadworks',
    'convoys', 'jaywalkers', 'branching-story', 'mara-vs-dara',
    'missions-21-24', 'vigilante-mode', 'taxi-career',
    'heli-pursuit', 'searchlight-lock', 'heli-shootdown', 'boats-water',
    'smuggling-runs', 'boat-fuel', 'boat-sinking',
  ],
};
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
// v6 debug boot: ?start=airport|casino|hangar|runway|ferry (or the shorthand
// ?airport=1) starts the game already running at that place, briefing
// dismissed, so a play-tester lands straight in the new district.
const startAt = params.get('start')
  || (params.get('airport') === '1' ? 'airport' : null);
const clock = new THREE.Clock();

if (shot) {
  // Screenshot mode: stage the pose, simulate it forward on a fixed clock,
  // render once and announce readiness. The settle frames step the world
  // without rendering (update, not frame) so a slow software rasterizer
  // does not pay for seventy throwaway renders; only the final frame
  // draws. A shot may return its own settle length (the chase wants a
  // short one, so the patrol cars are still in frame behind the player).
  const frames = stageShot(shot, game) ?? 150;
  for (let i = 0; i < frames; i += 1) game.update(1 / 30);
  game.frame(1 / 30);
  window.__shotReady = true;
} else {
  // Debug boot (?start=airport etc.): skip the title screen, start mission
  // 1 already running, and drop Riko at the named place.
  if (startAt && PLACES[startAt]) {
    const place = PLACES[startAt];
    game.resetWorld();
    game.setMode('play');
    game.missions.start();
    while (game.missions.briefing) game.missions.advanceBriefing();
    game.player.x = place.x;
    game.player.z = place.z;
    game.player.syncMesh();
    game.camYaw = Math.PI;
    game.missions.say(`Debug start: ${place.label}.`, 4);
  }
  const loop = () => {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    game.frame(dt);
  };
  loop();
}
