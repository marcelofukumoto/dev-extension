// Conversation mode's rail: the chats grouped the way the Dev product's sidebar groups workspaces.
//
// DEVELOPER is what you are doing (your pull requests, issues assigned to you), REVIEWER is what
// you are reviewing (somebody else's pull requests), OTHER is every chat that is about no issue
// or pull request. An issue or a pull request is one item however many chats are about it - its
// chats are that item's tabs; a chat in OTHER is an item of its own.
//
// Plain functions over the chats, their links (links.ts) and GitHub as myWork() answers it, so the
// grouping is tested without a page.
import {
  subjectKey, shortRef, checksState, reviewState, pushedSinceReview
} from './projects.mjs';

export const SECTIONS = [
  { id: 'developer', label: 'Developer' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'other', label: 'Other' },
  // What is over: a pull request merged or closed, an issue no longer yours, a chat cleared by hand.
  { id: 'done', label: 'Done' },
];

/** How urgent a chat's state is: the item shows its most urgent chat. */
const URGENCY = {
  input: 4, working: 3, idle: 2, finished: 1, none: 0
};

/** Index of a GitHub answer by `repo#n`, with where each one came from. */
export function indexWork(work = {}) {
  const out = {};

  for (const pr of work.mine || []) {
    out[subjectKey(pr.repo, pr.number)] = { kind: 'pr', role: 'developer', item: pr };
  }
  for (const pr of work.reviewing || []) {
    out[subjectKey(pr.repo, pr.number)] ||= { kind: 'pr', role: 'reviewer', item: pr };
  }
  for (const issue of work.issues || []) {
    out[subjectKey(issue.repo, issue.number)] ||= { kind: 'issue', role: 'developer', item: issue };
  }

  return out;
}

/**
 * Which section a subject belongs in: what GitHub says it is now, then what was recorded when its
 * chat was made (`subject.role`), then the kind - an issue is something you are doing, and a pull
 * request nobody said was yours is one you are reviewing.
 */
export function sectionOf(subject, found) {
  if (!subject) {
    return 'other';
  }

  return found?.role || subject.role || (subject.kind === 'issue' ? 'developer' : 'reviewer');
}

/**
 * Where it stands, in a few words, and how loud to say it (`warn`, `ok`, or '').
 * `stage` is the index into the Dev product's steps (workspace-rail.ts): FIX_STEPS (assess, code,
 * draft, review, feedback, merged) for DEVELOPER, REVIEW_STEPS (agent, findings, submitted,
 * response, approved) for REVIEWER; -1 when there is nothing to place.
 */
export function statusOf(section, subject, found, hasChats = true) {
  if (section === 'other' || !subject) {
    return { text: '', tone: '', stage: -1 };
  }
  if (!found) {
    return { text: subject.kind === 'issue' ? 'Not assigned to you, or closed' : 'Closed or merged', tone: '', stage: section === 'developer' && subject.kind !== 'issue' ? 5 : -1 };
  }
  const it = found.item;

  if (found.kind === 'issue') {
    return { text: it.milestone ? `Assigned · ${ it.milestone }` : 'Assigned to you', tone: '', stage: hasChats ? 1 : 0 };
  }
  if (section === 'developer') {
    const review = reviewState(it);
    const checks = checksState(it);

    if (review === 'draft') {
      return { text: 'Draft', tone: '', stage: 2 };
    }
    if (review === 'changes') {
      return { text: 'Changes requested', tone: 'warn', stage: 4 };
    }
    if (checks === 'failing') {
      return { text: `${ it.checks.failing } check${ it.checks.failing === 1 ? '' : 's' } failing`, tone: 'warn', stage: 3 };
    }
    if (review === 'approved') {
      return { text: 'Approved', tone: 'ok', stage: 3 };
    }

    return { text: 'In review', tone: '', stage: 3 };
  }
  if (reviewState(it) === 'approved' && it.reviewedAt) {
    return { text: 'Approved', tone: 'ok', stage: 4 };
  }
  if (it.reviewRequested && !it.reviewedAt) {
    return { text: 'Your review', tone: 'warn', stage: 0 };
  }
  if (pushedSinceReview(it)) {
    return { text: 'Pushed since your review', tone: 'warn', stage: 3 };
  }
  if (it.reviewRequested) {
    return { text: 'Asked again', tone: 'warn', stage: 3 };
  }

  return { text: 'Reviewed', tone: '', stage: 2 };
}

/**
 * The rail: `[{ id, label, items }]` in section order, each item
 * `{ key, section, subject, title, ref, url, chatIds, activity, status }`.
 *
 * @param {Array}  chats     [{ id, title }]
 * @param {object} links     chat id -> { subject }
 * @param {object} work      myWork()'s answer, merged
 * @param {object} activity  chat id -> agent state
 */
export function railSections(chats = [], links = {}, work = {}, activity = {}) {
  const index = indexWork(work);
  // Before GitHub has answered once, nothing is "over": every subject would look closed.
  const loaded = !!work.login;
  const items = new Map();

  for (const chat of chats) {
    const subject = links[chat.id]?.subject || null;
    const key = subject ? subjectKey(subject.repo, subject.number) : `chat:${ chat.id }`;

    if (!items.has(key)) {
      const found = subject ? index[key] : null;
      const section = sectionOf(subject, found);

      items.set(key, {
        key,
        section,
        subject,
        found,
        title: subject ? (found?.item.title || subject.title || shortRef(subject.repo, subject.number)) : chat.title,
        ref:   subject ? shortRef(subject.repo, subject.number) : '',
        url:   subject?.url || '',
        chatIds: [],
      });
    }
    items.get(key).chatIds.push(chat.id);
  }
  const all = [...items.values()].map(({ found, ...item }) => {
    const urgency = Math.max(0, ...item.chatIds.map((id) => URGENCY[activity[id] || 'none']));
    // Development and review are over when GitHub no longer lists the subject as open and yours;
    // a chat about nothing is over when it is cleared by hand.
    const finished = item.subject ? loaded && !found : item.chatIds.every((id) => links[id]?.cleared);

    return {
      ...item,
      finished,
      section: finished ? 'done' : item.section,
      role:    item.section,
      activity: Object.keys(URGENCY).find((k) => URGENCY[k] === urgency) || 'none',
      status:   statusOf(item.section, item.subject, found, item.chatIds.length > 0),
      updated:  Date.parse(found?.item?.updatedAt || '') || 0,
    };
  });

  return SECTIONS.map((s) => ({
    ...s,
    items: all.filter((i) => i.section === s.id)
      .sort((a, b) => (URGENCY[b.activity] - URGENCY[a.activity]) || (b.updated - a.updated) || a.title.localeCompare(b.title)),
  }));
}

/** Items whose title, reference or status mention every word of the query. */
export function filterRail(sections, query = '') {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return sections;
  }

  return sections.map((s) => ({
    ...s,
    items: s.items.filter((i) => words.every((w) => `${ i.title } ${ i.ref } ${ i.status.text }`.toLowerCase().includes(w))),
  }));
}
