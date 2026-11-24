// Conversation mode's dashboard: which repositories it watches, and what in them needs you.
//
// Plain functions over what github.ts's myWork() answers (GithubPr / GithubIssue) and what the
// conversation registry says, so the rules are testable without a page.

/**
 * The repositories, one group per product.
 *
 * One myWork() call per group rather than one for all of them: GitHub caps a search query at 256
 * characters, and every repository is a `repo:` qualifier in it. Each group stays under that.
 */
export const PROJECTS = [
  {
    id:    'rancher',
    name:  'Rancher',
    repos: ['rancher/dashboard', 'rancher/rancher-ai-ui', 'rancher/ui-configurable-views', 'rancher/security-ui-exts', 'rancher/ui-locales', 'rancher/longhorn-ui-extension'],
  },
  {
    id: 'harvester', name: 'Harvester', repos: ['harvester/harvester-ui-extension', 'harvester/harvester', 'harvester/docs'],
  },
  {
    id: 'longhorn', name: 'Longhorn', repos: ['longhorn/longhorn-ui', 'longhorn/longhorn'],
  },
];

/** The longest query a group makes, to keep the cap above honest (tests check it). */
/**
 * The repositories you maintain: every open pull request in them is fetched - the bots'
 * (Dependabot, the shell bump, Renovate) included, which ask nobody for a review and so match none
 * of the other searches - for the Browser's "In repos I maintain" tab. They are not rows of Needs
 * your attention unless you are asked for a review: they get a process of their own. Each must
 * also be in PROJECTS.
 */
export const MAINTAINED = ['rancher/ui-locales'];

export const SEARCH_TAIL = ' is:open is:pr user-review-requested:@me -author:@me archived:false';

export function projectOf(repo) {
  return PROJECTS.find((p) => p.repos.includes(repo))?.id || '';
}

/** One subject (a PR or an issue) across repositories: the number alone is not unique. */
export function subjectKey(repo, number) {
  return `${ repo }#${ number }`;
}

/** `harvester-ui-extension#1233` - the repository without its owner, for a row. */
export function shortRef(repo, number) {
  return `${ (repo || '').split('/').pop() }#${ number }`;
}

/** A chat's title when it is started for a subject: the reference, then as much title as fits. */
export function chatTitleFor(subject, max = 60) {
  const full = `${ shortRef(subject.repo, subject.number) } ${ subject.title || '' }`.trim();

  return full.length > max ? `${ full.slice(0, max - 1).trimEnd() }…` : full;
}

/** The first message of a chat started from the dashboard. */
export function openingMessage(subject) {
  const what = subject.kind === 'issue' ? 'issue' : 'pull request';

  return `This chat is about the ${ what } ${ subject.url } ("${ subject.title }"). Read it, its comments and its latest activity, and tell me where it stands and what is waiting on me.`;
}

/**
 * What a chat started from Find work asks first: whether the issue is one to take at all, before
 * any work on it. Marcelo's wording (2026-11-24), kept as he wrote it.
 */
export const PICKUP_CHECK = `We should check this issue.
We want to see if it is doable or if we require more information.
Required information would be:
- If is a bug, it is reproducible?
- Is blocked by backend? We should avoid workarounds when checking on this.
- Design too complex would require a Designer. Normally a simple case is when we can copy another page UX.
- Too big, we need to check separately in details. Too many pages changed.
- Not enough information, too much for us to guess what we need. Almost no information.
After this analysis, we should decide if we are going to do or not.`;

/** The first message of a chat started from Find work: which issue, then PICKUP_CHECK. */
export function pickupMessage(subject) {
  return `This chat is about the issue ${ subject.url } ("${ subject.title }").\n\n${ PICKUP_CHECK }`;
}

/**
 * What the header's button sends to a chat about an issue of yours: build it, then loop on review
 * B until it holds, then present it. Marcelo's wording (2026-11-24), kept as he wrote it.
 */
export const WORK_ON_IT = `We should work on the UI.
Let's work on it.
Do an analysis what is the best UI/UX based on the usual patterns.
Check the backend feature, ins and out of the APIs to be able to work on it.
When creating the PR, remember to add the backend PR to the description with a checkbox and a link where we can the status.
After finished, check it all good using the review B process, if there is anything to change, change it.
Check with review process B again until it works perfectly. So loop on doing changes and applying.
After finished, check with the the training UI process where we create a presentation, so we can see what has been created.`;

