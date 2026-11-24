/**
 * Conversation mode: the pane argv, tab titles, and the dashboard's rules.
 *
 * The argv is the contract with seed/shell.sh: $1 the session, $2 the working directory, $3 the
 * home, $4 what to run, $5 the tunnel, $6 (start mode) the CLI. The chat view reads the same
 * positions back to find the transcript (chat-conversation.ts, `workdir`), so a shift here would
 * show an empty chat.
 *
 * `node --test pkg/dev-extension/tests/*.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatCommand, chatStartCommand, nextChatTitle, CONVERSATION_REPO, CONVERSATION_SHELL, CONVERSATION_HOME
} from '../conversation-mode/config.mjs';
import {
  PROJECTS, SEARCH_TAIL, projectOf, subjectKey, shortRef, chatTitleFor, openingMessage, mergeWork,
  attentionRows, chatsBySubject, checksState, reviewState, pushedSinceReview, ago
} from '../conversation-mode/projects.mjs';

test('a chat runs claude in the repo, through conv-shell', () => {
  assert.deepEqual(chatCommand('p-lte-duty-3'), [
    '/bin/sh', '/seed/shell.sh', 'p-lte-duty-3',
    '/workspaces/.conversation/rancher-interrupt-duty', '/workspace/.home', 'claude',
    '/workspaces/.conversation/bin/conv-shell',
  ]);
});

test('the argv keeps shell.sh\'s positions', () => {
  const argv = chatCommand('p-lte-duty-1');
  const at = argv.indexOf('/seed/shell.sh');

  assert.equal(argv[at + 1], 'p-lte-duty-1');
  assert.equal(argv[at + 2], CONVERSATION_REPO);
  assert.equal(argv[at + 3], CONVERSATION_HOME);
  assert.equal(argv[at + 5], CONVERSATION_SHELL);
});

test('the mode passes through for agy, shell and start; anything else is claude', () => {
  assert.equal(chatCommand('p-lte-duty-1', 'agy')[5], 'agy');
  assert.equal(chatCommand('p-lte-duty-1', 'shell')[5], 'shell');
  assert.equal(chatCommand('p-lte-duty-1', 'start')[5], 'start');
  assert.equal(chatCommand('p-lte-duty-1', 'claude')[5], 'claude');
  assert.equal(chatCommand('p-lte-duty-1', '')[5], 'claude');
});

test('a detached start keeps the tunnel, and names the CLI only when there is one', () => {
  assert.deepEqual(chatStartCommand('p-lte-duty-2'), [
    '/bin/sh', '/seed/shell.sh', 'p-lte-duty-2', CONVERSATION_REPO, CONVERSATION_HOME, 'start', CONVERSATION_SHELL,
  ]);
  assert.equal(chatStartCommand('p-lte-duty-2', 'agy')[7], 'agy');
});

test('the repo\'s transcript directory is the one claude names', () => {
  // claude replaces every / and . in the working directory with -, and so does chat.ts's
  // projectKey: the dot in .conversation is why this is worth pinning.
  assert.equal(CONVERSATION_REPO.replace(/[/.]/g, '-'), '-workspaces--conversation-rancher-interrupt-duty');
});

test('a new tab takes the next title nobody has', () => {
  assert.equal(nextChatTitle([]), 'Chat 1');
  assert.equal(nextChatTitle(['Chat 1']), 'Chat 2');
  assert.equal(nextChatTitle(['Chat 2', 'Chat 3']), 'Chat 4');
  assert.equal(nextChatTitle(['Review 1240', 'Chat 2']), 'Chat 3');
});

test('every project\'s search stays under GitHub\'s 256-character cap', () => {
  for (const p of PROJECTS) {
    const q = p.repos.map((r) => `repo:${ r }`).join(' ') + SEARCH_TAIL;

    assert.ok(q.length <= 256, `${ p.id } is ${ q.length } characters`);
  }
});

test('repositories map to their product', () => {
  assert.equal(projectOf('harvester/harvester-ui-extension'), 'harvester');
  assert.equal(projectOf('rancher/dashboard'), 'rancher');
  assert.equal(projectOf('longhorn/longhorn-ui'), 'longhorn');
  assert.equal(projectOf('someone/else'), '');
});

test('a chat started for a subject is named for it and opens with its link', () => {
  const s = {
    repo: 'harvester/harvester-ui-extension', number: 1233, kind: 'pr', url: 'https://github.com/harvester/harvester-ui-extension/pull/1233', title: 'VNC console redesign on Rancher components, with the soft reboot and view only'
  };

  assert.equal(shortRef(s.repo, s.number), 'harvester-ui-extension#1233');
  assert.ok(chatTitleFor(s).startsWith('harvester-ui-extension#1233 VNC console'));
  assert.ok(chatTitleFor(s).length <= 60);
  assert.ok(chatTitleFor(s).endsWith('…'));
  assert.ok(openingMessage(s).includes(s.url));
  assert.ok(openingMessage({ ...s, kind: 'issue' }).includes('the issue'));
});

const pr = (o) => ({
  key: `${ o.repo || 'rancher/dashboard' }#${ o.number }`, repo: 'rancher/dashboard', title: `PR ${ o.number }`, url: `https://x/${ o.number }`, author: 'someone', draft: false, approved: false, reviewDecision: '', checks: { state: 'SUCCESS', failing: 0, pending: 0, total: 3 }, updatedAt: '2026-11-18T10:00:00Z', pushedAt: '', reviewedAt: '', reviewRequested: false, ...o,
});

test('merged answers keep each list without repeats', () => {
  const a = { login: 'me', mine: [pr({ number: 1 })], reviewing: [], issues: [] };
  const b = { login: 'me', mine: [pr({ number: 1 }), pr({ number: 2 })], reviewing: [pr({ number: 3 })], issues: [] };
  const m = mergeWork([a, null, b]);

  assert.deepEqual(m.mine.map((x) => x.number), [1, 2]);
  assert.equal(m.reviewing.length, 1);
  assert.equal(m.login, 'me');
});

test('checks and review in a word', () => {
  assert.equal(checksState(pr({ number: 1 })), 'passing');
  assert.equal(checksState(pr({ number: 1, checks: { failing: 2, pending: 0, total: 5 } })), 'failing');
  assert.equal(checksState(pr({ number: 1, checks: { failing: 0, pending: 1, total: 5 } })), 'pending');
  assert.equal(checksState(pr({ number: 1, checks: null })), 'none');
  assert.equal(reviewState(pr({ number: 1, draft: true })), 'draft');
  assert.equal(reviewState(pr({ number: 1, reviewDecision: 'CHANGES_REQUESTED' })), 'changes');
  assert.equal(reviewState(pr({ number: 1, approved: true })), 'approved');
  assert.equal(reviewState(pr({ number: 1 })), 'waiting');
  assert.equal(pushedSinceReview(pr({ number: 1, reviewedAt: '2026-11-17T00:00:00Z', pushedAt: '2026-11-18T00:00:00Z' })), true);
  assert.equal(pushedSinceReview(pr({ number: 1, reviewedAt: '2026-11-18T00:00:00Z', pushedAt: '2026-11-17T00:00:00Z' })), false);
});

test('what needs you, most urgent first, with the chat that is on it', () => {
  const work = {
    mine: [
      pr({ number: 10, checks: { failing: 1, pending: 0, total: 4 } }),
      pr({ number: 11, approved: true }),
      pr({ number: 12 }),
    ],
    reviewing: [
      pr({ number: 20, reviewRequested: true }),
      pr({ number: 21, reviewedAt: '2026-11-17T00:00:00Z', pushedAt: '2026-11-18T00:00:00Z' }),
      pr({ number: 22, reviewedAt: '2026-11-18T00:00:00Z', pushedAt: '2026-11-17T00:00:00Z' }),
      pr({ number: 23, reviewRequested: true, reviewedAt: '2026-11-17T00:00:00Z', pushedAt: '2026-11-18T00:00:00Z' }),
    ],
    issues: [],
  };
  const chats = [{ id: 'p-lte-duty-1', title: 'Chat 1' }, { id: 'p-lte-duty-2', title: 'dashboard#20' }];
  const links = { 'p-lte-duty-2': { subject: { repo: 'rancher/dashboard', number: 20 } } };
  const rows = attentionRows(work, chats, { 'p-lte-duty-1': 'input' }, links);

  assert.deepEqual(rows.map((r) => `${ r.kind }:${ r.subject?.number || r.chatId }`), [
    'question:p-lte-duty-1', 'blocked:10', 'review:20', 'rereview:23', 'ready:11', 'waiting:21',
  ]);
  assert.equal(rows.find((r) => r.kind === 'review').chatId, 'p-lte-duty-2');
  assert.equal(rows.find((r) => r.kind === 'blocked').why, '1 check failing');
});

test('a link to a chat that was closed finds nothing', () => {
  const links = { gone: { subject: { repo: 'rancher/dashboard', number: 5 } } };

  assert.deepEqual(chatsBySubject([], links), {});
  assert.equal(chatsBySubject([{ id: 'gone' }], links)[subjectKey('rancher/dashboard', 5)], 'gone');
});

test('ago reads as people say it', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');

  assert.equal(ago('2026-11-18T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-11-18T11:50:00Z', now), '10m ago');
  assert.equal(ago('2026-11-18T09:00:00Z', now), '3h ago');
  assert.equal(ago('2026-11-16T12:00:00Z', now), '2d ago');
  assert.equal(ago('', now), '');
});

// ── links and titles (linkify.mjs) ─────────────────────────────────────────────────────────────
import {
  extractUrls, githubRef, classifyUrl, chatLinks, titleFromMessage, isDefaultTitle
} from '../conversation-mode/linkify.mjs';

test('urls come out of prose without the punctuation around them', () => {
  assert.deepEqual(extractUrls('See https://github.com/a/b/pull/1. And (https://x.io/y), twice https://github.com/a/b/pull/1.'), [
    'https://github.com/a/b/pull/1', 'https://x.io/y',
  ]);
  assert.deepEqual(extractUrls('`https://c.d/e`'), ['https://c.d/e']);
});

test('a GitHub pull request or issue is found under any of its pages', () => {
  assert.deepEqual(githubRef('https://github.com/harvester/harvester-ui-extension/pull/1261/files#diff-1'), {
    repo: 'harvester/harvester-ui-extension', number: 1261, kind: 'pr', url: 'https://github.com/harvester/harvester-ui-extension/pull/1261'
  });
  assert.equal(githubRef('https://github.com/rancher/dashboard/issues/19000#issuecomment-1').kind, 'issue');
  assert.equal(githubRef('https://github.com/rancher/dashboard'), null);
});

test('links are named for what they are', () => {
  assert.deepEqual(classifyUrl('https://github.com/rancher/dashboard/pull/19830').label, 'dashboard#19830');
  assert.equal(classifyUrl('https://github.com/rancher/dashboard/actions/runs/123/job/9').kind, 'ci');
  assert.equal(classifyUrl('https://github.com/rancher/dashboard/actions/runs/123/job/9').url, 'https://github.com/rancher/dashboard/actions/runs/123');
  assert.deepEqual(classifyUrl('https://jira.suse.com/browse/SURE-12135').label, 'SURE-12135');
  assert.equal(classifyUrl('https://rancherpr1261r.mf-created-dashboard.ui.rancher.space/dashboard/').kind, 'preview');
  assert.equal(classifyUrl('https://rancherpr1261r.mf-created-dashboard.ui.rancher.space/dashboard/').label, 'pr1261');
  assert.equal(classifyUrl('https://pr1218-review-three.mf-main.ui.rancher.space/').kind, 'page');
  assert.equal(classifyUrl('https://mf-dev.ui.rancher.space/dashboard/').kind, 'env');
  assert.equal(classifyUrl('https://docs.harvesterhci.io/v1.6/').kind, 'doc');
  assert.equal(classifyUrl('https://example.com/a').kind, 'other');
});

test('a chat\'s chips: subject first, then previews and pages, one chip per thing', () => {
  const chips = chatLinks({
    subject: { url: 'https://github.com/harvester/harvester-ui-extension/pull/1261' },
    saved:   [{ label: 'review page', url: 'https://pr1261-review.mf-main.ui.rancher.space/' }],
    urls:    [
      'https://github.com/harvester/harvester-ui-extension/pull/1261/files',
      'https://rancherpr1261r.mf-created-dashboard.ui.rancher.space/dashboard/c/local',
      'https://rancherpr1261r.mf-created-dashboard.ui.rancher.space/dashboard/home',
      'https://github.com/harvester/harvester/issues/12350',
      'https://github.com/harvester/harvester-ui-extension/actions/runs/77',
    ],
  });

  assert.deepEqual(chips.map((c) => `${ c.kind }:${ c.label }`), [
    'subject:harvester-ui-extension#1261', 'preview:pr1261', 'page:review page', 'issue:harvester#12350', 'ci:harvester-ui-extension run',
  ]);
});

test('a title from the first thing the message says', () => {
  assert.equal(titleFromMessage('\n## Fix the **flaky** e2e on master\nmore'), 'Fix the flaky e2e on master');
  assert.equal(titleFromMessage('Look at https://github.com/a/b/pull/1 please'), 'Look at please');
  assert.ok(titleFromMessage('word '.repeat(40)).endsWith('…'));
  assert.ok(titleFromMessage('word '.repeat(40)).length <= 60);
  assert.equal(titleFromMessage('ok'), '');
  assert.equal(isDefaultTitle('Chat 3'), true);
  assert.equal(isDefaultTitle('Chat 3 review'), false);
});

test('a pasted image or file is not a title, and references become links', async() => {
  const { extractRefs } = await import('../conversation-mode/linkify.mjs');

  assert.equal(titleFromMessage('/workspace/.images/p-lte-duty-3/2026-11-18T16-20-31-603Z.jpg \nCan we check the PRs we have here'), 'Can we check the PRs we have here');
  assert.deepEqual(extractRefs('follow-up harvester/harvester#12350, and (rancher/dashboard#19830).'), [
    'https://github.com/harvester/harvester/issues/12350', 'https://github.com/rancher/dashboard/issues/19830',
  ]);
  assert.deepEqual(extractRefs('a path like src/app#3 inside code is also a ref; plain #12 is not'), ['https://github.com/src/app/issues/3']);
});

// ── conversation-api (server/) ─────────────────────────────────────────────────────────────────
import {
  sectionSearches, sectionQuery, checksOf, shapePr, shapeSection
} from '../conversation-mode/server/github.mjs';
import { acceptKey, frame, textFrame, readFrames } from '../conversation-mode/server/ws.mjs';

test('the server\'s searches stay under GitHub\'s 256-character cap, one query per section', () => {
  for (const p of PROJECTS) {
    for (const section of ['mine', 'reviewing', 'issues']) {
      for (const q of Object.values(sectionSearches(p.repos, section))) {
        assert.ok(q.length <= 256, `${ p.id } ${ section }: ${ q.length }`);
      }
      assert.ok(sectionQuery(p.repos, section).startsWith('query { viewer { login }'));
    }
  }
  assert.deepEqual(Object.keys(sectionSearches(['a/b'], 'reviewing')), ['requested', 'reviewed']);
});

const prNode = (o = {}) => ({
  number: 7, title: 'T', url: 'https://github.com/a/b/pull/7', isDraft: false, updatedAt: '2026-11-18T10:00:00Z', reviewDecision: '', author: { login: 'cody' }, repository: { nameWithOwner: 'a/b' },
  commits: { nodes: [{ commit: { committedDate: '2026-11-18T09:00:00Z', statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', state: 'ERROR' },
  ] } } } }] },
  latestOpinionatedReviews: { nodes: [] },
  reviews: { nodes: [{ author: { login: 'me' }, submittedAt: '2026-11-17T00:00:00Z' }, { author: { login: 'x' }, submittedAt: '2026-11-18T00:00:00Z' }] },
  ...o,
});

test('a pull request comes out in the shape the dashboard draws', () => {
  assert.deepEqual(checksOf(prNode()), {
    state: 'FAILURE', failing: 2, pending: 1, total: 4, failingNames: ['a check', 'a status']
  });
  const pr = shapePr(prNode({ latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }] } }), 'me', true);

  assert.equal(pr.key, 'a/b#7');
  assert.equal(pr.repo, 'a/b');
  assert.equal(pr.author, 'cody');
  assert.equal(pr.approved, true);
  assert.equal(pr.reviewedAt, '2026-11-17T00:00:00Z');
  assert.equal(pr.pushedAt, '2026-11-18T09:00:00Z');
  assert.equal(pr.reviewRequested, true);
  assert.equal(checksState(pr), 'failing');
  assert.equal(pushedSinceReview(pr), true);
});

test('a section answer: requested first, a reviewed one already requested not twice', () => {
  const data = {
    viewer: { login: 'me' }, requested: { nodes: [prNode({ number: 1 })] }, reviewed: { nodes: [prNode({ number: 1 }), prNode({ number: 2 })] }
  };
  const s = shapeSection('reviewing', data);

  assert.equal(s.login, 'me');
  assert.deepEqual(s.reviewing.map((p) => `${ p.number }:${ p.reviewRequested }`), ['1:true', '2:false']);
  assert.deepEqual(shapeSection('issues', { viewer: { login: 'me' }, issues: { nodes: [{ number: 3, title: 'I', url: 'u', repository: { nameWithOwner: 'a/b' }, milestone: { title: 'v2.17.0' }, labels: { nodes: [{ name: 'kind/bug' }] } }] } }).issues[0].milestone, 'v2.17.0');
});

test('the WebSocket handshake and frames, both ways', () => {
  // RFC 6455's own example.
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const long = 'x'.repeat(70000);

  for (const text of ['hi', 'y'.repeat(300), long]) {
    const { frames, rest } = readFrames(textFrame(text));

    assert.equal(frames[0].opcode, 1);
    assert.equal(frames[0].payload.toString(), text);
    assert.equal(rest.length, 0);
  }
  // A browser's frame is masked; a half-arrived one waits for the rest.
  const mask = Buffer.from([1, 2, 3, 4]);
  const payload = Buffer.from('ping!');
  const masked = Buffer.concat([Buffer.from([0x89, 0x80 | payload.length]), mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]);
  const half = readFrames(masked.subarray(0, 4));

  assert.equal(half.frames.length, 0);
  assert.equal(readFrames(masked).frames[0].payload.toString(), 'ping!');
  assert.equal(frame(0xa, payload)[0], 0x8a);
});

// ── the rail (rail.mjs) ───────────────────────────────────────────────────────────────────────
import { railSections, sectionOf, statusOf, filterRail } from '../conversation-mode/rail.mjs';

test('the rail: my work, my reviews, and the chats about nothing', () => {
  const work = {
    login:     'me',
    mine:      [pr({ number: 10, repo: 'rancher/dashboard', checks: { failing: 2, pending: 0, total: 5 } })],
    reviewing: [pr({ number: 20, repo: 'harvester/harvester-ui-extension', reviewRequested: true })],
    issues:    [{ key: 'rancher/dashboard#30', repo: 'rancher/dashboard', number: 30, title: 'Issue 30', milestone: 'v2.17.0', updatedAt: '2026-11-18T09:00:00Z' }],
  };
  const chats = [
    { id: 'p-lte-duty-1', title: 'dashboard#10 fix' },
    { id: 'p-lte-duty-2', title: 'dashboard#10 second look' },
    { id: 'p-lte-duty-3', title: 'harvester-ui-extension#20 review' },
    { id: 'p-lte-duty-4', title: 'dashboard#30 the issue' },
    { id: 'p-lte-duty-5', title: 'What is on fire today' },
    { id: 'p-lte-duty-6', title: 'old#7' },
  ];
  const links = {
    'p-lte-duty-1': { subject: { repo: 'rancher/dashboard', number: 10, kind: 'pr', url: 'u10' } },
    'p-lte-duty-2': { subject: { repo: 'rancher/dashboard', number: 10, kind: 'pr', url: 'u10' } },
    'p-lte-duty-3': { subject: { repo: 'harvester/harvester-ui-extension', number: 20, kind: 'pr', url: 'u20' } },
    'p-lte-duty-4': { subject: { repo: 'rancher/dashboard', number: 30, kind: 'issue', url: 'u30' } },
    'p-lte-duty-6': { subject: { repo: 'rancher/old', number: 7, kind: 'pr', url: 'u7', role: 'developer' } },
  };
  const rail = railSections(chats, links, work, { 'p-lte-duty-2': 'input', 'p-lte-duty-5': 'working' });
  const by = Object.fromEntries(rail.map((s) => [s.id, s.items]));

  assert.deepEqual(rail.map((s) => s.id), ['developer', 'reviewer', 'other', 'quiet', 'done']);
  assert.deepEqual(by.developer.map((i) => `${ i.ref }:${ i.chatIds.length }:${ i.activity }`), ['dashboard#10:2:input', 'dashboard#30:1:none']);
  assert.equal(by.developer[0].status.text, '2 checks failing');
  assert.equal(by.developer[1].status.text, 'Assigned · v2.17.0');
  // A pull request GitHub no longer lists as open is over, and keeps the role it had.
  assert.deepEqual(by.done.map((i) => `${ i.ref }:${ i.role }:${ i.status.text }`), ['old#7:developer:Closed or merged']);
  assert.deepEqual(by.reviewer.map((i) => `${ i.ref }:${ i.status.text }:${ i.status.stage }`), ['harvester-ui-extension#20:Your review:0']);
  assert.deepEqual(by.other.map((i) => `${ i.title }:${ i.activity }`), ['What is on fire today:working']);
  assert.equal(filterRail(rail, 'review')[1].items.length, 1);
  assert.equal(filterRail(rail, 'fire')[2].items.length, 1);
  assert.equal(filterRail(rail, 'fire')[0].items.length, 0);

  // Before GitHub answers, nothing is over; a cleared chat about nothing is.
  const early = railSections(chats, links, {}, {});

  assert.equal(early.find((s) => s.id === 'done').items.length, 0);
  const cleared = railSections(chats, { ...links, 'p-lte-duty-5': { cleared: true } }, work, {});

  assert.deepEqual(cleared.find((s) => s.id === 'done').items.map((i) => i.title).sort(), ['What is on fire today', 'old#7'].sort());

  // Archiving works for a pull request's chats too, once every chat of it is archived.
  const one = railSections(chats, { ...links, 'p-lte-duty-1': { ...links['p-lte-duty-1'], archived: true } }, work, {});

  assert.equal(one.find((s) => s.id === 'developer').items[0].ref, 'dashboard#10');
  const both = railSections(chats, {
    ...links, 'p-lte-duty-1': { ...links['p-lte-duty-1'], archived: true }, 'p-lte-duty-2': { ...links['p-lte-duty-2'], archived: true }
  }, work, {});
  const done = both.find((s) => s.id === 'done').items.find((i) => i.ref === 'dashboard#10');

  assert.equal(done.archived, true);
  assert.equal(done.status.text, 'Archived');
  assert.equal(done.role, 'developer');
});

test('a subject\'s section: GitHub first, then what was recorded, then its kind', () => {
  assert.equal(sectionOf(null, null), 'other');
  assert.equal(sectionOf({ kind: 'pr' }, { role: 'developer' }), 'developer');
  assert.equal(sectionOf({ kind: 'pr', role: 'developer' }, null), 'developer');
  assert.equal(sectionOf({ kind: 'issue' }, null), 'developer');
  assert.equal(sectionOf({ kind: 'pr' }, null), 'reviewer');
  assert.equal(statusOf('reviewer', { kind: 'pr' }, { kind: 'pr', item: pr({ number: 1, reviewedAt: '2026-11-17T00:00:00Z', pushedAt: '2026-11-18T00:00:00Z' }) }).text, 'Waiting review request');
  assert.equal(statusOf('reviewer', { kind: 'pr' }, { kind: 'pr', item: pr({ number: 1, reviewRequested: true, reviewedAt: '2026-11-17T00:00:00Z' }) }).text, 'Asked again');
  assert.equal(statusOf('developer', { kind: 'pr' }, { kind: 'pr', item: pr({ number: 1, reviewDecision: 'CHANGES_REQUESTED' }) }).stage, 4);
});

// ── software projects ─────────────────────────────────────────────────────────────────────────
import { CARDS, versionOf, nextMilestone, cardSummary } from '../conversation-mode/projects.mjs';

test('the next release is the lowest version with work open in it', () => {
  assert.deepEqual(versionOf('v2.16.0'), [2, 16, 0]);
  assert.deepEqual(versionOf('1.2.0'), [1, 2, 0]);
  assert.equal(versionOf('Planning'), null);
  assert.equal(versionOf('re-v0.1.1'), null);
  assert.deepEqual(nextMilestone([
    { title: 'v2.17.0', open: 493, closed: 10 }, { title: 'v2.12.15', open: 0, closed: 4 }, { title: 'v2.16.0', open: 16, closed: 300 }, { title: 'Planning', open: 879, closed: 0 },
  ]), { title: 'v2.16.0', open: 16, closed: 300 });
  assert.equal(nextMilestone([{ title: 'Backlog', open: 3 }]), null);
});

test('a card counts what needs you and the chats on its repository', () => {
  const card = CARDS.find((c) => c.id === 'harvester-ui');
  const attention = [
    { subject: { repo: 'harvester/harvester-ui-extension', number: 1, kind: 'pr' } },
    { subject: { repo: 'harvester/harvester', number: 2, kind: 'issue' } },
    { subject: { repo: 'rancher/dashboard', number: 3, kind: 'pr' } },
    { subject: null },
  ];
  const s = cardSummary(card, { build: 'passing', milestones: [{ title: 'v1.11.0', open: 12, closed: 3 }], bugs: 73 }, attention, [{ id: 'a' }, { id: 'b' }], { a: { subject: { repo: 'harvester/harvester-ui-extension' } } });

  assert.equal(s.needYou, 2);
  assert.equal(s.tasks, 1);
  assert.equal(s.release.title, 'v1.11.0');
  assert.equal(s.bugs, 73);
  assert.equal(cardSummary(card).known, false);
});

test('a project card\'s query and answer', async() => {
  const { projectQuery, shapeProject } = await import('../conversation-mode/server/github.mjs');
  const card = CARDS.find((c) => c.id === 'harvester-ui');
  const q = projectQuery(card);

  assert.ok(q.includes('code: repository(owner: "harvester", name: "harvester-ui-extension")'));
  assert.ok(q.includes('tracker: repository(owner: "harvester", name: "harvester")'));
  assert.ok(q.includes('labels: ["area/ui"]'));
  assert.ok(q.includes('repo:harvester/harvester is:issue is:open label:kind/bug label:area/ui'));
  assert.ok(!projectQuery(CARDS[0]).includes('labels: ['));
  assert.deepEqual(shapeProject(card, {
    code: { defaultBranchRef: { target: { statusCheckRollup: { state: 'FAILURE' } } } }, tracker: { milestones: { nodes: [{ title: 'v1.11.0', url: 'u', open: { totalCount: 12 }, closed: { totalCount: 3 } }] } }, bugs: { issueCount: 73 }
  }), { id: 'harvester-ui', build: 'failing', milestones: [{ title: 'v1.11.0', url: 'u', open: 12, closed: 3 }], bugs: 73 });
});

test('why a pull request is blocked: who asked for changes and what, which checks fail', async() => {
  const { blockedReason } = await import('../conversation-mode/projects.mjs');
  const { shapePr: shape } = await import('../conversation-mode/server/github.mjs');
  const node = prNode({
    reviewDecision: 'CHANGES_REQUESTED',
    latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'nwmac' }, body: '\n  Please keep the existing masthead.\nMore text.' }] },
  });
  node.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[1].name = 'e2e-test (chrome)';
  node.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[3].context = 'lint';
  const p = shape(node, 'me');

  assert.deepEqual(p.checks.failingNames, ['e2e-test (chrome)', 'lint']);
  assert.equal(blockedReason(p), 'Still on the changes @nwmac asked for: "Please keep the existing masthead." · Failing: e2e-test (chrome), lint');
  assert.equal(blockedReason(pr({ number: 1, checks: { failing: 1, pending: 0, total: 3 } })), '1 check failing');
});

test('why an approved pull request is not merged yet', async() => {
  const { readyReason } = await import('../conversation-mode/projects.mjs');

  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'DIRTY', mergeable: 'CONFLICTING' })), 'Approved, but it has merge conflicts');
  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' })), 'Approved, but it needs another approval');
  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'BLOCKED', reviewDecision: 'APPROVED' })), 'Approved, but a branch rule still blocks it (a required reviewer or check)');
  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'BEHIND' })), 'Approved, but its branch is behind the base');
  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'CLEAN' })), 'Approved and ready to merge');
  assert.equal(readyReason(pr({ number: 1, approved: true, mergeState: 'UNKNOWN' })), 'Approved');
  assert.equal(readyReason(pr({ number: 1, approved: true, checks: { failing: 0, pending: 2, total: 5 } })), 'Approved, checks still running');
});

// ── What an ongoing chat is doing (transcript-read.mjs), run the way the agent pod runs it ──────

async function readFake(lines) {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { TRANSCRIPT_READ } = await import('../conversation-mode/transcript-read.mjs');
  const root = mkdtempSync(join(tmpdir(), 'conv-read-'));
  const home = join(root, '.home');
  const uuid = '01234567-89ab-cdef-0123-456789abcdef';

  mkdirSync(join(root, 'sessions'), { recursive: true });
  mkdirSync(join(home, '.claude/projects/key'), { recursive: true });
  writeFileSync(join(root, 'sessions/p-1.id'), uuid);
  writeFileSync(join(home, `.claude/projects/key/${ uuid }.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));

  return JSON.parse(execFileSync('node', ['-e', TRANSCRIPT_READ, home, 'key', 'p-1', 'p-none']).toString())['p-1'];
}
const said = (who, content, at = '2026-11-18T10:00:00Z') => ({ type: who, timestamp: at, message: { content } });
const tool = (name, input) => ({ type: 'tool_use', name, input });

test('the reader says what the agent did last: its last tool, in a few words', async() => {
  const out = await readFake([
    said('user', 'Review https://github.com/rancher/rancher-ai-ui/pull/353'),
    said('assistant', [{ type: 'text', text: 'Looking at the PR first.' }, tool('Bash', { command: 'gh pr view 353', description: 'Read the PR' })]),
    said('user', [{ type: 'tool_result', content: 'https://example.com/not-a-link-anyone-chose' }]),
    said('assistant', [tool('Edit', { file_path: '/repo/pkg/ai/Install.vue' })], '2026-11-18T10:05:00Z'),
  ]);

  assert.equal(out.first, 'Review https://github.com/rancher/rancher-ai-ui/pull/353');
  assert.deepEqual(out.now, { text: 'Editing Install.vue', at: '2026-11-18T10:05:00Z' });
  assert.ok(!out.urls.includes('https://example.com/not-a-link-anyone-chose'));
});

test('the reader keeps the step the to-do list marks in progress, and a command without a description', async() => {
  const out = await readFake([
    said('user', 'go'),
    said('assistant', [tool('TodoWrite', {
      todos: [
        { content: 'Deploy', activeForm: 'Deploying the preview', status: 'completed' },
        { content: 'Test', activeForm: 'Testing the install', status: 'in_progress' },
      ]
    })]),
    said('assistant', [tool('Bash', { command: 'yarn jest pkg/ai\n--watch' })]),
  ]);

  assert.equal(out.step, 'Testing the install');
  assert.equal(out.now.text, '$ yarn jest pkg/ai');
});

test('the reader names the question the agent is asking, and an MCP tool by its own name', async() => {
  const asking = await readFake([said('assistant', [tool('AskUserQuestion', { questions: [{ question: 'Which backend?' }] })])]);
  const mcp = await readFake([said('assistant', [tool('mcp__claude_ai_Google_Drive__read_file_content', {})])]);

  assert.equal(asking.now.text, 'Asking: Which backend?');
  assert.equal(mcp.now.text, 'read_file_content');
});

test('doingText: only a chat that works or asks has something to say', async() => {
  const { doingText } = await import('../conversation-mode/transcript-read.mjs');
  const t = { now: { text: 'Editing Install.vue', at: '' }, step: 'Testing the install' };

  assert.equal(doingText(t, 'working'), 'Testing the install — Editing Install.vue');
  assert.equal(doingText({ now: t.now, step: '' }, 'working'), 'Editing Install.vue');
  assert.equal(doingText({ now: { text: 'Asking: Which backend?' }, step: 'Testing' }, 'input'), 'Asking: Which backend?');
  assert.equal(doingText(t, 'idle'), '');
  assert.equal(doingText(undefined, 'working'), '');
});

// ── Changes requested, asked again; drafts; archived chats ─────────────────────────────────────

test('changes requested and the review asked again of everyone who asked: off Needs your attention', async() => {
  const { changesAddressed } = await import('../conversation-mode/projects.mjs');
  const { statusOf } = await import('../conversation-mode/rail.mjs');
  const pr = (asked, failing = 0) => ({
    repo: 'harvester/docs', number: 1175, title: 'docs', url: 'u', updatedAt: '2026-11-18T10:00:00Z',
    reviewDecision: 'CHANGES_REQUESTED', changesBy: [{ login: 'sushant-suse', said: 'nits', asked }],
    checks: { total: 3, failing, pending: 0, failingNames: failing ? ['netlify'] : [] },
  });

  assert.equal(changesAddressed(pr(true)), true);
  assert.equal(changesAddressed(pr(false)), false);
  // The page's own myWork() does not say who was asked: still yours, as before.
  assert.equal(changesAddressed({ ...pr(true), changesBy: [] }), false);

  assert.deepEqual(attentionRows({ mine: [pr(true)] }), []);
  assert.equal(attentionRows({ mine: [pr(false)] })[0].why, 'Still on the changes @sushant-suse asked for: "nits"');
  assert.equal(attentionRows({ mine: [pr(true, 1)] })[0].why, 'Review asked again of @sushant-suse · Failing: netlify');

  const found = (p) => ({ kind: 'pr', role: 'developer', item: p });

  assert.deepEqual(statusOf('developer', { kind: 'pr' }, found(pr(true))), { text: 'Review asked again', tone: '', stage: 3 });
  assert.deepEqual(statusOf('developer', { kind: 'pr' }, found(pr(false))), { text: 'Still on suggested changes', tone: 'warn', stage: 4 });
});

test('a review of a draft is marked draft, and comes after the other reviews', () => {
  const pr = (number, draft) => ({
    repo: 'rancher/rancher-ai-ui', number, title: `pr ${ number }`, url: 'u', author: 'torchiaf', reviewRequested: true, draft, updatedAt: `2026-11-1${ number % 10 }T10:00:00Z`,
  });
  const rows = attentionRows({ reviewing: [pr(256, true), pr(353, false)] });

  assert.deepEqual(rows.map((r) => [r.subject.number, r.draft]), [[353, false], [256, true]]);
});

test('a reviewer\'s status says Draft first', async() => {
  const { statusOf } = await import('../conversation-mode/rail.mjs');
  const it = { reviewRequested: true, reviewedAt: '', draft: true };

  assert.deepEqual(statusOf('reviewer', { kind: 'pr' }, { kind: 'pr', role: 'reviewer', item: it }), { text: 'Draft · Your review', tone: 'warn', stage: 0 });
});

test('an archived chat asks nothing in Needs your attention', () => {
  const chats = [{ id: 'p-1', title: 'one' }, { id: 'p-2', title: 'two' }, { id: 'p-3', title: 'three' }];
  const rows = attentionRows({}, chats, { 'p-1': 'input', 'p-2': 'input', 'p-3': 'input' }, { 'p-2': { archived: true }, 'p-3': { cleared: true } });

  assert.deepEqual(rows.map((r) => r.chatId), ['p-1']);
});

// ── Nothing to do (nothing-to-do.mjs) ──────────────────────────────────────────────────────────

test('nothing to do: a mark holds until anything happens to the pull request', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const pr = {
    repo: 'rancher/rancher-ai-ui', number: 256, title: 'e2e', url: 'u', author: 'torchiaf', reviewRequested: true, draft: true, updatedAt: '2026-08-07T10:00:00Z',
  };
  const row = () => attentionRows({ reviewing: [pr] })[0];
  const doc = N.mark(N.emptyMarks(), row(), 'Draft - not ready for review yet', '2026-11-18T18:00:00Z');

  assert.equal(N.isQuiet(row(), doc), true);
  // A comment moves updatedAt; out of draft changes the stamp too; a new kind of row is a new row.
  pr.updatedAt = '2026-11-18T19:00:00Z';
  assert.equal(N.isQuiet(row(), doc), false);
  pr.updatedAt = '2026-08-07T10:00:00Z';
  pr.draft = false;
  assert.equal(N.isQuiet(row(), doc), false);
  pr.draft = true;
  pr.checks = { total: 2, failing: 1, failingNames: ['e2e'] };
  assert.equal(N.isQuiet(row(), doc), false);

  assert.deepEqual(N.unmark(doc, row().key).marks, {});
});

test('nothing to do: a question holds until its agent does something', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const row = { kind: 'question', key: 'chat:p-1', stamp: N.questionStamp({ now: { at: '2026-11-18T10:00:00Z' } }) };
  const doc = N.mark(N.emptyMarks(), row, 'Answered elsewhere');

  assert.equal(N.isQuiet(row, doc), true);
  assert.equal(N.isQuiet({ ...row, stamp: N.questionStamp({ now: { at: '2026-11-18T10:05:00Z' } }) }, doc), false);
  assert.equal(N.suggestion(row, doc), null);
});

test('nothing to do: suggested for rows like ones marked before, and for a draft\'s review', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const blocked = (number, author, failing) => ({
    kind: 'blocked', key: `rancher/dashboard#${ number }`, stamp: `s${ number }`, author, subject: { repo: 'rancher/dashboard', number }, why: `Failing: ${ failing }`,
  });
  const doc = N.mark(N.emptyMarks(), blocked(1, 'someone', 'Description'), 'The description check is the gate - fixed in the PR body', 'a');

  assert.deepEqual(N.suggestion(blocked(2, 'other', 'Description'), doc), { reason: 'The description check is the gate - fixed in the PR body', from: 'learned' });
  assert.equal(N.suggestion(blocked(3, 'other', 'unit-test'), doc), null);
  assert.deepEqual(N.suggestion({ kind: 'review', key: 'k', draft: true, author: 'x', why: 'From x' }, N.emptyMarks()), { reason: N.DRAFT_REASON, from: 'draft' });
  // What was taught beats the built-in one.
  const taught = N.mark(N.emptyMarks(), { kind: 'review', key: 'a', draft: true, author: 'torchiaf', why: 'From torchiaf' }, 'His drafts are e2e scratch work');

  assert.equal(N.suggestion({ kind: 'review', key: 'b', draft: true, author: 'torchiaf', why: 'From torchiaf' }, taught).reason, 'His drafts are e2e scratch work');
});

test('nothing to do: the reasons offered are the most used first, then the starters', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const doc = N.emptyMarks();

  N.mark(doc, { kind: 'review', key: 'a' }, 'Not mine to do', '2026-11-18T10:00:00Z');
  N.mark(doc, { kind: 'review', key: 'b' }, 'Bot bump, the team takes it', '2026-11-18T10:01:00Z');
  N.mark(doc, { kind: 'review', key: 'c' }, 'Bot bump, the team takes it', '2026-11-18T10:02:00Z');
  // Used as often as "Not mine to do", more lately: first of the two.
  N.mark(doc, { kind: 'review', key: 'd' }, '   ', '2026-11-18T10:03:00Z');

  assert.deepEqual(N.reasonList(doc).slice(0, 4), ['Bot bump, the team takes it', 'Checked - nothing to do', 'Not mine to do', 'Draft - not ready for review yet']);
  assert.equal(doc.marks.d.reason, 'Checked - nothing to do');
});

test('nothing to do: old marks of rows that are gone are forgotten, live ones kept', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const doc = N.emptyMarks();

  N.mark(doc, { kind: 'review', key: 'gone' }, 'x', '2026-01-01T00:00:00Z');
  N.mark(doc, { kind: 'review', key: 'live' }, 'x', '2026-01-01T00:00:00Z');
  N.mark(doc, { kind: 'review', key: 'recent' }, 'x', '2026-11-17T00:00:00Z');
  N.prune(doc, new Set(['live']), Date.parse('2026-11-18T00:00:00Z'));

  assert.deepEqual(Object.keys(doc.marks).sort(), ['live', 'recent']);
});

test('pushed since you asked for changes, not asked again: Waiting review request, the author\'s move', () => {
  const rows = attentionRows({
    reviewing: [{
      repo: 'rancher/rancher-ai-ui', number: 319, title: 'Implement notifications', url: 'u', author: 'torchiaf',
      reviewRequested: false, reviewedAt: '2026-11-17T00:00:00Z', pushedAt: '2026-11-18T17:40:00Z', myReview: 'CHANGES_REQUESTED',
    }],
  });

  assert.equal(rows[0].kind, 'waiting');
  assert.equal(rows[0].why, 'torchiaf pushed since you asked for changes - not asked again yet');
});

// ── Reviewers and the PR checklist (server/github.mjs) ──────────────────────────────────────────

test('reviewers as GitHub\'s Reviewers box shows them: asked again outranks what they said', async() => {
  const { reviewersOf } = await import('../conversation-mode/server/github.mjs');
  const node = {
    author: { login: 'torchiaf' },
    reviews: { nodes: [
      { author: { login: 'copilot' }, state: 'COMMENTED' },
      { author: { login: 'torchiaf' }, state: 'COMMENTED' },
      { author: { login: 'marcelofukumoto' }, state: 'CHANGES_REQUESTED' },
    ] },
    latestOpinionatedReviews: { nodes: [
      { author: { login: 'marcelofukumoto' }, state: 'CHANGES_REQUESTED' },
      { author: { login: 'codyrancher' }, state: 'APPROVED' },
      { author: { login: 'sushant-suse' }, state: 'CHANGES_REQUESTED' },
    ] },
    reviewRequests: { nodes: [
      { requestedReviewer: { __typename: 'User', login: 'oboc-sts' } },
      { requestedReviewer: { __typename: 'User', login: 'sushant-suse' } },
      { requestedReviewer: { __typename: 'Team', slug: 'dev' } },
    ] },
  };

  assert.deepEqual(reviewersOf(node), [
    { login: 'marcelofukumoto', state: 'changes' },
    { login: 'oboc-sts', state: 'pending' },
    { login: 'sushant-suse', state: 'pending' },
    { login: 'team:dev', state: 'pending', team: true },
    { login: 'codyrancher', state: 'approved' },
    { login: 'copilot', state: 'commented' },
  ]);
});

test('the Description check names the unticked checklist box', async() => {
  const { uncheckedBoxes } = await import('../conversation-mode/server/github.mjs');
  const { blockedReason } = await import('../conversation-mode/projects.mjs');
  const body = '## Checklist\n- [x] The PR has a Milestone\n- [ ] The PR has reviewed with UX and tested in light and dark mode, or there are no UX changes\n  - [ ] nested too\n* [X] done';

  assert.deepEqual(uncheckedBoxes(body), ['The PR has reviewed with UX and tested in light and dark mode, or there are no UX changes', 'nested too']);
  assert.equal(blockedReason({
    checks: {
      total: 5, failing: 1, failingNames: ['Description']
    },
    unchecked: uncheckedBoxes(body).slice(0, 1),
  }), 'Failing: Description · Unticked: "The PR has reviewed with UX and tested in light and dark mode, or there are no UX changes"');
});

test('nothing to do: a marked item goes to the rail\'s Nothing to do section until it changes', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const { railSections } = await import('../conversation-mode/rail.mjs');
  const pr = {
    repo: 'rancher/rancher-ai-ui', number: 256, title: 'e2e', url: 'u', author: 'torchiaf', reviewRequested: true, draft: true, updatedAt: '2026-08-07T10:00:00Z',
  };
  const work = { login: 'me', mine: [], reviewing: [pr], issues: [] };
  const chats = [{ id: 'p-1', title: 'rancher-ai-ui#256' }];
  const links = { 'p-1': { subject: { repo: 'rancher/rancher-ai-ui', number: 256, kind: 'pr' } } };
  const rows = () => N.withQuestionStamps(attentionRows(work, chats, {}, links), {});
  const doc = N.mark(N.emptyMarks(), rows()[0], 'Draft - not ready for review yet');
  const where = () => railSections(chats, links, work, {}, N.quietKeys(rows(), doc)).find((s) => s.items.length).id;

  assert.equal(where(), 'quiet');
  pr.updatedAt = '2026-11-18T19:00:00Z';
  assert.equal(where(), 'reviewer');
});

test('nothing to do: on your own pull requests the author is no likeness - only the same reason is', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const mine = (number, why) => ({
    kind: 'blocked', key: `rancher/dashboard#${ number }`, stamp: 's', author: 'marcelofukumoto', subject: { repo: 'rancher/dashboard', number }, why,
  });
  const doc = N.mark(N.emptyMarks(), mine(18229, 'Failing: Description, validate, unit-test (+8 more)'), 'Waiting on someone else');

  assert.equal(N.suggestion(mine(19887, 'Failing: Description · Unticked: "UX"'), doc), null);
  assert.equal(N.suggestion(mine(19999, 'Failing: Description, validate, unit-test (+3 more)'), doc).reason, 'Waiting on someone else');
});

// ── Repositories you maintain ──────────────────────────────────────────────────────────────────

test('maintained repositories: every open pull request is fetched, and none is a row unless asked of you', async() => {
  const { sectionSearches, shapeSection } = await import('../conversation-mode/server/github.mjs');
  const { MAINTAINED, PROJECTS: P } = await import('../conversation-mode/projects.mjs');
  const rancher = P.find((p) => p.id === 'rancher').repos;

  assert.deepEqual(sectionSearches(rancher, 'maintained', MAINTAINED), { maintained: 'repo:rancher/ui-locales is:open is:pr -author:@me archived:false' });
  assert.equal(Object.keys(sectionSearches(rancher, 'reviewing', MAINTAINED)).join(','), 'requested,reviewed');

  const node = (number, author) => ({
    number, title: `pr ${ number }`, url: 'u', author: { login: author }, repository: { nameWithOwner: 'rancher/ui-locales' }, updatedAt: '2026-11-19T08:00:00Z'
  });
  const answer = shapeSection('maintained', { viewer: { login: 'me' }, maintained: { nodes: [node(87, 'app/github-actions'), node(85, 'app/dependabot')] } });

  assert.deepEqual(answer.reviewing.map((p) => [p.number, p.maintained]), [[87, true], [85, true]]);

  // Asked of you as well: the review row (mergeWork keeps the first answer); the rest wait for a
  // process of their own - pushed to since your review or not.
  const asked = { ...answer.reviewing[0], maintained: false, reviewRequested: true };
  const reviewed = { ...answer.reviewing[1], reviewedAt: '2026-11-18T08:00:00Z', pushedAt: '2026-11-19T08:00:00Z', myReview: 'COMMENTED' };
  const work = mergeWork([{ login: 'me', reviewing: [asked] }, { ...answer, reviewing: [answer.reviewing[0], reviewed] }]);

  assert.deepEqual(attentionRows(work).map((r) => `${ r.kind }:${ r.subject.number }`), ['review:87']);
});

test('nothing to do: a reason renamed carries its rows and what was learned; deleted, it is offered no more', async() => {
  const N = await import('../conversation-mode/nothing-to-do.mjs');
  const doc = N.emptyMarks();
  const review = (key, author) => ({
    kind: 'review', key, stamp: 's', author, why: `From ${ author }`
  });

  N.mark(doc, review('a', 'dependabot'), 'Usually we dont merge the DOC PRs', '2026-11-18T10:00:00Z');
  N.mark(doc, review('b', 'dependabot'), 'Not mine to do', '2026-11-18T11:00:00Z');

  N.renameReason(doc, 'Usually we dont merge the DOC PRs', 'Docs PRs: not ours to merge');
  assert.equal(doc.marks.a.reason, 'Docs PRs: not ours to merge');
  assert.ok(!doc.reasons['Usually we dont merge the DOC PRs']);
  assert.equal(N.suggestion(review('c', 'dependabot'), doc).reason !== 'Usually we dont merge the DOC PRs', true);

  // Renamed onto one that exists: one reason, used as often as both.
  N.renameReason(doc, 'Docs PRs: not ours to merge', 'Not mine to do');
  assert.equal(doc.reasons['Not mine to do'].used, 2);
  assert.deepEqual(N.reasonsForEditing(doc)[0], { reason: 'Not mine to do', used: 2, marked: 2 });

  // Deleted: not offered, not suggested; the rows marked with it stay marked.
  N.removeReason(doc, 'Not mine to do');
  assert.ok(!N.reasonList(doc).includes('Not mine to do'));
  assert.equal(N.suggestion(review('d', 'dependabot'), doc), null);
  assert.equal(doc.marks.a.reason, 'Not mine to do');

  // A starter deleted stays deleted.
  N.removeReason(doc, 'Already handled');
  assert.ok(!N.reasonList(doc).includes('Already handled'));
});

// ── The chats, the one that moved last first ───────────────────────────────────────────────────

test('the reader says when the chat last moved: its newest message, or when a chat that never ran was made', async() => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { TRANSCRIPT_READ } = await import('../conversation-mode/transcript-read.mjs');
  const root = mkdtempSync(join(tmpdir(), 'conv-last-'));
  const home = join(root, '.home');
  const uuid = '01234567-89ab-cdef-0123-456789abcdef';

  mkdirSync(join(root, 'sessions/p-new'), { recursive: true });
  mkdirSync(join(home, '.claude/projects/key'), { recursive: true });
  writeFileSync(join(root, 'sessions/p-1.id'), uuid);
  writeFileSync(join(home, `.claude/projects/key/${ uuid }.jsonl`), [
    said('user', 'go', '2026-11-18T10:00:00Z'),
    said('assistant', [{ type: 'text', text: 'On it.' }], '2026-11-18T10:02:00Z'),
    { ...said('user', 'side', '2026-11-18T11:00:00Z'), isSidechain: true },
    said('user', [{ type: 'tool_result', content: 'ok' }], '2026-11-18T10:03:00Z'),
  ].map((l) => JSON.stringify(l)).join('\n'));
  const out = JSON.parse(execFileSync('node', ['-e', TRANSCRIPT_READ, home, 'key', 'p-1', 'p-new', 'p-none']).toString());

  assert.equal(out['p-1'].last, '2026-11-18T10:03:00Z');
  assert.ok(Date.parse(out['p-new'].last) > Date.now() - 60000, 'a chat that never ran: when its directory was made');
  assert.equal(out['p-none'].last, '');
});

test('the chats go newest first, on the dashboard and in every section of the rail, whatever their state', async() => {
  const { lastUpdated, byLastUpdated } = await import('../conversation-mode/rail.mjs');
  const chats = [
    { id: 'p-lte-duty-1', title: 'dashboard#10 fix' },
    { id: 'p-lte-duty-2', title: 'Old question' },
    { id: 'p-lte-duty-3', title: 'Fresh question' },
    { id: 'p-lte-duty-4', title: 'Just made' },
    { id: 'p-lte-duty-5', title: 'Not read yet' },
  ];
  const transcripts = {
    'p-lte-duty-1': { last: '2026-11-19T09:00:00Z' },
    'p-lte-duty-2': { last: '2026-11-17T09:00:00Z' },
    'p-lte-duty-3': { last: '2026-11-19T11:00:00Z' },
  };
  const lastAt = lastUpdated(chats, transcripts, { 'p-lte-duty-4': Date.parse('2026-11-19T12:00:00Z') });

  assert.deepEqual(byLastUpdated(chats, lastAt).map((c) => c.title), ['Just made', 'Fresh question', 'dashboard#10 fix', 'Old question', 'Not read yet']);

  // Waiting for you and working no longer jump the queue: the section is in last-moved order.
  const rail = railSections(chats, {}, { login: 'me' }, { 'p-lte-duty-2': 'input', 'p-lte-duty-1': 'working' }, new Set(), lastAt);

  assert.deepEqual(rail.find((s) => s.id === 'other').items.map((i) => i.title), ['Just made', 'Fresh question', 'dashboard#10 fix', 'Old question', 'Not read yet']);

  // An item with several chats moves with the newest of them.
  const links = {
    'p-lte-duty-1': { subject: { repo: 'rancher/dashboard', number: 10, kind: 'pr', url: 'u10' } },
    'p-lte-duty-2': { subject: { repo: 'rancher/dashboard', number: 10, kind: 'pr', url: 'u10' } },
    'p-lte-duty-3': { subject: { repo: 'rancher/dashboard', number: 30, kind: 'pr', url: 'u30' } },
  };
  const work = { login: 'me', mine: [pr({ number: 10, repo: 'rancher/dashboard' }), pr({ number: 30, repo: 'rancher/dashboard' })] };
  const mine = railSections(chats.slice(0, 3), links, work, {}, new Set(), { ...lastAt, 'p-lte-duty-2': Date.parse('2026-11-19T11:30:00Z') });

  assert.deepEqual(mine.find((s) => s.id === 'developer').items.map((i) => i.ref), ['dashboard#10', 'dashboard#30']);
});

// ── A link never keeps the punctuation the sentence put after it ───────────────────────────────

test('the reader leaves a sentence\'s punctuation off the URLs it collects', async() => {
  const out = await readFake([
    said('assistant', [{ type: 'text', text: 'The review is at https://pr353-review.13.48.147.135.sslip.io/, and CI at https://github.com/rancher/rancher-ai-ui/actions/runs/1; done.' }]),
  ]);

  assert.deepEqual(out.urls, ['https://pr353-review.13.48.147.135.sslip.io/', 'https://github.com/rancher/rancher-ai-ui/actions/runs/1']);
});

test('chips are made from clean URLs, whatever was collected or pinned before', async() => {
  const { chatLinks, cleanUrl } = await import('../conversation-mode/linkify.mjs');

  assert.equal(cleanUrl('https://x.io/a,'), 'https://x.io/a');
  assert.equal(cleanUrl('https://x.io/a?b=1.'), 'https://x.io/a?b=1');
  const chips = chatLinks({
    saved: [{ url: 'https://pr353-review.13.48.147.135.sslip.io/;' }],
    urls:  ['https://pr353-review.13.48.147.135.sslip.io/,', 'https://pr353-review.13.48.147.135.sslip.io/', ','],
  });

  assert.equal(chips.length, 1);
  assert.equal(chips[0].url, 'https://pr353-review.13.48.147.135.sslip.io/');
});

// ── GitHub's answer that never came whole ──────────────────────────────────────────────────────

test('askGithub: an empty or cut-off answer, a dropped connection and a 50x are worth asking again; a 401 is not', async() => {
  const { askGithub } = await import('../conversation-mode/server/github.mjs');
  const answer = (status, text) => async() => ({ ok: status < 300, status, text: async() => text });
  const fails = async(fetchImpl) => askGithub('t', '{ viewer { login } }', fetchImpl).then(() => null, (e) => e);

  assert.deepEqual(await askGithub('t', 'q', answer(200, '{"data":{"viewer":{"login":"me"}}}')), { viewer: { login: 'me' } });
  for (const [fetchImpl, message] of [
    [answer(200, ''), 'GitHub answered with nothing - the connection dropped.'],
    [answer(200, '{"data":{"vie'), 'GitHub\'s answer was cut short.'],
    [answer(502, ''), 'GitHub answered 502.'],
    [async() => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }, 'GitHub could not be reached (ECONNRESET).'],
  ]) {
    const e = await fails(fetchImpl);

    assert.equal(e.message, message);
    assert.equal(e.retriable, true, message);
  }
  const denied = await fails(answer(401, ''));

  assert.equal(denied.message, 'GitHub answered 401.');
  assert.ok(!denied.retriable);
  assert.equal((await fails(answer(200, '{"errors":[{"message":"Something went wrong"}]}'))).message, 'Something went wrong');
});

// ── A row says what its chats are doing ────────────────────────────────────────────────────────

test('activityBySubject: each issue or pull request takes the most urgent state of its chats', async() => {
  const { activityBySubject } = await import('../conversation-mode/rail.mjs');
  const chats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const links = {
    a: { subject: { repo: 'rancher/dashboard', number: 1 } },
    b: { subject: { repo: 'rancher/dashboard', number: 1 } },
    c: { subject: { repo: 'rancher/dashboard', number: 2 } },
    d: { subject: { repo: 'rancher/dashboard', number: 2 } },
    e: { subject: { repo: 'rancher/dashboard', number: 3 } },
  };
  const out = activityBySubject(chats, links, { a: 'idle', b: 'working', c: 'working', d: 'input' });

  // Waiting for you outranks working; working outranks idle; a chat with no state is not running.
  assert.deepEqual(out, { 'rancher/dashboard#1': 'working', 'rancher/dashboard#2': 'input', 'rancher/dashboard#3': 'none' });
  assert.deepEqual(activityBySubject(), {});
});

test('Needs your attention goes newest first: a row\'s chat or GitHub, whichever moved last', async() => {
  const { attentionByLastUpdated } = await import('../conversation-mode/rail.mjs');
  const rows = [
    { kind: 'question', key: 'chat:q', chatId: 'q', at: '' },
    { kind: 'blocked', key: 'rancher/dashboard#1', at: '2026-11-19T08:00:00Z' },
    { kind: 'review', key: 'rancher/dashboard#2', at: '2026-11-19T09:00:00Z' },
    { kind: 'review', key: 'rancher/dashboard#3', at: '2026-11-19T07:00:00Z' },
    { kind: 'ready', key: 'rancher/dashboard#4', at: '' },
  ];
  const chats = [{ id: 'q' }, { id: 'a' }, { id: 'b' }];
  const links = {
    a: { subject: { repo: 'rancher/dashboard', number: 3 } },
    b: { subject: { repo: 'rancher/dashboard', number: 3 } },
  };
  const ms = (iso) => Date.parse(iso);
  const out = attentionByLastUpdated(rows, chats, links, { q: ms('2026-11-19T08:30:00Z'), a: ms('2026-11-19T06:00:00Z'), b: ms('2026-11-19T10:00:00Z') });

  // #3's newest chat (10:00) beats GitHub's 09:00 on #2; the question's chat sits by its own time;
  // a row with no time at all goes last.
  assert.deepEqual(out.map((r) => r.key), ['rancher/dashboard#3', 'rancher/dashboard#2', 'chat:q', 'rancher/dashboard#1', 'rancher/dashboard#4']);
  assert.equal(out[0].chatUpdated, ms('2026-11-19T10:00:00Z'));
  assert.equal(out[1].chatUpdated, 0);
  assert.equal(out[1].updated, ms('2026-11-19T09:00:00Z'));
});

// ── Find work (pickup.mjs) ─────────────────────────────────────────────────────────────────────

test('find work: a tab is a project view or a search, and its GitHub address', async() => {
  const P = await import('../conversation-mode/pickup.mjs');

  assert.deepEqual(P.PICKUP_TABS.map((t) => t.id), ['longhorn', 'harvester', 'fleet', 'jira-bugs']);
  assert.equal(P.tabUrl(P.PICKUP_TABS[0]), 'https://github.com/orgs/rancher/projects/57/views/68');
  assert.equal(P.tabUrl(P.PICKUP_TABS[3]), 'https://github.com/issues?q=repo%3Arancher%2Fdashboard%20is%3Aissue%20state%3Aopen%20label%3AJIRA%20label%3Akind%2Fbug');
  // A view's filter goes to GitHub as a string, quotes and all.
  const q = P.projectItemsQuery({ org: 'rancher', number: 57 }, 'label:area/fleet -status:"Ice Box"', 'Y3Vyc29y');

  assert.ok(q.includes('query: "label:area/fleet -status:\\"Ice Box\\""'), q);
  assert.ok(q.includes('after: "Y3Vyc29y"'));
});

const pickupPr = (repo, number, state, extra = {}) => ({
  number, url: `https://github.com/${ repo }/pull/${ number }`, state, isDraft: false, repository: { nameWithOwner: repo }, author: { login: 'x' }, ...extra
});
const issueNode = (number, refs = {}) => ({
  number,
  title:      `Issue ${ number }`,
  url:        `https://github.com/rancher/dashboard/issues/${ number }`,
  state:      'OPEN',
  updatedAt:  '2026-11-20T00:00:00Z',
  repository: { nameWithOwner: 'rancher/dashboard' },
  milestone:  refs.milestone ? { title: refs.milestone } : null,
  labels:     { nodes: (refs.labels || []).map((name) => ({ name, color: 'fff' })) },
  assignees:  { nodes: [] },
  closedByPullRequestsReferences: { nodes: refs.closing || [] },
  timelineItems:                  { nodes: (refs.mentions || []).map(([p, willCloseTarget]) => ({ willCloseTarget, source: { __typename: 'PullRequest', ...p } })) },
});

test('find work: started is a fixing PR open or merged, or a Working / Review status', async() => {
  const P = await import('../conversation-mode/pickup.mjs');
  const s = (node, extra) => P.startedBy(P.shapeIssue(node, extra));

  assert.equal(s(issueNode(1)).started, false);
  assert.equal(s(issueNode(2, { closing: [pickupPr('rancher/dashboard', 10, 'MERGED')] })).started, true);
  assert.equal(s(issueNode(3, { closing: [pickupPr('rancher/dashboard', 11, 'CLOSED')] })).started, false, 'a closed, unmerged fix is no start');
  const mentioned = s(issueNode(4, { mentions: [[pickupPr('longhorn/longhorn-ui', 1099, 'OPEN'), false]] }));

  assert.equal(mentioned.started, false, 'an open PR that only mentions it: shown, as possibly started');
  assert.deepEqual(mentioned.possibly.map((p) => p.number), [1099]);
  const merged = s(issueNode(5, { mentions: [[pickupPr('rancher/dashboard', 12, 'MERGED'), false]] }));

  assert.equal(merged.started, false, 'a merged PR that only mentions it is not a fix');
  assert.deepEqual(merged.mentions.map((p) => p.number), [12]);
  assert.deepEqual(s(issueNode(6), { status: 'Working' }), {
    started: true, prs: [], status: 'Working', possibly: [], mentions: []
  });
  // The same PR as a closing reference and a mention is one PR, and it links.
  const both = P.shapeIssue(issueNode(7, { closing: [pickupPr('rancher/dashboard', 13, 'OPEN')], mentions: [[pickupPr('rancher/dashboard', 13, 'OPEN'), false]] }));

  assert.equal(both.prs.length, 1);
  assert.equal(both.prs[0].links, true);
});

test('find work: a PR made inside somebody\'s fork is no start', async() => {
  const P = await import('../conversation-mode/pickup.mjs');
  const inFork = pickupPr('aeltai/rancher', 3, 'OPEN', { repository: { nameWithOwner: 'aeltai/rancher', isFork: true } });
  const issue = P.shapeIssue(issueNode(13792, { mentions: [[inFork, false]] }));

  assert.deepEqual(issue.prs, []);
  assert.equal(P.startedBy(issue).started, false);
});

test('find work: only a fix or a status sets an issue aside - a mention never does, from anywhere', async() => {
  const P = await import('../conversation-mode/pickup.mjs');
  const st = (node) => P.startedBy(P.shapeIssue(node));

  assert.deepEqual(P.UI_REPOS, [
    'rancher/dashboard', 'rancher/rancher-ai-ui', 'rancher/ui-configurable-views', 'rancher/security-ui-exts', 'rancher/ui-locales', 'rancher/longhorn-ui-extension',
    'harvester/harvester-ui-extension', 'longhorn/longhorn-ui',
  ]);
  // The guard: whatever the repository and state, a PR that only mentions an issue keeps it in the list.
  for (const repo of [...P.UI_REPOS, 'rancher/rancher', 'harvester/harvester', 'harvester/docs', 'longhorn/longhorn', 'someone/elsewhere']) {
    for (const state of ['OPEN', 'MERGED', 'CLOSED']) {
      for (const isDraft of [false, true]) {
        assert.equal(st(issueNode(40, { mentions: [[pickupPr(repo, 1, state, { isDraft }), false]] })).started, false, `${ repo } ${ state }${ isDraft ? ' draft' : '' }`);
      }
    }
  }
  // What the table says instead: an open one in a UI repository is "possibly started"; the rest are mentions.
  const backend = st(issueNode(10215, { mentions: [[pickupPr('rancher/rancher', 52917, 'OPEN', { isDraft: true }), false]] }));

  assert.deepEqual([backend.possibly.length, backend.mentions.map((p) => p.number)], [0, [52917]]);
  assert.deepEqual(st(issueNode(32, { mentions: [[pickupPr('harvester/harvester-ui-extension', 1236, 'OPEN'), false]] })).possibly.map((p) => p.number), [1236]);
  // A PR that would close it does set it aside, from a backend repository too.
  assert.equal(st(issueNode(33, { closing: [pickupPr('rancher/rancher', 1, 'OPEN')] })).started, true);
  assert.equal(st(issueNode(34, { mentions: [[pickupPr('rancher/rancher', 2, 'MERGED'), true]] })).started, true, 'a timeline reference that will close it');
});

test('find work: a page keeps open issues only, with the project\'s status and priority', async() => {
  const P = await import('../conversation-mode/pickup.mjs');
  const page = P.shapeProjectItems({
    organization: {
      projectV2: {
        items: {
          totalCount: 3,
          pageInfo:   { hasNextPage: true, endCursor: 'c2' },
          nodes:      [
            { status: { name: 'Backlog' }, projectPriority: { name: 'priority/1' }, content: { __typename: 'Issue', ...issueNode(20, { milestone: 'v2.17.0' }) } },
            { status: { name: 'Backlog' }, content: { __typename: 'PullRequest', number: 21 } },
            { status: null, content: { __typename: 'Issue', ...issueNode(22), state: 'CLOSED' } },
          ],
        }
      }
    }
  });

  assert.deepEqual(page.issues.map((i) => [i.key, i.status, i.priority, i.milestone]), [['rancher/dashboard#20', 'Backlog', 'priority/1', 'v2.17.0']]);
  assert.equal(page.next, 'c2');
  // Without a project priority, a priority label does.
  assert.equal(P.shapeIssue(issueNode(23, { labels: ['kind/bug', 'priority/0'] })).priority, 'priority/0');
});

test('find work: milestones in version order, no milestone last', async() => {
  const P = await import('../conversation-mode/pickup.mjs');
  const issues = ['v2.18.0', '', 'v2.17.0', 'v1.11.0', 'v2.17.0', 'Planning'].map((milestone) => ({ milestone }));

  assert.deepEqual(P.milestonesOf(issues), [
    { title: 'Planning', count: 1 }, { title: 'v1.11.0', count: 1 }, { title: 'v2.17.0', count: 2 }, { title: 'v2.18.0', count: 1 }, { title: '', count: 1 },
  ]);
});

// ── The last message you sent a chat ──────────────────────────────────────────────────────────

test('the reader keeps the last message a person sent, not tool results, wrappers or interruptions', async() => {
  const out = await readFake([
    said('user', 'Review https://github.com/rancher/rancher-ai-ui/pull/355', '2026-11-23T09:00:00Z'),
    said('assistant', [{ type: 'text', text: 'On it.' }], '2026-11-23T09:01:00Z'),
    said('user', 'Should it include the optional third point?\nAnd post it as pending.', '2026-11-23T10:00:00Z'),
    said('user', [{ type: 'tool_result', content: 'ok' }], '2026-11-23T10:01:00Z'),
    said('user', '<command-name>/compact</command-name>', '2026-11-23T10:02:00Z'),
    said('user', '[Request interrupted by user]', '2026-11-23T10:03:00Z'),
    said('assistant', [{ type: 'text', text: 'Done.' }], '2026-11-23T10:04:00Z'),
  ]);

  assert.deepEqual(out.said, { text: 'Should it include the optional third point?\nAnd post it as pending.', at: '2026-11-23T10:00:00Z' });
});

// ── How many times you reviewed it (server/github.mjs myRounds, projects.mjs roundsText) ───────

test('a round is a review you posted; a thread reply and a pending review are not', async() => {
  const { myRounds } = await import('../conversation-mode/server/github.mjs');
  const review = (login, state, at, reply = false) => ({
    author: { login }, state, submittedAt: at, comments: { nodes: reply ? [{ replyTo: { id: 'c1' } }] : [] }
  });
  const node = {
    reviews: {
      nodes: [
        review('me', 'CHANGES_REQUESTED', '2026-11-19T14:50:00Z'),
        review('me', 'COMMENTED', '2026-11-24T12:45:00Z', true), // "Makes sense, thank you!" in a thread
        review('cody', 'COMMENTED', '2026-11-24T12:46:00Z'),
        review('me', 'COMMENTED', '2026-11-24T12:47:00Z'), // a round of comments, no verdict
        review('me', 'DISMISSED', '2026-11-24T12:48:00Z'),
        review('me', 'PENDING', null),
      ]
    }
  };

  assert.deepEqual(myRounds(node, 'me').map((r) => r.state), ['CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED']);
  assert.deepEqual(myRounds(node, ''), []);
  assert.deepEqual(myRounds({}, 'me'), []);
});

test('the count, in a line', async() => {
  const { roundsText, roundsTitle } = await import('../conversation-mode/projects.mjs');
  const now = Date.parse('2026-11-24T15:00:00Z');
  const two = [{ state: 'CHANGES_REQUESTED', at: '2026-11-19T14:50:00Z' }, { state: 'APPROVED', at: '2026-11-24T12:00:00Z' }];

  assert.equal(roundsText(undefined, now), '');
  assert.equal(roundsText([], now), 'Not reviewed by you yet');
  assert.equal(roundsText(two.slice(0, 1), now), 'Reviewed once · last changes requested 5d ago');
  assert.equal(roundsText(two, now), 'Reviewed twice · last approved 3h ago');
  assert.equal(roundsText([...two, ...two], now), 'Reviewed 4 times · last approved 3h ago');
  assert.equal(roundsTitle(two), '1. Changes requested, 2026-11-19\n2. Approved, 2026-11-24');
});

test('review rows carry the count; asked again reads red on the rail', async() => {
  const { statusOf: status, railSections: rail } = await import('../conversation-mode/rail.mjs');
  const rounds = [{ state: 'CHANGES_REQUESTED', at: '2026-11-19T14:50:00Z' }];
  const work = {
    login:     'me',
    mine:      [],
    issues:    [],
    reviewing: [
      pr({ number: 1, reviewRequested: true, reviewedAt: '2026-11-19T14:50:00Z', rounds }),
      pr({ number: 2, reviewRequested: true, rounds: [] }),
    ],
  };
  const rows = attentionRows(work);

  assert.deepEqual(rows.map((r) => [r.kind, r.rounds.length]), [['review', 0], ['rereview', 1]]);
  assert.equal(status('reviewer', { kind: 'pr' }, { kind: 'pr', item: work.reviewing[0] }).tone, 'alert');

  const links = { c1: { subject: { repo: 'rancher/dashboard', number: 1, kind: 'pr' } } };
  const item = rail([{ id: 'c1', title: 'x' }], links, work, {}).flatMap((s) => s.items)[0];

  assert.deepEqual(item.rounds, rounds);
});
