// Conversation mode: make sure a new chat's first message is said.
//
// The message is queued as a file (`/workspace/.queue/<id>`), and claude-session.sh reads it only
// when the chat's pane starts. A pane that was up before the file landed never reads it, and
// nothing says so: the chat waits for you, and the file stays in .queue for good. On mf-dev that
// was chats 1, 15, 25 and 29 (11-18/19) and 45 (11-24). sessions.sh `new` now clears what a reused
// chat number left behind, which was one way in; this catches any other. A few seconds after the
// chat is made, if its pane is up and the file is still there, the pane went past reading it: take
// the file and type the message in, as the composer would.
import { podExecOnce, clusterBase } from '../api';
import { waitForStudio, sendToPane } from '../conversations';
import { isConversationId } from '../conversation-id.mjs';
import { CONVERSATION_HOME } from './config.mjs';

/** Where queued first messages wait: beside the agent home (sessions.sh, `$(dirname home)/.queue`). */
const QUEUE_DIR = `${ CONVERSATION_HOME.replace(/\/[^/]+$/, '') }/.queue`;

/** How long after the chat is made to look, in turn. About 45 s in all. */
const LOOKS_MS = [4000, 4000, 5000, 7000, 10000, 15000];

/**
 * Run in the agent pod (as root; tmux as the panes' user): `none` when nothing is queued (read,
 * or never queued), `waiting` while there is no pane, `starting` while the pane is younger than
 * five seconds (its claude-session.sh may still be about to read the file), `claimed` when the
 * file was taken - `mv` first, so a late reader and this cannot both have it.
 */
const CLAIM = `ID="$1"; Q="$2/$1"; H="$3"
[ -f "$Q" ] || { echo none; exit 0; }
as_user() { if [ "$(id -u)" = 0 ]; then setpriv --reuid=1000 --regid=1000 --init-groups env HOME="$H" "$@"; else "$@"; fi; }
made=$(as_user tmux display-message -p -t "mc-$ID" '#{session_created}' 2>/dev/null)
[ -n "$made" ] || { echo waiting; exit 0; }
[ $(( $(date +%s) - made )) -ge 5 ] || { echo starting; exit 0; }
mv "$Q" "$Q.typed" 2>/dev/null || { echo none; exit 0; }
rm -f "$Q.typed"
echo claimed`;

async function claim(id: string): Promise<string> {
  const api = await waitForStudio();
  const pod = api ? await api.agent.pod().catch(() => null) : null;

  if (!api || !pod) {
    return 'waiting';
  }
  const out = await podExecOnce(api.agent.namespace, pod, api.agent.container, ['sh', '-c', CLAIM, 'sh', id, QUEUE_DIR, CONVERSATION_HOME], clusterBase('local'));

  return (out || '').trim().split('\n').pop() || 'waiting';
}

/**
 * Wait for a new chat's pane to read its first message, and type the message in if it did not.
 * Answers `read` (the pane took it), `typed` (this did), or `pending` (no pane came up in time:
 * the file is still queued, and the pane reads it whenever it does start).
 */
export async function ensureOpeningSaid(id: string, text: string): Promise<'read' | 'typed' | 'pending'> {
  if (!isConversationId(id) || !text.trim()) {
    return 'read';
  }
  for (const ms of LOOKS_MS) {
    await new Promise((done) => setTimeout(done, ms));
    const state = await claim(id).catch(() => 'waiting');

    if (state === 'none') {
      return 'read';
    }
    if (state === 'claimed') {
      await sendToPane(id, text);

      return 'typed';
    }
  }

  return 'pending';
}
