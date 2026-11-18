// Conversation mode: where its conversations run, and the argv a pane is started with.
//
// A conversation here is an ordinary agent-pod conversation (claude in a tmux pane, its
// transcript under the agent's home) registered under one workspace, CONVERSATION_WORKSPACE, so
// the registry, the state poll and the chat view all work unchanged. What differs is the argv:
// its working directory is the interrupt-duty repo, which lives outside every workspace tree
// (the seed's layout step rewrites `.claude/skills` inside one), and its commands go through
// conv-shell rather than the workspace's own bin/dev-shell, which would reset any working
// directory outside the workspace to its dashboard checkout. Both live on the node's
// /workspaces mount, so the agent pod and the workspace pod see them at the same path.
//
// shell.sh records a pane's argv when it first starts and replays it after a pod restart, so a
// conversation opened here keeps its directory and its tunnel from then on.

/** The workspace whose pod the commands run in, and whose name the conversations are under. */
export const CONVERSATION_WORKSPACE = 'lte-duty';

/** The node's directory for Conversation mode, mounted at the same path in every pod. */
export const CONVERSATION_ROOT = '/workspaces/.conversation';

/** The repo every conversation works in. */
export const CONVERSATION_REPO = `${ CONVERSATION_ROOT }/rancher-interrupt-duty`;

/** The command tunnel (CLAUDE_CODE_SHELL_PREFIX). */
export const CONVERSATION_SHELL = `${ CONVERSATION_ROOT }/bin/conv-shell`;

/** The agent pod's home for every conversation: one login. Same value as AGENT_HOME in config/constants.ts. */
export const CONVERSATION_HOME = '/workspace/.home';

/**
 * The argv a conversation's pane runs in the agent pod: shell.sh with the session id, the
 * working directory, the home, what to run, and the tunnel. `mode` is shell.sh's $4 -
 * `claude`, `agy` (the conversation is Antigravity's), `shell` or `start`; anything else, the
 * registry's empty CLI included, runs claude.
 */
export function chatCommand(id, mode = '') {
  const run = ['agy', 'shell', 'start'].includes(mode) ? mode : 'claude';

  return ['/bin/sh', '/seed/shell.sh', id, CONVERSATION_REPO, CONVERSATION_HOME, run, CONVERSATION_SHELL];
}

/**
 * The argv that starts a conversation's pane detached, with nobody attached: shell.sh in
 * `start` mode, the tunnel, and which CLI holds it ($6) when that is not claude. What
 * conversations.ts's startPaneDetached runs for one of these.
 */
export function chatStartCommand(id, cli = '') {
  return [...chatCommand(id, 'start'), ...(cli ? [cli] : [])];
}

/** The next free "Chat <n>" title, so a new tab never repeats one already in the strip. */
export function nextChatTitle(titles = []) {
  const taken = new Set(titles);
  let n = titles.length + 1;

  while (taken.has(`Chat ${ n }`)) {
    n++;
  }

  return `Chat ${ n }`;
}
