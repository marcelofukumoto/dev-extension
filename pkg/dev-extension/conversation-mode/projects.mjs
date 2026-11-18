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

/** How much each kind of row matters, most first: the order "Needs your attention" is in. */
const RANK = {
  question: 0, blocked: 1, review: 2, rereview: 3, ready: 4
};

/**
 * Everything waiting on you, one row each.
 *
 * - question: a chat that stopped to ask you something (its agent state is `input`)
 * - blocked:  a pull request of yours with failing checks or changes requested
 * - review:   GitHub is asking you for a review now
 * - rereview: you reviewed it and it has been pushed to since
 * - ready:    yours, approved, checks not failing, not a draft
 *
 * @param {object} work      mergeWork()'s answer.
 * @param {Array}  chats     [{ id, title }]
 * @param {object} activity  chat id -> agent state
 * @param {object} links     chat id -> { subject }
 */
export function attentionRows(work, chats = [], activity = {}, links = {}) {
  const rows = [];
  const chatFor = chatsBySubject(chats, links);

  for (const chat of chats) {
    if (activity[chat.id] === 'input') {
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

    if (checks === 'failing' || review === 'changes') {
      rows.push({
        kind: 'blocked', key, title: pr.title, subject: { ...subjectOf(pr), role: 'developer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: review === 'changes' ? 'Changes requested' : `${ pr.checks.failing } check${ pr.checks.failing === 1 ? '' : 's' } failing`,
      });
    } else if (review === 'approved') {
      rows.push({
        kind: 'ready', key, title: pr.title, subject: { ...subjectOf(pr), role: 'developer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: checks === 'pending' ? 'Approved, checks running' : 'Approved',
      });
    }
  }
  for (const pr of work.reviewing || []) {
    const key = subjectKey(pr.repo, pr.number);

    if (pr.reviewRequested) {
      rows.push({
        kind: 'review', key, title: pr.title, subject: { ...subjectOf(pr), role: 'reviewer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.updatedAt, why: `From ${ pr.author }`,
      });
    } else if (pushedSinceReview(pr)) {
      rows.push({
        kind: 'rereview', key, title: pr.title, subject: { ...subjectOf(pr), role: 'reviewer' }, chatId: chatFor[key] || '', url: pr.url, at: pr.pushedAt, why: `${ pr.author } pushed since your review`,
      });
    }
  }

  return rows.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || ((Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)));
}

/** subject key -> the chat working on it, for the chats that still exist. */
export function chatsBySubject(chats = [], links = {}) {
  const out = {};

  for (const chat of chats) {
    const s = links[chat.id]?.subject;

    if (s) {
      out[subjectKey(s.repo, s.number)] = chat.id;
    }
  }

  return out;
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

/** "Good morning" / "Good afternoon" / "Good evening" by the local hour. */
export function greeting(date = new Date()) {
  const h = date.getHours();

  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
