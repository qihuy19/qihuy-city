// A tiny static server for game/ (Node 22, standard library only), so an entry can be played
// locally without a build step: `node serve.ts` serves game/ on http://localhost:8080.
// It sends the MIME types a browser game needs, refuses any path outside game/, and otherwise
// does nothing clever: this is a development convenience, not a web server for the internet.
//
// v3: request logging to stderr (one line per request, with the status),
// HEAD support, a --host flag for LAN play-testing, and a JSON 404 body so
// a missing module is obvious in the console instead of a blank page.
//
// v5: two dev endpoints — GET /api/health (server up, game version, shot
// count) and GET /api/shots (the screenshot definitions from shots.json,
// so a play-test script can drive every pose without hardcoding them).
//
// v6: a third endpoint — GET /api/content (mission, district and stash
// counts straight from game/src/config.js, so a play-test script can
// assert the build carries the v6 content without parsing config itself).
// The health endpoint reports version 7 (v8: the version was still 6
// after the v7 round — bumped here, with the v8 shots in the log line).
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const flagValue = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1];
};
const requestedPort = Number(flagValue('--port', '8080'));
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8080;
const host = flagValue('--host', '127.0.0.1');
const quiet = args.includes('--quiet');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function logLine(status: number, method: string, path: string) {
  if (quiet) return;
  const stamp = new Date().toISOString().slice(11, 19);
  console.error(`[${stamp}] ${status} ${method} ${path}`);
}

/** v5 dev endpoints, served before the static file fallback: */
function apiResponse(request: { method?: string }, url: URL) {
  if (url.pathname === '/api/health') {
    let shotCount = 0;
    try {
      shotCount = JSON.parse(readFileSync(join(root, '..', 'shots.json'), 'utf8')).length;
    } catch { /* shots.json missing: health still answers */ }
    return {
      status: 200,
      body: JSON.stringify({
        status: 'ok',
        game: 'Qihuy City',
        version: 7,
        shots: shotCount,
        uptimeSeconds: Math.floor(process.uptime()),
      }),
    };
  }
  if (url.pathname === '/api/shots') {
    try {
      const defs = JSON.parse(readFileSync(join(root, '..', 'shots.json'), 'utf8'));
      return { status: 200, body: JSON.stringify({ shots: defs }) };
    } catch (err) {
      return { status: 500, body: JSON.stringify({ error: `shots.json unreadable: ${(err as Error).message}` }) };
    }
  }
  if (url.pathname === '/api/content') {
    // v6: mission, district and stash counts from the game's config, so a
    // play-test script can assert the v6 build without parsing config.js.
    try {
      const config = readFileSync(join(root, 'src', 'config.js'), 'utf8');
      const section = (startMarker: string, endMarker: string) => {
        const start = config.indexOf(startMarker);
        if (start < 0) return '';
        const end = config.indexOf(endMarker, start);
        return config.slice(start, end < 0 ? config.length : end);
      };
      const districts = (section('export const DISTRICTS', 'export const MISSIONS').match(/id: '[a-z-]+'/g) || []).length;
      const missions = (section('export const MISSIONS', 'export const PLACES').match(/id: '[a-z-]+'/g) || []).length;
      const stashes = (section('export const STASH_SPOTS', 'export const POLICE_CALLSIGNS').match(/\{ x:/g) || []).length;
      return {
        status: 200,
        body: JSON.stringify({ game: 'Qihuy City', version: 7, missions, districts, stashes }),
      };
    } catch (err) {
      return { status: 500, body: JSON.stringify({ error: `config unreadable: ${(err as Error).message}` }) };
    }
  }
  return null;
}

createServer((request, response) => {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  // v5: the dev API answers before the static fallback.
  if (url.pathname.startsWith('/api/')) {
    const api = apiResponse(request, url);
    if (api) {
      response.writeHead(api.status, { 'content-type': 'application/json' }).end(api.body);
      logLine(api.status, method, url.pathname);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown api endpoint', path: url.pathname }));
    logLine(404, method, url.pathname);
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'bad request' }));
    logLine(400, method, url.pathname);
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'forbidden' }));
    logLine(403, method, pathname);
    return;
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found', path: pathname }));
    logLine(404, method, pathname);
    return;
  }
  const headers = {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  };
  if (method === 'HEAD') {
    response.writeHead(200, headers).end();
    logLine(200, method, pathname);
    return;
  }
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
  logLine(200, method, pathname);
}).listen(port, host, () => {
  console.log(`game/ is on http://${host}:${port}`);
  console.log('shots: ?shot=chase|street|mission|start  (add &night=1 for night)');
  console.log('v8 shots: ?shot=heli|boat  ·  v7: ?shot=traffic|story|vigilante|shop');
  console.log('debug boot: ?start=ferry (also ?start=airport|casino|hangar|runway)');
  console.log(`dev api: http://${host}:${port}/api/health  ·  /api/shots  ·  /api/content`);
});