/** What the header's button sends to a chat about a pull request you review. Marcelo's wording (2026-11-24). */
export const REVIEW_IT = `We should review this PR using process B.
After finishing the review B process, check the outcome and see if the points are true, make sure you can reproduce the problems.
After finished, check with the the training UI process where we create a presentation, so we can see what has been created. Share the link.
Create as well the review page with the comments. On the guided training UI process, connect the guide with the comments to help.
At the end of the message on the chat. Add if suggest Approved or Request Changes. Add the comments enumerated.
First run you can be strict if approves or not, second you can decrease the strictiness, and third one you can be more flexible`;

/**
 * What a chat started on a pull request you review opens with: the first time it is looked at
 * here, a whole review. Marcelo's wording (2026-11-24), kept as he wrote it. REVIEW_IT is the
 * header button's, for a chat that is already going.
 */
export const REVIEW_START = `We should review this PR using process B.
Let's work on it.
Do an analysis what is the best UI/UX based on the usual patterns.
Check the backend feature, ins and out of the APIs to be able to work on it.
After finishing the review B process, check the outcome and see if the points are true, make sure you can reproduce the problems.
After finished, check with the the training UI process where we create a presentation, so we can see what has been created. Share the link.
At the end of the message on the chat. Add if suggest Approved or Request Changes. Add the comments enumerated.
First run you can be strict if approves or not, second you can decrease the strictiness, and third one you can be more flexible`;

/**
 * The line the review prompts end with, since how strict to be depends on it: which run this is,
 * from the reviews you posted (github.mjs, myRounds). '' when that count is not known.
 */
export function reviewRunLine(rounds) {
  if (!Array.isArray(rounds)) {
    return '';
  }
  const n = rounds.length;

  return `\n\nSo far you have posted ${ n } review${ n === 1 ? '' : 's' } on this PR, so this is run ${ n + 1 }.`;
}

/** The first message of a chat started on a pull request you review: which one, REVIEW_START, the run. */
export function reviewStartMessage(subject, rounds) {
  return `This chat is about the pull request ${ subject.url } ("${ subject.title }").\n\n${ REVIEW_START }${ reviewRunLine(rounds) }`;
}

/**
 * The button a chat's header offers, or null: "Work on it" on an issue of yours, "Review it" on a
 * pull request you review. The review one says which run this is, from the reviews you posted
 * (github.mjs, myRounds), since how strict to be depends on it; nothing is said when that count
 * is not known.
 */
export function chatAction(subject, role, rounds) {
  if (subject?.kind === 'issue' && role === 'developer') {
    return { id: 'work', label: 'Work on it', text: WORK_ON_IT };
  }
  if (subject?.kind === 'pr' && role === 'reviewer') {
    return { id: 'review', label: 'Review it', text: `${ REVIEW_IT }${ reviewRunLine(rounds) }` };
  }

  return null;
}

/** A subject from a GithubPr or GithubIssue row. */
export function subjectOf(item, kind = 'pr') {
  return {
    repo: item.repo, number: item.number, kind, url: item.url, title: item.title,
  };
}

/** Rows of several myWork() answers merged, each list without repeats. */
export function mergeWork(answers) {
  const out = {
    login: '', mine: [], reviewing: [], issues: []
  };
  const seen = { mine: new Set(), reviewing: new Set(), issues: new Set() };

  for (const a of answers) {
    if (!a) {
      continue;
    }
    out.login = out.login || a.login || '';
    for (const list of ['mine', 'reviewing', 'issues']) {
      for (const item of a[list] || []) {
        const key = item.key || subjectKey(item.repo, item.number);

        if (!seen[list].has(key)) {
          seen[list].add(key);
          out[list].push(item);
        }
      }
    }
  }

  return out;
}

/** Whether you have reviewed a pull request and it has been pushed to since. */
export function pushedSinceReview(pr) {
  return !!pr.reviewedAt && !!pr.pushedAt && Date.parse(pr.pushedAt) > Date.parse(pr.reviewedAt);
}

