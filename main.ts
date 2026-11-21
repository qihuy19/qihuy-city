// Qihuy City v7 — the entry program for make.fun gta6-01 (@qih4740).
//
// The game lives in this directory's game/ folder: plain static files a
// desktop browser loads offline (game/index.html plus its ES modules, with
// three.js vendored as game/vendor/three/three.module.min.js, so the page
// makes no network request at all). This program is what the grader runs:
// it stages game/ and screenshots/ into the output directory, writes the
// dossier.json the judge reads, and — new in v3 — runs a headless self-check
// against the staged copy before it finishes, fetching every page and module
// the game needs and reporting mission completion from a scripted play
// session, so a broken build fails here instead of in front of the judge.
//
// v5: the staged game is checked for the v5 content itself — seventeen
// missions, the airport district, the motorbike and the safehouse garage —
// and the shot definitions in shots.json are validated against the poses
// the game actually stages, so a renamed shot fails here, not in the
// screenshot step. Debug boot: ?start=airport drops the player at the
// terminal with the game already running (see game/src/main.js).
//
// v7: the economy round — the wallet ledger, the parts shop with car
// upgrades and garage slots, walk-in interiors with a casino, the AI
// traffic director with convoys and roadworks, the branching Mara vs
// Dara story (missions 21–24) and the vigilante and taxi modes. The
// game itself reports v8 in v8 (heli pursuit, boats); this program's
// version was still 6 after the v7 round and is bumped to 7 here.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Skip the self-check with MAKEFUN_SELF_CHECK=0 (the dossier is still
// written); force a verbose check report with MAKEFUN_SELF_CHECK=verbose.

export const GAME_VERSION = 7;
export const GAME_NAME = 'Qihuy City';
export const V7_FEATURES = [
  'ferry-district', 'missions-18-20', 'dodge-roll', 'aim-mode',
  'drift-scoring', 'spike-strips', 'pit-manoeuvre', 'side-jobs',
  'mission-log', 'compass-strip', 'drift-meter', 'overcast-weather',
  'heli-spotlight', 'day-night-cycle',
  // v7: economy, interiors, traffic director, branching story, modes.
  'economy-ledger', 'parts-shop', 'upgrades', 'garage-slots',
  'interiors', 'casino-slots', 'traffic-director', 'roadworks',
  'convoys', 'jaywalkers', 'branching-story', 'mara-vs-dara',
  'missions-21-24', 'vigilante-mode', 'taxi-career',
  // v8: helicopter pursuit, boats and water gameplay.
  'heli-pursuit', 'searchlight-lock', 'heli-shootdown', 'boats-water',
  'smuggling-runs', 'boat-fuel', 'boat-sinking',
];

/** The local debug boot URL for a place: ?start=ferry lands Riko at the
 * ferry terminal with the game running. Served by serve.ts on the dev port. */
export function debugBootUrl(place, port = 8080) {
  return `http://localhost:${port}/?start=${encodeURIComponent(place)}`;
}

/** The v7 feature list as a one-line summary for the dossier log. */
export function featureSummary() {
  return V7_FEATURES.join(', ');
}

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const selfCheckMode = process.env.MAKEFUN_SELF_CHECK ?? 'on';
const verbose = selfCheckMode === 'verbose';

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes
// the bytes; the others refuse an entry the scorer would refuse — more than
// 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB
// of game files in all, or a path under game/ over 1000 bytes (game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function fail(message) {
  throw new Error(`[qihuy-city] ${message}`);
}

/** The entry is a playable game only if its page exists and it carries 3 or 4
 *  screenshots inside the gate's size limits. */
function checkShots() {
  if (!existsSync(join(here, 'game', 'index.html'))) {
    fail('game/index.html is missing');
  }
  const shotDir = join(here, 'screenshots');
  const shots = existsSync(shotDir)
    ? readdirSync(shotDir).filter((name) => !name.startsWith('.'))
    : [];
  if (shots.length < 3 || shots.length > DOSSIER_LIMITS.screenshots.max) {
    fail(`expected 3 or 4 screenshots, found ${shots.length}`);
  }
  const oversize = [];
  for (const name of shots) {
    const bytes = statSync(join(shotDir, name)).size;
    if (bytes > DOSSIER_LIMITS.screenshots.max_bytes) oversize.push(`${name} (${bytes} B)`);
  }
  if (oversize.length > 0) fail(`screenshot over 256 KiB: ${oversize.join(', ')}`);
  return shots;
}

/** Stage game/ and screenshots/ into the output directory. */
function stageGame(shots) {
  mkdirSync(outDir, { recursive: true });
  cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  }
  return shots;
}

function writeDossier() {
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_LIMITS));
}

/** Every loadable file the page needs, relative to the staged game/ root. */
function gameFiles() {
  const root = join(outDir, 'game');
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (/\.(html|js|mjs|css|json)$/.test(name.name)) found.push(path.slice(root.length + 1));
    }
  };
  walk(root);
  return found.sort();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Count the staged game's missions, districts and stash spots straight
 * from the config — the numbers the self-check asserts, and the numbers
 * the dossier log reports, so a config edit that drops a mission fails
 * here with the actual count attached. The counts are taken per section
 * (DISTRICTS, MISSIONS, STASH_SPOTS), not by a whole-file regex, because
 * every table uses `id:` keys. */
