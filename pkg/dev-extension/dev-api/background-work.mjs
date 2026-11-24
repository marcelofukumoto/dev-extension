// What a conversation sent off into the background and has not heard back from yet.
//
// A conversation's state is worked out from its hooks and from whether its transcript moved in
// the last ninety seconds (server.mjs, conversationState), and that reads a conversation whose
// own turn is over as idle while work it started is still going. A review sends its passes off as
// agents, a preview build runs in the background; the main agent stops - its Stop hook says so -
// and its transcript does not move again until one of them reports back with a
// <task-notification>. The dashboard drew those rows as idle through the whole review.
//
// Two facts say otherwise. Processes still running under the conversation's claude are one, and
// only the agent pod can see them (sessions.sh states-all). This is the other: a launch the
// transcript records with no notice for it yet - which also covers an agent thinking between two
// commands, when nothing of its own is running.
//
// Only what this claude launched counts. A background task is a child of the claude that started
// it, an agent runs inside it, and both end with it: a launch from before the claude now in the
// pane started (a `--resume` keeps the old lines) will never report back.

/** What a tool result says when the work went to the background. */
const LAUNCHED = /^\s*(Async agent launched|Command running in background with ID:)/;
/** Tools that only ever run in the background. */
const BACKGROUND_TOOLS = new Set(['Workflow', 'Monitor']);
/** Tools that end a background task by its id. */
const STOP_TOOLS = new Set(['TaskStop', 'KillShell']);
/** Nothing these conversations send off runs this long; one that has not reported back by then is not going to. */
export const BACKGROUND_LIMIT_MS = 6 * 3600_000;
/** A launch is written by the claude it belongs to, so after it started; this is clock slack. */
const SLACK_MS = 5_000;

function blocksOf(entry) {
  const content = entry?.message?.content;

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return Array.isArray(content) ? content : [];
}

function resultText(block) {
  const content = block?.content;

  if (typeof content === 'string') {
    return content;
  }

  return Array.isArray(content) ? content.map((c) => c?.text || '').join('\n') : '';
}

/**
 * The background launches in a transcript's tail that have not reported back.
 *
 * @param {string[]} lines The tail's lines, oldest first. A line that does not parse is skipped.
 * @param {number} sinceMs When the claude now in the pane started; 0 when unknown, which counts nothing.
 * @param {number} now The clock.
 * @returns {{ id: string, name: string, task: string, at: string }[]}
 */
export function pendingBackground(lines = [], sinceMs = 0, now = Date.now()) {
  if (!sinceMs) {
    return [];
  }

  const uses = new Map();
  const launched = new Map();
  const notices = [];
  const stopped = [];

  for (const line of lines) {
    // By line and not by entry: a notice arrives as a queued command, an attachment or a user
    // message depending on whether the main agent was busy, and each names the launch it ends.
    if (line.includes('<task-notification>')) {
      notices.push(line);
    }

    let entry;

    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // A subagent's own lines are its business; what the conversation waits on is the main agent's.
    if (entry?.isSidechain) {
      continue;
    }

    for (const block of blocksOf(entry)) {
      if (entry.type === 'assistant' && block?.type === 'tool_use') {
        uses.set(block.id, block);
        if (STOP_TOOLS.has(block.name)) {
          stopped.push(JSON.stringify(block.input || {}));
        }
      }
      if (entry.type === 'user' && block?.type === 'tool_result' && !block.is_error) {
        const use = uses.get(block.tool_use_id);
        const text = resultText(block);

        if (!use || !(LAUNCHED.test(text) || BACKGROUND_TOOLS.has(use.name))) {
          continue;
        }
        const at = Date.parse(entry.timestamp) || 0;

        if (at < sinceMs - SLACK_MS || now - at > BACKGROUND_LIMIT_MS) {
          continue;
        }
        // The task's own id as well as the call's: a notice carries both, a stop names the task.
        const task = (/(?:with ID:|agentId:)\s*([A-Za-z0-9_-]+)/.exec(text) || [])[1] || '';

        launched.set(block.tool_use_id, {
          id: block.tool_use_id, name: use.name, task, at: entry.timestamp
        });
      }
    }
  }

  // A notice with a status is the end of a task; one without is a Monitor's event, and it goes on.
  const ends = notices.filter((n) => n.includes('<status>'));

  return [...launched.values()].filter((l) => {
    const told = ends.some((n) => n.includes(`<tool-use-id>${ l.id }</tool-use-id>`) || (l.task && n.includes(`<task-id>${ l.task }</task-id>`)));
    const ended = l.task && stopped.some((s) => s.includes(`"${ l.task }"`));

    return !told && !ended;
  });
}