/** What a pull request's checks say, in a word. */
export function checksState(pr) {
  const c = pr.checks;

  if (!c || !c.total) {
    return 'none';
  }
  if (c.failing) {
    return 'failing';
  }
  if (c.pending) {
    return 'pending';
  }

  return 'passing';
}

/** Where a pull request's review stands, in a word. */
export function reviewState(pr) {
  if (pr.draft) {
    return 'draft';
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return 'changes';
  }
  if (pr.approved || pr.reviewDecision === 'APPROVED') {
    return 'approved';
  }

  return 'waiting';
}

/**
 * Changes were requested on a pull request of yours and every reviewer who asked has been asked
 * to review again: it waits on them, not on you. GitHub keeps CHANGES_REQUESTED until they review,
 * so the request for a review is what says you are done. False when the answer does not say who
 * was asked (the page's own myWork()).
 */
export function changesAddressed(pr) {
  const by = (pr.changesBy || []).filter((c) => c.login);

  return reviewState(pr) === 'changes' && by.length > 0 && by.every((c) => c.asked);
}

/**
 * Why a pull request of yours is blocked, in a line: who asked for changes and the first thing
 * they said, then which checks fail. Falls back to counts for an answer that does not name them
 * (the page's own myWork() does not).
 */
export function blockedReason(pr) {
  const parts = [];

  if (reviewState(pr) === 'changes') {
    const by = (pr.changesBy || []).filter((c) => c.login);

    if (changesAddressed(pr)) {
      parts.push(`Review asked again of ${ by.map((c) => `@${ c.login }`).join(', ') }`);
    } else {
      const said = by[0]?.said ? `: "${ by[0].said.length > 90 ? `${ by[0].said.slice(0, 89) }…` : by[0].said }"` : '';

      parts.push(by.length ? `Still on the changes @${ by.map((c) => c.login).join(', @') } asked for${ said }` : 'Changes requested');
    }
  }
  if (checksState(pr) === 'failing') {
    const names = pr.checks?.failingNames || [];
    const n = pr.checks.failing;

    parts.push(names.length ? `Failing: ${ names.slice(0, 3).join(', ') }${ n > 3 ? ` (+${ n - 3 } more)` : '' }` : `${ n } check${ n === 1 ? '' : 's' } failing`);
    // rancher/dashboard's Description check is the PR template's checklist: say which box is open.
    if (names.includes('Description') && pr.unchecked?.length) {
      parts.push(`Unticked: "${ pr.unchecked[0] }"${ pr.unchecked.length > 1 ? ` (+${ pr.unchecked.length - 1 } more)` : '' }`);
    }
  }

  return parts.join(' · ');
}

/**
 * Why an approved pull request of yours is not merged yet, from GitHub's merge state: conflicts,
 * behind its base, a branch rule (another approval, a code owner, a required check), checks still
 * running - or nothing, and it is somebody's to merge. Plain "Approved" while GitHub has not worked
 * it out (UNKNOWN) or the answer does not carry it (the page's own myWork()).
 */
export function readyReason(pr) {
  const state = pr.mergeState || '';

  if (state === 'DIRTY' || pr.mergeable === 'CONFLICTING') {
    return 'Approved, but it has merge conflicts';
  }
  if (checksState(pr) === 'pending') {
    return 'Approved, checks still running';
  }
  if (state === 'BEHIND') {
    return 'Approved, but its branch is behind the base';
  }
  if (state === 'BLOCKED') {
    return pr.reviewDecision === 'REVIEW_REQUIRED' ? 'Approved, but it needs another approval' : 'Approved, but a branch rule still blocks it (a required reviewer or check)';
  }
  if (state === 'UNSTABLE') {
    return 'Approved, ready to merge, though a non-required check fails';
  }
  if (state === 'CLEAN' || state === 'HAS_HOOKS') {
    return 'Approved and ready to merge';
  }

  return 'Approved';
}

/** How much each kind of row matters, most first: the order "Needs your attention" is in. */
/**
 * What a pull request looks like now, for a row about it (nothing-to-do.mjs): it changes when
 * anything happens to it - GitHub's updatedAt moves on a comment, a push, a review, a label - and
 * with what updatedAt does not cover, the checks, the review decision, draft-ness and the row's kind.
 */
