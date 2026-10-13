// Campfire server: issues room tokens (capped at 10 people) and serves the page.
// In development it runs Vite inside; in production it serves "dist".
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();
const PORT = Number(process.env.PORT) || 5173;
const DEV = process.argv.includes('--dev');

const MAX = 10;                                    // people per room
const SEAT_ORDER = [1, 8, 3, 6, 4, 5, 2, 7, 0, 9]; // order in which seats fill up
const configured = Boolean(LIVEKIT_URL && API_KEY && API_SECRET);
// Domains allowed to open the dev server (besides localhost).
// ngrok tunnels are already included; add others in ALLOWED_HOSTS, comma separated.
const HOSTS = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io',
  ...(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)];
const rooms = configured ? new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, 'http'), API_KEY, API_SECRET) : null;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; if (text.length > 4096) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const cleanRoom = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 24);

function seatOf(metadata) {
  try { const s = JSON.parse(metadata || '{}').seat; return Number.isInteger(s) ? s : -1; } catch { return -1; }
}

// POST /api/join  { room, name, seat? }  ->  { token, url, seat }
async function issueToken(req, res) {
  let body;
  try { body = await readJson(req); } catch { return json(res, 400, { error: 'bad_request' }); }
  const room = cleanRoom(body.room);
  const name = cleanName(body.name);
  if (!room || !name) return json(res, 400, { error: 'bad_request' });
  const wanted = Number.isInteger(body.seat) && body.seat >= 0 && body.seat < MAX ? body.seat : -1;
  if (!configured) return json(res, 503, { error: 'not_configured' });

  try {
    // Creates the room with its cap (if it already exists, LiveKit returns the same one).
    await rooms.createRoom({ name: room, maxParticipants: MAX, emptyTimeout: 300 });
    const present = await rooms.listParticipants(room);
    if (present.length >= MAX) return json(res, 409, { error: 'room_full' });

    const taken = new Set(present.map((p) => seatOf(p.metadata)));
    // The requested seat is kept if it is free; otherwise the next one in order.
    const seat = wanted >= 0 && !taken.has(wanted) ? wanted : (SEAT_ORDER.find((i) => !taken.has(i)) ?? 0);

    const token = new AccessToken(API_KEY, API_SECRET, {
      identity: crypto.randomUUID(),
      name,
      metadata: JSON.stringify({ seat }),
      ttl: '6h',
    });
    // canUpdateOwnMetadata lets each person change their own seat after joining.
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canUpdateOwnMetadata: true });
    json(res, 200, { token: await token.toJwt(), url: LIVEKIT_URL, seat });
  } catch (e) {
    console.error('Could not issue the token:', e?.message || e);
    console.error(e, res);
    json(res, 502, { error: 'livekit' });
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveFile(req, res) {
  const dist = path.join(ROOT, 'dist');
  const route = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(dist, route));
  if (!file.startsWith(dist)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('The page is not built yet: run "npm run build" before "npm start".');
  }
  const inAssets = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': inAssets ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

let vite = null;
const server = http.createServer((req, res) => {
  const route = (req.url || '/').split('?')[0];
  if (route === '/api/join' && req.method === 'POST') return void issueToken(req, res);
  if (route === '/api/status') return json(res, 200, { configured, max: MAX });
  if (route.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
  if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
  serveFile(req, res);
});

if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, appType: 'spa', server: { middlewareMode: true, hmr: { server }, allowedHosts: HOSTS } });
}

server.listen(PORT, () => {
  console.log(`Cozy Firecamp ready at http://localhost:${PORT}`);
  if (!configured) console.log('LiveKit is not configured: the app opens in "no call" mode. See the README to enable it.');
});
