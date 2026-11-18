# This fork

marcelofukumoto/dev-extension is codyrancher/dev-extension plus a Conversation mode, published
as its own Helm repository at https://marcelofukumoto.github.io/dev-extension and installed on
mf-dev in place of the upstream chart (both register the same `dev` product, so only one can be
installed).

## Keeping it mergeable

Upstream changes almost daily, so our code stays out of its way:

- New code lives in new files. The edits to upstream files are kept small and listed here, so a
  merge conflict is one of these and nothing else.
- Merge upstream into `main` (`git fetch upstream && git merge upstream/main`), then set the
  version below again.

Our code: `pkg/dev-extension/conversation-mode/` and `pkg/dev-extension/tests/conversation-mode.test.mjs`.

Edits to upstream files, each marked with a comment naming this file:

- `pkg/dev-extension/routing/index.ts`: the Conversation route, `conversation/:view?` (an import, a
  lazy component, one route).
- `pkg/dev-extension/pages/DevShell.vue`: the Conversation entry in the Dev menu, and the route in
  `bare()` so it takes the window like Focus.
- `pkg/dev-extension/conversations.ts`: `paneCommand` and `startPaneDetached` return Conversation
  mode's argv for the `lte-duty` workspace, so a chat keeps its repo and tunnel whichever page or
  sweep starts it (the workspace page, the queued-prompt sweep, `sendToPane` waking it).
- `pkg/dev-extension/chat-conversation.ts`: `start()` (waking a resting conversation from the chat
  view) keeps shell.sh's `$5` tunnel and `$6` CLI. **Upstream bug, worth offering to Cody:** cut at
  `$4`, a woken workspace conversation started with no `CLAUDE_CODE_SHELL_PREFIX`, ran its commands
  in the agent pod, and shell.sh recorded that argv for every restore after it.

## What Conversation mode relies on, outside this repo

- The `lte-duty` workspace on mf-dev: its pod runs the commands, and the conversations are
  registered under its name. Never delete it: dev-api's housekeeping ends every conversation whose
  workspace is gone.
- `/workspaces/.conversation/` on the node: the interrupt-duty checkout, `bin/conv-shell` (the
  command tunnel) and the tools. Housekeeping skips dot-directories, which is why it is one.
- The Secret `dev-system/conversation-env` (key `.env`), which conv-shell copies into the checkout.
- The ConfigMap `dev-system/conversation-links` (key `links.json`): which chat is about which pull
  request or issue, written by the dashboard (and by an agent with kubectl).

## Version

`<upstream minor>.<upstream patch × 100 + n>`: upstream 0.3.722 is our 0.3.72201, 0.3.72202, …
and upstream 0.3.723 is our 0.3.72301. A version of ours always sorts above the upstream release
it is based on, and a bump of `pkg/dev-extension/package.json` on `main` is what publishes
(`.github/workflows/build-extension-charts.yml`).
