// What a conversation sent off into the background and has not heard back from.
//
// A conversation whose own turn was over read idle while its review agents and preview builds
// ran; these pin how a launch is paired with the notice that ends it, and which launches count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingBackground, BACKGROUND_LIMIT_MS } from '../dev-api/background-work.mjs';

const NOW = Date.parse('2026-11-24T13:20:00Z');
const SINCE = NOW - 3600_000;
const at = (minutesAgo) => new Date(NOW - (minutesAgo * 60_000)).toISOString();

const use = (id, name, input = {}, extra = {}) => JSON.stringify({
  type: 'assistant', timestamp: at(30), message: { content: [{ type: 'tool_use', id, name, input }] }, ...extra,
});
const result = (id, text, minutesAgo = 30, extra = {}) => JSON.stringify({
  type: 'user', timestamp: at(minutesAgo), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...extra }] },
});
const notice = (toolUseId, taskId, status = 'completed') => JSON.stringify({
  type: 'queue-operation',
  content: `<task-notification>\n<task-id>${ taskId }</task-id>\n<tool-use-id>${ toolUseId }</tool-use-id>\n${ status ? `<status>${ status }</status>\n` : '' }<summary>done</summary>\n</task-notification>`,
});

const buildLaunch = [
  use('toolu_build', 'Bash', { command: 'preview/deploy-branch.sh', run_in_background: true }),
  result('toolu_build', 'Command running in background with ID: b30baj9mo. Output is being written to: /tmp/x.output'),
];
const agentLaunch = [
  use('toolu_review', 'Agent', { description: 'Pass B review', prompt: '...' }),
  result('toolu_review', [{ type: 'text', text: 'Async agent launched successfully. agentId: a2169b882ecd3c55e (internal ID)' }]),
];

test('a background command with no notice yet is pending; its notice ends it', () => {
  assert.deepEqual(pendingBackground(buildLaunch, SINCE, NOW).map((p) => [p.name, p.task]), [['Bash', 'b30baj9mo']]);
  assert.deepEqual(pendingBackground([...buildLaunch, notice('toolu_build', 'b30baj9mo')], SINCE, NOW), []);
  assert.deepEqual(pendingBackground([...buildLaunch, notice('toolu_build', 'b30baj9mo', 'failed')], SINCE, NOW), []);
});

test('an agent is background work whether or not it was asked to be', () => {
  // Every Agent call in these conversations comes back "Async agent launched", run_in_background
  // or not - the case rest-idle.mjs, which looks only at that flag, does not see.
  assert.equal(pendingBackground(agentLaunch, SINCE, NOW).length, 1);
  // Its notice can be matched by the task id alone.
  assert.equal(pendingBackground([...agentLaunch, notice('', 'a2169b882ecd3c55e')], SINCE, NOW).length, 0);
});

test('a monitor event is not its end', () => {
  const monitor = [use('toolu_watch', 'Monitor', { command: 'watch-ci.sh' }), result('toolu_watch', 'Monitoring started (task m1)')];
  const event = JSON.stringify({ type: 'queue-operation', content: '<task-notification>\n<task-id>m1</task-id>\n<summary>CI moved</summary>\n<event>pending</event>\n</task-notification>' });

  assert.equal(pendingBackground([...monitor, event], SINCE, NOW).length, 1);
  assert.equal(pendingBackground([...monitor, event, notice('toolu_watch', 'm1')], SINCE, NOW).length, 0);
});

test('work stopped by its task id is over', () => {
  const stop = use('toolu_stop', 'TaskStop', { task_id: 'b30baj9mo' });

  assert.equal(pendingBackground([...buildLaunch, stop], SINCE, NOW).length, 0);
});

test('only what the claude now in the pane launched counts', () => {
  // A `--resume` keeps the old lines, and their background work died with the old claude.
  assert.equal(pendingBackground(buildLaunch, NOW - (10 * 60_000), NOW).length, 0);
  // Not knowing when it started counts nothing - the safe direction is the old behaviour.
  assert.equal(pendingBackground(buildLaunch, 0, NOW).length, 0);
});

test('a launch that never reported back stops counting after the limit', () => {
  const old = [buildLaunch[0], result('toolu_build', 'Command running in background with ID: b1.', (BACKGROUND_LIMIT_MS / 60_000) + 5)];

  assert.equal(pendingBackground(old, NOW - (2 * BACKGROUND_LIMIT_MS), NOW).length, 0);
});

test('what is not a launch is not pending', () => {
  // A failed launch, a foreground command, and a subagent's own background work (its side of
  // the transcript is its business).
  const failed = [use('toolu_x', 'Bash', { run_in_background: true }), result('toolu_x', 'Command running in background with ID: bx.', 30, { is_error: true })];
  const plain = [use('toolu_y', 'Bash', { command: 'ls' }), result('toolu_y', 'a\nb')];
  const side = [use('toolu_z', 'Bash', { run_in_background: true }, { isSidechain: true }), JSON.stringify({ ...JSON.parse(result('toolu_z', 'Command running in background with ID: bz.')), isSidechain: true })];

  assert.equal(pendingBackground([...failed, ...plain, ...side, 'not json'], SINCE, NOW).length, 0);
});
