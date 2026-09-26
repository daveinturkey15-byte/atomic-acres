/**
 * net-signal - the smallest honest WebRTC signalling relay, for the LAN tier.
 *
 * WHAT IT IS. Plain Node http, no dependencies (this repo has no `ws`, and no
 * `npm install` is allowed). Peers subscribe to a room code over Server-Sent
 * Events and post small JSON envelopes (offer / answer / ICE) addressed to one
 * other peer in the same room; the relay forwards them and forgets them. Once
 * the data channels are up the relay carries nothing: a match survives it
 * exiting.
 *
 * WHAT IT IS NOT. Not a game server, not a matchmaker, not a TURN. It never
 * sees an input or a snapshot. Two machines that cannot reach each other's
 * host candidates (different NATs) need STUN/TURN in `src/net/rtc.ts`'s
 * `iceServers`, not a change here.
 *
 *   node scripts/net-signal.mjs [--port 4310] [--host 127.0.0.1]
 *
 * Bound to 127.0.0.1 by default. `--host 0.0.0.0` exposes it on the LAN so a
 * second machine can join by code; do that on purpose. Port > 4300 so it never
 * collides with the owner's :4173, the frozen build on :4190 or the shared
 * preview on :4188. Harnesses start it through `spawnGuarded` and kill it.
 *
 * Endpoints (every response carries `Access-Control-Allow-Origin: *`, because
 * the page is served from a different port):
 *   GET  /events?code=XXXXXX&peer=ID   SSE stream; first event is `ready`
 *   POST /signal  {code, from, to, payload}  forwarded to `to`'s stream
 *   GET  /health  {ok, rooms, peers}
 */
import http from 'node:http';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const PORT = Number(opt('port', process.env.AA_SIGNAL_PORT || '4310'));
const HOST = opt('host', '127.0.0.1');
/** QA fault injection: force ICE to race ahead of SDP through the relay. */
const DELAY_SDP_MS = Math.min(2_000, Math.max(0, Number(opt('delay-sdp-ms', '0')) || 0));
const MAX_ROOMS = 64;
const MAX_PEERS = 16;
const MAX_BODY = 64 * 1024;
const CODE_RE = /^[0-9A-Z]{4,8}$/;
const PEER_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** code -> Map<peerId, response> */
const rooms = new Map();
let forwarded = 0;
let rejected = 0;
let qaEarlyIce = 0;
/** QA-only delivery order, scoped to live rooms. */
const qaDeliveredSdp = new Map();

function cors(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}

function json(res, status, body) {
  cors(res, { 'Content-Type': 'application/json' });
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function subscribe(req, res, url) {
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const peer = String(url.searchParams.get('peer') || '');
  if (!CODE_RE.test(code) || !PEER_RE.test(peer)) { rejected++; return json(res, 400, { ok: false, reason: 'bad-code-or-peer' }); }
  let room = rooms.get(code);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) { rejected++; return json(res, 503, { ok: false, reason: 'too-many-rooms' }); }
    room = new Map();
    rooms.set(code, room);
  }
  if (!room.has(peer) && room.size >= MAX_PEERS) { rejected++; return json(res, 503, { ok: false, reason: 'room-full' }); }
  const prev = room.get(peer);
  if (prev) { try { prev.end(); } catch { /* gone */ } }
  cors(res, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.writeHead(200);
  res.write('retry: 1000\n\n');
  res.write('event: ready\ndata: {"peer":"' + peer + '"}\n\n');
  room.set(peer, res);
  const keep = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { /* closing */ } }, 15000);
  req.on('close', () => {
    clearInterval(keep);
    if (room.get(peer) === res) room.delete(peer);
    if (room.size === 0) {
      rooms.delete(code);
      qaDeliveredSdp.delete(code);
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function signal(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { rejected++; return json(res, 400, { ok: false, reason: 'bad-json' }); }
  const code = String(body?.code || '').toUpperCase();
  const from = String(body?.from || '');
  const to = String(body?.to || '');
  if (!CODE_RE.test(code) || !PEER_RE.test(from) || !PEER_RE.test(to) || !body.payload || typeof body.payload !== 'object') {
    rejected++;
    return json(res, 400, { ok: false, reason: 'bad-envelope' });
  }
  const room = rooms.get(code);
  const target = room?.get(to);
  if (!target) { rejected++; return json(res, 404, { ok: false, reason: 'no-such-peer' }); }
  if (DELAY_SDP_MS > 0 && (body.payload.kind === 'offer' || body.payload.kind === 'answer')) {
    await new Promise((resolve) => setTimeout(resolve, DELAY_SDP_MS));
    if (room.get(to) !== target) { rejected++; return json(res, 410, { ok: false, reason: 'peer-gone' }); }
  }
  try {
    target.write('data: ' + JSON.stringify({ from, payload: body.payload }) + '\n\n');
    forwarded++;
    if (DELAY_SDP_MS > 0) {
      const route = from + '>' + to;
      let seen = qaDeliveredSdp.get(code);
      if (!seen) { seen = new Set(); qaDeliveredSdp.set(code, seen); }
      if (body.payload.kind === 'ice' && !seen.has(route)) qaEarlyIce++;
      if (body.payload.kind === 'offer' || body.payload.kind === 'answer') seen.add(route);
    }
  } catch {
    rejected++;
    return json(res, 410, { ok: false, reason: 'peer-gone' });
  }
  return json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && url.pathname === '/events') return subscribe(req, res, url);
  if (req.method === 'POST' && url.pathname === '/signal') return void signal(req, res);
  if (req.method === 'GET' && url.pathname === '/health') {
    let peers = 0;
    for (const r of rooms.values()) peers += r.size;
    return json(res, 200, { ok: true, rooms: rooms.size, peers, forwarded, rejected, qaEarlyIce });
  }
  return json(res, 404, { ok: false, reason: 'not-found' });
});

server.on('error', (err) => {
  console.error('[net-signal] ' + String(err));
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log('[net-signal] listening on http://' + HOST + ':' + PORT + ' (rooms<=' + MAX_ROOMS + ', peers/room<=' + MAX_PEERS + ')');
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, () => { server.close(); process.exit(0); });
}
