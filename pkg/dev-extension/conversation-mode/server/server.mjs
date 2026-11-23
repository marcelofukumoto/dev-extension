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
// And "Find work" (../pickup.mjs): the issues to pick up, per project view or search - asked when a
// page opens it (GET /pickup), kept for PICKUP_EVERY_MS, again on request at most once a minute.
//
// GitHub's token is the conversation-env Secret's GH_TOKEN_DEV_EXTENSION, mounted as a file and
// read on every refresh, so a rotated token is picked up without a restart. The pod has no
// Kubernetes API access at all (automountServiceAccountToken: false); see k8s.yaml.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROJECTS, CARDS, MAINTAINED, mergeWork
} from '../projects.mjs';
import {
  sectionQuery, shapeSection, projectQuery, shapeProject, askGithub
} from './github.mjs';
import {
  acceptKey, frame, textFrame, readFrames
} from './ws.mjs';
import {
  PICKUP_TABS, PICKUP_PAGES, viewQuery, projectItemsQuery, searchQuery, shapeProjectItems, shapeSearch, tabUrl
} from '../pickup.mjs';

const PORT = Number(process.env.PORT || 8080);
const ENV_FILE = process.env.ENV_FILE || '/etc/conversation/.env';
const CACHE_FILE = process.env.CACHE_FILE || '/workspaces/.conversation/cache/work.json';
const EVERY_MS = Number(process.env.EVERY_MS || 10 * 60 * 1000);
const MIN_REFRESH_MS = Number(process.env.MIN_REFRESH_MS || 60 * 1000);
const HEARTBEAT_MS = 25000;
const SECTIONS = ['mine', 'reviewing', 'issues'];
const CONCURRENCY = 2;
const PICKUP_EVERY_MS = Number(process.env.PICKUP_EVERY_MS || 15 * 60 * 1000);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const state = {
  at: 0, work: { login: '', mine: [], reviewing: [], issues: [] }, projects: [], errors: [], refreshing: false, reason: ''
};
/** The last good answer of each software project card (projects.mjs, CARDS), by card id. */
const lastProjects = {};
/** The last good answer of each product and section, so one that fails keeps what it had. */
let lastAnswers = [];
const sockets = new Set();
/** Find work: every tab's issues, and when they were asked for. */
const pickup = { at: 0, tabs: [], errors: [] };
let pickupRun = null;

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
      Object.assign(state, {
        at: cached.at, work: cached.work, projects: cached.projects || [], errors: cached.errors || []
      });
      for (const p of state.projects) {
        lastProjects[p.id] = p;
      }
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

    fs.writeFileSync(tmp, JSON.stringify({
      at: state.at, work: state.work, projects: state.projects, errors: state.errors
    }));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) {
    log(`cache not saved: ${ e.message }`);
  }
}

function snapshot() {
  return {
    type: 'work', at: state.at, work: state.work, projects: state.projects, errors: state.errors, refreshing: state.refreshing
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
    // Your work, per product and section, then the software project cards - one pool, two at a time.
    // The maintained search only for a product with a repository you maintain, and after its
    // review searches, so mergeWork keeps a pull request asked of you as that.
    const jobs = [
      ...PROJECTS.flatMap((p) => [...SECTIONS, ...(p.repos.some((r) => MAINTAINED.includes(r)) ? ['maintained'] : [])].map((section) => ({
        label: `${ p.name } ${ section }`, work: true, query: sectionQuery(p.repos, section, MAINTAINED), shape: (d) => shapeSection(section, d)
      }))),
      ...CARDS.map((card) => ({
        label: `${ card.name } project`, card, query: projectQuery(card), shape: (d) => shapeProject(card, d)
      })),
    ];
    const results = new Array(jobs.length);
    let next = 0;
    const one = async({ query, shape }) => {
      try {
        return shape(await askGithub(tok, query));
      } catch (e) {
        // Asked again once: a 50x, or an answer that never came whole (github.mjs, askGithub).
        if (!e.retriable) {
          throw e;
        }
        await sleep(1500);

        return shape(await askGithub(tok, query));
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, async() => {
      while (next < jobs.length) {
        const i = next++;

        results[i] = await one(jobs[i]).then((value) => ({ value }), (error) => ({ error }));
      }
    }));
    state.errors = results.map((r, i) => (r.error ? `${ jobs[i].label }: ${ r.error.message }` : '')).filter(Boolean);
    const workCount = jobs.filter((j) => j.work).length;

    lastAnswers = jobs.slice(0, workCount).map((_, i) => results[i].value || lastAnswers[i] || null);
    jobs.slice(workCount).forEach((job, j) => {
      const r = results[workCount + j];

      if (r.value) {
        lastProjects[job.card.id] = r.value;
      }
    });
    state.projects = CARDS.map((c) => lastProjects[c.id]).filter(Boolean);
    if (lastAnswers.some(Boolean)) {
      state.work = mergeWork(lastAnswers);
      state.at = Date.now();
      saveCache();
    }
    log(`refreshed (${ reason }): ${ state.work.mine.length } mine, ${ state.work.reviewing.length } reviewing, ${ state.work.issues.length } issues, ${ state.projects.length } projects${ state.errors.length ? `; errors: ${ state.errors.join(' | ') }` : '' }`);

    return true;
  } finally {
    state.refreshing = false;
    broadcast();
  }
}

