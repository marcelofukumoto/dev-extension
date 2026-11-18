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
    ],
    issues: [],
  };
  const chats = [{ id: 'p-lte-duty-1', title: 'Chat 1' }, { id: 'p-lte-duty-2', title: 'dashboard#20' }];
  const links = { 'p-lte-duty-2': { subject: { repo: 'rancher/dashboard', number: 20 } } };
  const rows = attentionRows(work, chats, { 'p-lte-duty-1': 'input' }, links);

  assert.deepEqual(rows.map((r) => `${ r.kind }:${ r.subject?.number || r.chatId }`), [
    'question:p-lte-duty-1', 'blocked:10', 'review:20', 'rereview:21', 'ready:11',
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
