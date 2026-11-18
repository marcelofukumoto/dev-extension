// conversation-api: GitHub for Conversation mode's dashboard, asked here and pushed to the pages.
//
// The pattern is the usual one. This server asks GitHub on a schedule that keeps clear of its
// limits (every ten minutes, one query per product and section, two at a time), keeps the answer
// (in memory and in a file, so a restart serves at once), and pushes every new answer to the pages
// listening on its WebSocket. A page or an agent can ask for a refresh (POST /refresh), no more
// than once a minute. Agents read it too: `curl http://conversation-api.dev-system:8080/work`.
//
// The answer is the shape github.ts's myWork() answers in, merged across products (projects.mjs),
// so the dashboard draws it without knowing who asked.
//
// GitHub's token is the conversation-env Secret's GH_TOKEN_DEV_EXTENSION, mounted as a file and
// read on every refresh, so a rotated token is picked up without a restart. The pod has no
// Kubernetes API access at all (automountServiceAccountToken: false); see k8s.yaml.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS, mergeWork } from '../projects.mjs';
import { sectionQuery, shapeSection, askGithub } from './github.mjs';
import {
  acceptKey, frame, textFrame, readFrames
} from './ws.mjs';

const PORT = Number(process.env.PORT || 8080);
const ENV_FILE = process.env.ENV_FILE || '/etc/conversation/.env';
const CACHE_FILE = process.env.CACHE_FILE || '/workspaces/.conversation/cache/work.json';
const EVERY_MS = Number(process.env.EVERY_MS || 10 * 60 * 1000);
const MIN_REFRESH_MS = Number(process.env.MIN_REFRESH_MS || 60 * 1000);
const HEARTBEAT_MS = 25000;
const SECTIONS = ['mine', 'reviewing', 'issues'];
const CONCURRENCY = 2;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const state = {
  at: 0, work: { login: '', mine: [], reviewing: [], issues: [] }, errors: [], refreshing: false, reason: ''
};
/** The last good answer of each product and section, so one that fails keeps what it had. */
let lastAnswers = [];
const sockets = new Set();

function token() {
  let text = '';

  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    return '';
  }
  const vars = {};

  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (m) {
      vars[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }

  return vars.GH_TOKEN_DEV_EXTENSION || vars.GH_TOKEN || '';
}

function loadCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

    if (cached?.at && cached.work) {
      Object.assign(state, { at: cached.at, work: cached.work, errors: cached.errors || [] });
      log(`cache from ${ new Date(cached.at).toISOString() }`);
    }
  } catch {
    log('no cache yet');
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const tmp = `${ CACHE_FILE }.tmp`;

    fs.writeFileSync(tmp, JSON.stringify({ at: state.at, work: state.work, errors: state.errors }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) {
    log(`cache not saved: ${ e.message }`);
  }
}

function snapshot() {
  return {
    type: 'work', at: state.at, work: state.work, errors: state.errors, refreshing: state.refreshing
  };
}

function send(socket, text) {
  try {
    socket.write(textFrame(text));
  } catch {
    sockets.delete(socket);
  }
}

function broadcast() {
  const text = JSON.stringify(snapshot());

  for (const socket of sockets) {
    send(socket, text);
  }
}

async function refresh(reason) {
  if (state.refreshing) {
    return false;
  }
  state.refreshing = true;
  state.reason = reason;
  broadcast();
  try {
    const tok = token();

    if (!tok) {
      state.errors = ['No GitHub token: GH_TOKEN_DEV_EXTENSION is not in the conversation-env Secret.'];

      return true;
    }
    const jobs = PROJECTS.flatMap((p) => SECTIONS.map((section) => ({ p, section })));
    const results = new Array(jobs.length);
    let next = 0;
    const one = async({ p, section }) => {
      const query = sectionQuery(p.repos, section);

      try {
        return shapeSection(section, await askGithub(tok, query));
      } catch (e) {
        if (!/ 50[234]\b/.test(e.message)) {
          throw e;
        }
        await sleep(1500);

        return shapeSection(section, await askGithub(tok, query));
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, async() => {
      while (next < jobs.length) {
        const i = next++;

        results[i] = await one(jobs[i]).then((value) => ({ value }), (error) => ({ error }));
      }
    }));
    state.errors = results.map((r, i) => (r.error ? `${ jobs[i].p.name } ${ jobs[i].section }: ${ r.error.message }` : '')).filter(Boolean);
    lastAnswers = jobs.map((_, i) => results[i].value || lastAnswers[i] || null);
    if (lastAnswers.some(Boolean)) {
      state.work = mergeWork(lastAnswers);
      state.at = Date.now();
      saveCache();
    }
    log(`refreshed (${ reason }): ${ state.work.mine.length } mine, ${ state.work.reviewing.length } reviewing, ${ state.work.issues.length } issues${ state.errors.length ? `; errors: ${ state.errors.join(' | ') }` : '' }`);

    return true;
  } finally {
    state.refreshing = false;
    broadcast();
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') {
    res.writeHead(200);

    return res.end('ok');
  }
  if (url.pathname === '/work' && req.method === 'GET') {
    return json(res, 200, snapshot());
  }
  if (url.pathname === '/refresh' && req.method === 'POST') {
    const wait = MIN_REFRESH_MS - (Date.now() - state.at);

    if (state.refreshing) {
      return json(res, 202, { started: true, refreshing: true });
    }
    if (wait > 0) {
      return json(res, 200, { started: false, at: state.at, retryInMs: wait });
    }
    refresh(url.searchParams.get('reason') || 'asked');

    return json(res, 202, { started: true });
  }
  json(res, 404, { error: 'not found' });
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];

  if (url.pathname !== '/ws' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');

    return;
  }
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${ acceptKey(key) }`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  sockets.add(socket);
  send(socket, JSON.stringify(snapshot()));
  let pending = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    const { frames, rest } = readFrames(Buffer.concat([pending, chunk]));

    pending = rest;
    for (const f of frames) {
      if (f.opcode === 0x8) {
        sockets.delete(socket);
        socket.end(frame(0x8));
      } else if (f.opcode === 0x9) {
        socket.write(frame(0xa, f.payload));
      }
    }
  });
  const gone = () => sockets.delete(socket);

  socket.on('close', gone);
  socket.on('error', gone);
});

// A frame now and then, so a proxy between here and the page does not close a quiet socket.
setInterval(() => {
  for (const socket of sockets) {
    send(socket, '{"type":"heartbeat"}');
  }
}, HEARTBEAT_MS);

loadCache();
server.listen(PORT, () => log(`listening on ${ PORT }`));
setInterval(() => refresh('every 10 minutes'), EVERY_MS);
if (Date.now() - state.at > EVERY_MS) {
  refresh('start');
}

process.on('SIGTERM', () => {
  log('stopping');
  for (const socket of sockets) {
    socket.end(frame(0x8));
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