export function prStamp(kind, pr) {
  return [
    kind,
    pr.updatedAt || '',
    pr.reviewDecision || '',
    pr.draft ? 'draft' : '',
    pr.checks ? `${ pr.checks.failing || 0 }:${ (pr.checks.failingNames || []).join(',') }` : '',
  ].join('|');
}

/** Whether a chat was archived by hand (`cleared` is the older name of the same mark). */
export function isArchived(link) {
  return !!(link?.archived || link?.cleared);
}

const RANK = {
  question: 0, blocked: 1, review: 2, rereview: 3, ready: 4, waiting: 5
};

/**
 * Everything waiting on you, one row each.
 *
 * - question: a chat that stopped to ask you something (its agent state is `input`)
 * - blocked:  a pull request of yours with failing checks or changes requested
 * - review:   GitHub is asking you for a review now
 * - rereview: you reviewed it, and you were asked to review it again
 * - ready:    yours, approved, checks not failing, not a draft
 * - waiting:  you reviewed it and it was pushed to since, but nobody has asked you again yet -
 *             the author's next step (GitHub's re-request button beside your name), so last
 * A pull request in a repository you maintain (MAINTAINED) is a row only when you are asked for a
 * review: the rest wait for a process of their own (the Browser lists them).
 *
 * @param {object} work      mergeWork()'s answer.
 * @param {Array}  chats     [{ id, title }]
 * @param {object} activity  chat id -> agent state
 * @param {object} links     chat id -> { subject }
 */
