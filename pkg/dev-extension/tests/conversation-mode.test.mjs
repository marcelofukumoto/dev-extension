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
