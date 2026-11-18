/**
 * Conversation mode's pane argv and tab titles.
 *
 * The argv is the contract with seed/shell.sh: $1 the session, $2 the working directory, $3 the
 * home, $4 what to run, $5 the tunnel. The chat view reads the same positions back to find the
 * transcript (chat-conversation.ts, `workdir`), so a shift here would show an empty chat.
 *
 * `node --test pkg/dev-extension/tests/*.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatCommand, nextChatTitle, CONVERSATION_REPO, CONVERSATION_SHELL, CONVERSATION_HOME
} from '../conversation-mode/config.mjs';

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

test('an agy conversation stays agy, anything else is claude', () => {
  assert.equal(chatCommand('p-lte-duty-1', 'agy')[5], 'agy');
  assert.equal(chatCommand('p-lte-duty-1', 'claude')[5], 'claude');
  assert.equal(chatCommand('p-lte-duty-1', '')[5], 'claude');
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