export function attentionRows(work, chats = [], activity = {}, links = {}) {
  const rows = [];
  // Yours and the issue it fixes are one piece of work: the issue's chat is the pull request's.
  const chatFor = chatsBySubject(chats, links, work);

  for (const chat of chats) {
    // An archived chat is put away: it asks nothing of anyone here, whatever its agent is doing.
    if (activity[chat.id] === 'input' && !isArchived(links[chat.id])) {
      const subject = links[chat.id]?.subject || null;

      rows.push({
        kind: 'question', key: `chat:${ chat.id }`, title: chat.title, subject, chatId: chat.id, url: subject?.url || '', at: '',
      });
    }
  }
  for (const pr of work.mine || []) {
    const checks = checksState(pr);
    const review = reviewState(pr);
    const key = subjectKey(pr.repo, pr.number);

    // Changes requested and the review asked again: it waits on the reviewer - not here, unless a check fails.
    if (checks === 'failing' || (review === 'changes' && !changesAddressed(pr))) {
      rows.push({
        kind: 'blocked', key, title: pr.title, subject: { ...subjectOf(pr), role: 'developer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: blockedReason(pr), author: pr.author || '', reviewers: pr.reviewers || [], stamp: prStamp('blocked', pr),
      });
    } else if (review === 'approved') {
      rows.push({
        kind: 'ready', key, title: pr.title, subject: { ...subjectOf(pr), role: 'developer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: readyReason(pr), author: pr.author || '', reviewers: pr.reviewers || [], stamp: prStamp('ready', pr),
      });
    }
  }
  for (const pr of work.reviewing || []) {
    const key = subjectKey(pr.repo, pr.number);

    if (pr.reviewRequested && pr.reviewedAt) {
      rows.push({
        kind: 'rereview', key, title: pr.title, subject: { ...subjectOf(pr), role: 'reviewer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: `${ pr.author } asked you again`, draft: !!pr.draft, author: pr.author || '', reviewers: pr.reviewers || [], stamp: prStamp('rereview', pr), rounds: pr.rounds,
      });
    } else if (pr.reviewRequested) {
      rows.push({
        kind: 'review', key, title: pr.title, subject: { ...subjectOf(pr), role: 'reviewer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: `From ${ pr.author }`, draft: !!pr.draft, author: pr.author || '', reviewers: pr.reviewers || [], stamp: prStamp('review', pr), rounds: pr.rounds,
      });
    } else if (!pr.maintained && pushedSinceReview(pr)) {
      const since = pr.myReview === 'CHANGES_REQUESTED' ? 'you asked for changes' : 'your review';

      rows.push({
        kind: 'waiting', key, title: pr.title, subject: { ...subjectOf(pr), role: 'reviewer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.pushedAt, why: `${ pr.author } pushed since ${ since } - not asked again yet`, draft: !!pr.draft, author: pr.author || '', reviewers: pr.reviewers || [], stamp: prStamp('waiting', pr), rounds: pr.rounds,
      });
    }
  }

  // A draft is a review nobody is waiting on yet: after the others of its kind.
  return rows.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || (!!a.draft - !!b.draft) || ((Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)));
}

/**
 * subject key -> the chat working on it, for the chats that still exist. With `work`, a pull
 * request of yours and the issue it fixes are one piece of work (fixLinks): one with no chat of
 * its own has the other's.
 */
export function chatsBySubject(chats = [], links = {}, work = null) {
  const out = {};

  for (const chat of chats) {
    const s = links[chat.id]?.subject;

    if (s) {
      out[subjectKey(s.repo, s.number)] = chat.id;
    }
  }

  return work ? viaFixes(out, work) : out;
}

/**
 * GitHub's closing keywords (close, fix, resolve and their tenses), an optional colon, then
 * `#n`, `owner/repo#n` or the issue's URL - what makes GitHub close the issue on merge.
 */
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\s*:\s*|\s+)(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)\b/gi;

/**
 * The issues a pull request's description says it fixes ("Fixes #19962"), as subject keys; `#n`
 * alone is in the pull request's own repository. A plain mention is not one, and neither is
 * anything inside an HTML comment (a template's hints).
 */
export function fixedIssues(body, repo) {
  const text = String(body || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const out = [];

  for (const m of text.matchAll(CLOSING)) {
    const key = subjectKey(m[1] || m[2] || repo, Number(m[3]));

    if (!out.includes(key)) {
      out.push(key);
    }
  }

  return out;
}

/**
 * Pull requests of yours and the issues they fix, `key -> [keys]` both ways: one piece of work,
 * so a chat started on the issue (Find work) is the pull request's chat too, and the other way
 * round. The server answers `fixes` (github.mjs, shapePr); a page that asked GitHub itself reads
 * the description. Only yours: a pull request you review is a job of its own, chat and all.
 */
export function fixLinks(work = {}) {
  const out = {};
  const link = (a, b) => {
    out[a] ||= [];
    if (!out[a].includes(b)) {
      out[a].push(b);
    }
  };

  for (const pr of work.mine || []) {
    const key = subjectKey(pr.repo, pr.number);

    for (const issue of pr.fixes || fixedIssues(pr.body, pr.repo)) {
      link(key, issue);
      link(issue, key);
    }
  }

  return out;
}

/** `map` (subject key -> something) with each subject that has nothing given what its fix partner has. */
export function viaFixes(map, work) {
  const own = { ...map };

  for (const [key, others] of Object.entries(fixLinks(work))) {
    const other = own[key] === undefined ? others.find((k) => own[k] !== undefined) : undefined;

    if (other !== undefined) {
      map[key] = own[other];
    }
  }

  return map;
}

/** "5m ago", "3h ago", "2d ago" - '' for no date. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');

  if (!t) {
    return '';
  }
  const s = Math.max(0, Math.round((now - t) / 1000));

  if (s < 60) {
    return 'just now';
  }
  if (s < 3600) {
    return `${ Math.floor(s / 60) }m ago`;
  }
  if (s < 86400) {
    return `${ Math.floor(s / 3600) }h ago`;
  }

  return `${ Math.floor(s / 86400) }d ago`;
}

const ROUND_STATE = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'commented', DISMISSED: 'dismissed'
};

/**
 * How many times you reviewed a pull request, and what the last one said: `{ count: 2, last:
 * 'changes requested 3h ago' }` (ReviewRounds.vue draws the count as a badge). `rounds` is
 * conversation-api's (github.mjs, myRounds): what you posted, thread replies left out. null when
 * there is no count to give - a page that asked GitHub itself has none.
 */
export function roundsSummary(rounds, now = Date.now()) {
  if (!Array.isArray(rounds)) {
    return null;
  }
  const last = rounds[rounds.length - 1];

  if (!last) {
    return { count: 0, last: '' };
  }
  const when = ago(last.at, now);

  return { count: rounds.length, last: `${ ROUND_STATE[last.state] || String(last.state || '').toLowerCase() }${ when ? ` ${ when }` : '' }` };
}

/** Each round on a line of its own, for the count's tooltip: "1. Changes requested, 2026-11-19". */
export function roundsTitle(rounds) {
  return (Array.isArray(rounds) ? rounds : []).map((r, i) => {
    const state = ROUND_STATE[r.state] || String(r.state || '').toLowerCase();

    return `${ i + 1 }. ${ state.charAt(0).toUpperCase() }${ state.slice(1) }, ${ String(r.at || '').slice(0, 10) }`;
  }).join('\n');
}

/** "Good morning" / "Good afternoon" / "Good evening" by the local hour. */
export function greeting(date = new Date()) {
  const h = date.getHours();

  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// ── Software projects (the dashboard's cards) ─────────────────────────────────────────────────

/**
 * One card per repository worth watching, as the mockup draws them. `issues` is where its bugs and
 * releases are tracked (a UI's issues often live in its product's repository, narrowed by `ui`
 * label), `bugs` the labels that make an issue one of its bugs.
 */
export const CARDS = [
  {
    id: 'dashboard', name: 'Rancher Dashboard', kind: 'Application', initials: 'RD', repo: 'rancher/dashboard', issues: 'rancher/dashboard', ui: '', bugs: ['kind/bug']
  },
  {
    id: 'harvester-ui', name: 'Harvester UI Extension', kind: 'UI extension', initials: 'HV', repo: 'harvester/harvester-ui-extension', issues: 'harvester/harvester', ui: 'area/ui', bugs: ['kind/bug', 'area/ui']
  },
  {
    id: 'longhorn-ui', name: 'Longhorn UI', kind: 'UI', initials: 'LH', repo: 'longhorn/longhorn-ui', issues: 'longhorn/longhorn', ui: 'area/ui', bugs: ['kind/bug', 'area/ui']
  },
  {
    id: 'ai-ui', name: 'Rancher AI UI', kind: 'UI extension', initials: 'AI', repo: 'rancher/rancher-ai-ui', issues: 'rancher/rancher-ai-ui', ui: '', bugs: ['bug']
  },
  {
    id: 'security-ui', name: 'SUSE Security UI', kind: 'UI extensions', initials: 'SC', repo: 'rancher/security-ui-exts', issues: 'rancher/security-ui-exts', ui: '', bugs: ['bug']
  },
  {
    id: 'longhorn-ext', name: 'Longhorn UI Extension', kind: 'UI extension', initials: 'LE', repo: 'rancher/longhorn-ui-extension', issues: 'rancher/longhorn-ui-extension', ui: '', bugs: ['kind/bug']
  },
];

/** `v2.16.0` -> [2, 16, 0]; null for a milestone that is not a version (Backlog, Planning, …). */
export function versionOf(title = '') {
  const m = String(title).match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/);

  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

/**
 * The next release: the lowest version milestone with work still open in it. The repositories set
 * no due dates, so there is no "on track" to compute; what is left is how much is open.
 * @param {Array} milestones [{ title, url, open, closed }]
 */
export function nextMilestone(milestones = []) {
  const candidates = milestones
    .map((m) => ({ ...m, v: versionOf(m.title) }))
    .filter((m) => m.v && m.open > 0)
    .sort((a, b) => (a.v[0] - b.v[0]) || (a.v[1] - b.v[1]) || (a.v[2] - b.v[2]));

  if (!candidates.length) {
    return null;
  }
  const { v, ...m } = candidates[0];

  return m;
}

/**
 * A card as the dashboard draws it: what the server found for the repository (`found`: build,
 * milestones, bugs), and what needs you there and what the chats are doing there, from the page.
 */
export function cardSummary(card, found = null, attention = [], chats = [], links = {}) {
  const needYou = attention.filter((r) => r.subject?.repo === card.repo || (card.issues !== card.repo && r.subject?.repo === card.issues && r.subject?.kind === 'issue')).length;
  const tasks = chats.filter((c) => links[c.id]?.subject?.repo === card.repo).length;

  return {
    ...card,
    needYou,
    tasks,
    build:     found?.build || '',
    release:   found ? nextMilestone(found.milestones || []) : null,
    bugs:      found ? found.bugs : null,
    known:     !!found,
  };
}