/** Ask GitHub, and once more after a moment when the answer is worth asking again for (askGithub). */
async function askOnceMore(tok, query) {
  try {
    return await askGithub(tok, query);
  } catch (e) {
    if (!e.retriable) {
      throw e;
    }
    await sleep(1500);

    return askGithub(tok, query);
  }
}

/** One tab of Find work: a project view's items under the view's own filter, or a search; PICKUP_PAGES pages at most. */
async function fetchTab(tok, tab) {
  const issues = [];
  let filter = tab.search || '';
  let next = null;
  let total = 0;

  if (tab.project) {
    const view = (await askOnceMore(tok, viewQuery(tab.project)))?.organization?.projectV2?.view;

    if (!view) {
      throw new Error(`view ${ tab.project.view } of project ${ tab.project.number } was not found`);
    }
    filter = view.filter || '';
  }
  for (let page = 0; page < PICKUP_PAGES; page++) {
    const got = tab.project ? shapeProjectItems(await askOnceMore(tok, projectItemsQuery(tab.project, filter, next))) : shapeSearch(await askOnceMore(tok, searchQuery(tab.search, next)));

    issues.push(...got.issues);
    total = got.total;
    next = got.next;
    if (!next) {
      break;
    }
  }

  return {
    id: tab.id, name: tab.name, url: tabUrl(tab), filter, issues, total, truncated: !!next, error: ''
  };
}

/** Ask for every tab at once; one already being asked is the same answer. A tab that fails keeps what it had. */
function refreshPickup() {
  if (pickupRun) {
    return pickupRun;
  }
  pickupRun = (async() => {
    const tok = token();

    if (!tok) {
      pickup.errors = ['No GitHub token: GH_TOKEN_DEV_EXTENSION is not in the conversation-env Secret.'];

      return;
    }
    const results = await Promise.all(PICKUP_TABS.map((tab) => fetchTab(tok, tab).then((value) => ({ value }), (error) => ({ error }))));
    const before = Object.fromEntries(pickup.tabs.map((t) => [t.id, t]));

    pickup.tabs = PICKUP_TABS.map((tab, i) => results[i].value || {
      ...(before[tab.id] || {
        id: tab.id, name: tab.name, url: tabUrl(tab), filter: tab.search || '', issues: [], total: 0, truncated: false
      }),
      error: results[i].error.message,
    });
    pickup.errors = results.map((r, i) => (r.error ? `${ PICKUP_TABS[i].name }: ${ r.error.message }` : '')).filter(Boolean);
    pickup.at = Date.now();
    log(`find work: ${ pickup.tabs.map((t) => `${ t.id } ${ t.issues.length }`).join(', ') }${ pickup.errors.length ? `; errors: ${ pickup.errors.join(' | ') }` : '' }`);
  })().finally(() => {
    pickupRun = null;
  });

  return pickupRun;
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
  if (url.pathname === '/pickup' && req.method === 'GET') {
    const age = Date.now() - pickup.at;

    if (!pickup.at || age > PICKUP_EVERY_MS || (url.searchParams.get('refresh') === '1' && age > MIN_REFRESH_MS)) {
      refreshPickup().then(() => json(res, 200, { type: 'pickup', ...pickup }), (e) => json(res, 500, { error: String(e?.message || e) }));

      return;
    }

    return json(res, 200, { type: 'pickup', ...pickup });
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