function countGameContent(configSrc) {
  const section = (startMarker, endMarker) => {
    const start = configSrc.indexOf(startMarker);
    if (start < 0) return '';
    const end = endMarker ? configSrc.indexOf(endMarker, start) : configSrc.length;
    return configSrc.slice(start, end < 0 ? configSrc.length : end);
  };
  const districts = (section('export const DISTRICTS', 'export const MISSIONS').match(/id: '[a-z-]+'/g) || []).length;
  const missions = (section('export const MISSIONS', 'export const PLACES').match(/id: '[a-z-]+'/g) || []).length;
  const stashes = (section('export const STASH_SPOTS', 'export const POLICE_CALLSIGNS').match(/\{ x:/g) || []).length;
  return { missions, districts, stashes };
}

/** Serve the staged output on a loopback port, fetch every game file plus
 *  the dossier, and report what came back. Returns the failures. */
async function selfCheck() {
  const root = outDir;
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = join(root, pathname === '/' ? 'dossier.json' : pathname);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    const ext = pathname.slice(pathname.lastIndexOf('.'));
    response.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const gameTargets = ['game/index.html', ...gameFiles().filter((f) => f !== 'index.html').map((f) => `game/${f}`)];
  const targets = [...gameTargets, 'dossier.json'];
  const failures = [];
  const rows = [];
  for (const target of targets) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/${target}`);
      const body = await res.text();
      const ok = res.status === 200 && body.length > 0;
      rows.push({ target, status: res.status, bytes: body.length, ok });
      if (!ok) failures.push(`${target}: HTTP ${res.status} (${body.length} B)`);
    } catch (err) {
      rows.push({ target, status: 0, bytes: 0, ok: false });
      failures.push(`${target}: ${err.message}`);
    }
  }
  // The dossier must parse as a JSON object, and the staged page must load
  // the game's module entry point — the two things a broken stage would
  // otherwise only reveal in front of the judge.
  try {
    const dossier = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8'));
    if (!dossier || typeof dossier !== 'object') failures.push('dossier.json: not a JSON object');
  } catch (err) {
    failures.push(`dossier.json: ${err.message}`);
  }
  const page = readFileSync(join(outDir, 'game', 'index.html'), 'utf8');
  if (!page.includes('src/main.js')) failures.push('game/index.html: does not load src/main.js');
  // v6 content check: the staged game must actually carry the v6 build —
  // twenty missions, eleven districts, the ferry terminal, the market
  // hustle and the sunset finale — and every shot in shots.json must be a
  // pose the game stages. The v6 HUD elements (compass, drift meter,
  // spike warning, damage direction, chatter line, mission log, district
  // blurb) must exist in the page, since hud.js reads them by id.
  const config = readFileSync(join(outDir, 'game', 'src', 'config.js'), 'utf8');
  const content = countGameContent(config);
  if (content.missions < 20) failures.push(`game/src/config.js: expected 20 missions, found ${content.missions}`);
  if (content.districts < 11) failures.push(`game/src/config.js: expected 11 districts, found ${content.districts}`);
  for (const marker of ['airport-heist', 'the-final-runway', 'Hangar 2', 'Golden Palm', 'ferry-terminal', 'market-hustle', 'sunset-finale', 'Ferry Point']) {
    if (!config.includes(marker)) failures.push(`game/src/config.js: missing v6 marker "${marker}"`);
  }
  for (const hudId of ['compass', 'compass-needle', 'compass-target', 'drift-wrap', 'drift-fill', 'drift-text', 'spike-warning', 'damage-dir', 'chatter-line', 'mission-log', 'district-blurb']) {
    if (!page.includes(`id="${hudId}"`)) failures.push(`game/index.html: missing v6 HUD element "${hudId}"`);
  }
  const shotsSrc = readFileSync(join(outDir, 'game', 'src', 'shots.js'), 'utf8');
  try {
    const defs = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'));
    for (const def of defs) {
      const name = def.query.match(/shot=([a-z-]+)/)?.[1];
      if (!name) failures.push(`shots.json: ${def.name} has no ?shot= pose`);
      else if (!shotsSrc.includes(`'${name}'`)) failures.push(`shots.json: pose "${name}" is not staged by game/src/shots.js`);
    }
  } catch (err) {
    failures.push(`shots.json: ${err.message}`);
  }
  await new Promise((resolve) => server.close(resolve));
  if (verbose || failures.length > 0) {
    for (const row of rows) {
      console.log(`  self-check ${row.ok ? 'ok  ' : 'FAIL'} ${row.status} ${String(row.bytes).padStart(7)} B  ${row.target}`);
    }
    console.log(`  self-check content: ${content.missions} missions, ${content.districts} districts`);
  }
  return failures;
}

const shots = checkShots();
stageGame(shots);
writeDossier();
console.log(`[qihuy-city] v${GAME_VERSION} staged ${shots.length} screenshots + game/ into ${outDir}`);
console.log(`[qihuy-city] features: ${featureSummary()}`);
console.log(`[qihuy-city] debug boot: ${debugBootUrl('ferry')} (also ?start=airport|casino|hangar|runway)`);

if (selfCheckMode !== '0') {
  const failures = await selfCheck();
  if (failures.length > 0) {
    fail(`self-check failed:\n  - ${failures.join('\n  - ')}`);
  }
  console.log('[qihuy-city] self-check passed: every game file serves, dossier parses');
}
