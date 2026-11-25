// Conversation mode's "Find work": the issues there are to pick up, one tab per place they are kept.
//
// A tab is a view of a GitHub project (its own saved filter, which GitHub applies: `items(query:)`)
// or an issue search. conversation-api asks GitHub for every tab (server/server.mjs, /pickup) and
// the dashboard shows them in a dialog (PickupDialog.vue), narrowed to a milestone, with the issues
// somebody already started set aside. Plain functions and strings, shared by the server and the
// page, so the rules are tested without either.
import { subjectKey, PROJECTS, CARDS } from './projects.mjs';

/** The tabs, in the order they are shown. A new one is a line here. */
export const PICKUP_TABS = [
  // Yours already: the dashboard issues assigned to you, a backport beside its issue - the
  // milestone picks which (v2.17.0, v2.16.1). `@me` is whoever owns the server's token.
  {
    id: 'mine', name: 'My dashboard issues', search: 'is:issue state:open assignee:@me label:area/dashboard'
  },
  {
    id: 'longhorn', name: 'Longhorn', project: { org: 'rancher', number: 57, view: 68 }
  },
  {
    id: 'harvester', name: 'Harvester', project: { org: 'rancher', number: 57, view: 65 }
  },
  {
    id: 'fleet', name: 'Fleet', project: { org: 'rancher', number: 57, view: 41 }
  },
  {
    id: 'jira-bugs', name: 'JIRA bugs', search: 'repo:rancher/dashboard is:issue state:open label:JIRA label:kind/bug'
  },
];

/** At most this many pages of 100 per tab. */
export const PICKUP_PAGES = 3;

/**
 * The repositories UI code lives in: every one the dashboard tracks (projects.mjs, PROJECTS) but
 * the ones that only hold a card's issues (harvester/harvester, longhorn/longhorn - backends and
 * trackers) and docs. An open pull request here that mentions an issue says somebody may be on it
 * ("Possibly started"); a backend PR naming a UI issue in passing says nothing of the kind.
 */
export const UI_REPOS = (() => {
  const code = new Set(CARDS.map((c) => c.repo));
  const issuesOnly = new Set(CARDS.map((c) => c.issues).filter((r) => !code.has(r)));

  return [...new Set(PROJECTS.flatMap((p) => p.repos))].filter((r) => !issuesOnly.has(r) && !/\/docs$/.test(r));
})();

/** Project statuses that mean somebody is on it already, PR or not. */
export const STARTED_STATUSES = ['Working', 'Review'];

/** Where a tab is on GitHub. */
export function tabUrl(tab) {
  if (tab.project) {
    return `https://github.com/orgs/${ tab.project.org }/projects/${ tab.project.number }/views/${ tab.project.view }`;
  }

  return `https://github.com/issues?q=${ encodeURIComponent(tab.search) }`;
}

const PR_FIELDS = 'number url state isDraft repository { nameWithOwner isFork } author { login }';

/**
 * What is asked of each issue: enough for the table, every pull request that points at it, and its
 * backports and what it is a backport of (backportOf, backportsOf - the body is read for that on the
 * server and not handed on).
 */
const BACKPORT_FIELDS = 'number title url state body repository { nameWithOwner } milestone { title }';

export const ISSUE_FIELDS = `
  number title url state createdAt updatedAt body
  repository { nameWithOwner }
  author { login }
  milestone { title dueOn }
  labels(first: 20) { nodes { name color } }
  assignees(first: 5) { nodes { login } }
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${ PR_FIELDS } } }
  timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 30) {
    nodes { ... on CrossReferencedEvent { willCloseTarget source { __typename ... on PullRequest { ${ PR_FIELDS } } ... on Issue { ${ BACKPORT_FIELDS } } } } }
  }`;

/** A view's own filter (and name). */
export function viewQuery(project) {
  return `query { organization(login: ${ JSON.stringify(project.org) }) { projectV2(number: ${ project.number }) {
    title view(number: ${ project.view }) { name filter } } } }`;
}

/** A page of a project's items under a view's filter, which GitHub applies the way the view does. */
export function projectItemsQuery(project, filter, after = null) {
  return `query { organization(login: ${ JSON.stringify(project.org) }) { projectV2(number: ${ project.number }) {
    items(first: 100, query: ${ JSON.stringify(filter || '') }${ after ? `, after: ${ JSON.stringify(after) }` : '' }) {
      totalCount pageInfo { hasNextPage endCursor }
      nodes {
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        projectPriority: fieldValueByName(name: "Project Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content { __typename ... on Issue { ${ ISSUE_FIELDS } } }
      }
    } } } }`;
}

/** A page of an issue search. */
export function searchQuery(search, after = null) {
  return `query { search(type: ISSUE, query: ${ JSON.stringify(search) }, first: 100${ after ? `, after: ${ JSON.stringify(after) }` : '' }) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { __typename ... on Issue { ${ ISSUE_FIELDS } } } } }`;
}

/**
 * Every pull request that points at an issue, once each: `links` when it would close it. One made
 * inside somebody's fork (its repository is a fork) is left out: it is their own experiment, not
 * work on the issue - rancher/dashboard#13792 was hidden by aeltai/rancher#3, a PR to the fork's own
 * main. A PR from a fork to the project is the project's repository's, and counts.
 */
function prsOf(node) {
  const out = new Map();
  const add = (pr, links) => {
    if (!pr?.number || !pr.repository || pr.repository.isFork) {
      return;
    }
    const key = `${ pr.repository.nameWithOwner }#${ pr.number }`;
    const was = out.get(key);

    out.set(key, {
      repo:  pr.repository.nameWithOwner,
      number: pr.number,
      url:   pr.url,
      state: pr.state,
      draft: !!pr.isDraft,
      author: pr.author?.login || '',
      links: !!links || !!was?.links,
    });
  };

  for (const pr of node.closedByPullRequestsReferences?.nodes || []) {
    add(pr, true);
  }
  for (const e of node.timelineItems?.nodes || []) {
    if (e?.source?.__typename === 'PullRequest') {
      add(e.source, e.willCloseTarget);
    }
  }

  return [...out.values()];
}

/**
 * A backport issue's title starts with what the bots write: `[backport v2.16.1] ...` (dashboard,
 * Harvester) or `[BACKPORT][v1.13.1][BUG] ...` (Longhorn). Its version, '' when it names none.
 */
const BACKPORT_TITLE = /^\s*\[backport\b\]?\s*(?:\[\s*)?(v?\d+(?:\.(?:\d+|x))*)?/i;

export function isBackport(title) {
  return BACKPORT_TITLE.test(String(title || ''));
}

/** The version a backport is for: its title's, else its milestone's. */
export function backportVersion(title, milestone = '') {
  return String(title || '').match(BACKPORT_TITLE)?.[1] || milestone || '';
}

/** The first issue a description names: its URL, `owner/repo#n` or `#n` (in `repo`). */
const ISSUE_REF = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|(?:\b([\w.-]+\/[\w.-]+))?#(\d+)\b/;

/**
 * What a backport issue is a backport of - the issue its description names first, which is how
 * each bot writes it ("This is a backport issue for <url>", "backport the issue #11667", "backport
 * <url>") - as `{ repo, number, url }`; null for an issue that is not a backport.
 */
export function backportOf(node) {
  if (!isBackport(node?.title)) {
    return null;
  }
  const m = String(node.body || '').replace(/<!--[\s\S]*?(?:-->|$)/g, '').match(ISSUE_REF);

  if (!m) {
    return null;
  }
  const repo = m[1] || m[3] || node.repository?.nameWithOwner || '';
  const number = Number(m[2] || m[4]);

  return { repo, number, url: `https://github.com/${ repo }/issues/${ number }` };
}

/**
 * The backports of an issue: the backport issues GitHub lists as references to it whose own
 * backportOf is this issue, `[{ repo, number, url, state, version }]`. Only those: a bot copies
 * the original's body into its backport, so the backport of rancher/rancher#40712 (#50109)
 * mentions rancher/dashboard#7897 too, without being a backport of it. None for a backport
 * itself, whose references are its siblings.
 */
export function backportsOf(node) {
  if (isBackport(node?.title)) {
    return [];
  }
  const out = new Map();

  for (const e of node?.timelineItems?.nodes || []) {
    const s = e?.source;

    const of = s?.__typename === 'Issue' && s.repository ? backportOf(s) : null;

    if (of && of.repo === node.repository?.nameWithOwner && of.number === node.number) {
      out.set(`${ s.repository.nameWithOwner }#${ s.number }`, {
        repo:    s.repository.nameWithOwner,
        number:  s.number,
        url:     s.url,
        state:   s.state,
        version: backportVersion(s.title, s.milestone?.title),
      });
    }
  }

  return [...out.values()];
}

/** An issue as the dialog shows it; `extra` is what a project adds (status, priority). */
export function shapeIssue(node, extra = {}) {
  const repo = node.repository?.nameWithOwner || '';
  const labels = (node.labels?.nodes || []).map((l) => ({ name: l.name, color: l.color }));

  return {
    key:       subjectKey(repo, node.number),
    repo,
    number:    node.number,
    title:     node.title,
    url:       node.url,
    state:     node.state,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    author:    node.author?.login || '',
    milestone: node.milestone?.title || '',
    labels,
    assignees: (node.assignees?.nodes || []).map((a) => a.login),
    status:    extra.status || '',
    priority:  extra.priority || labels.map((l) => l.name).find((n) => /^priority\//.test(n)) || '',
    prs:       prsOf(node),
    backportOf: backportOf(node),
    backports:  backportsOf(node),
  };
}

/** A page of a project's items, as issues: open issues only (a draft item or a pull request is not work to pick up). */
export function shapeProjectItems(data) {
  const items = data?.organization?.projectV2?.items;

  return {
    issues: (items?.nodes || [])
      .filter((n) => n?.content?.__typename === 'Issue' && n.content.state === 'OPEN')
      .map((n) => shapeIssue(n.content, { status: n.status?.name || '', priority: n.projectPriority?.name || n.priority?.name || '' })),
    next: items?.pageInfo?.hasNextPage ? items.pageInfo.endCursor : null,
    total: items?.totalCount || 0,
  };
}

/** A page of a search, as issues. */
export function shapeSearch(data) {
  const s = data?.search;

  return {
    issues: (s?.nodes || []).filter((n) => n?.__typename === 'Issue' && n.state === 'OPEN').map((n) => shapeIssue(n)),
    next:   s?.pageInfo?.hasNextPage ? s.pageInfo.endCursor : null,
    total:  s?.issueCount || 0,
  };
}

/**
 * Whether somebody already started an issue, and why - only on evidence GitHub states: a pull
 * request that would close it (linked, or "Fixes ..."), open or merged, from any repository but a
 * fork; or a project status that says so (Working, Review). That is all that sets an issue aside.
 *
 * A pull request that only mentions it never does: a mention is a guess, and guessing hid issues
 * nobody was on (rancher/dashboard#13792 behind a PR inside a fork, #10215 behind a stale backend
 * draft). Mentions are handed back for the table to say instead: `possibly`, an open one in a UI
 * repository (UI_REPOS) - somebody may be on it - and `mentions`, the rest (merged, or elsewhere).
 */
export function startedBy(issue) {
  const prs = issue.prs || [];
  const by = prs.filter((p) => p.links && (p.state === 'OPEN' || p.state === 'MERGED'));
  const status = STARTED_STATUSES.includes(issue.status) ? issue.status : '';
  const mentioned = prs.filter((p) => !p.links && (p.state === 'OPEN' || p.state === 'MERGED'));

  return {
    started:  by.length > 0 || !!status,
    prs:      by,
    status,
    possibly: mentioned.filter((p) => p.state === 'OPEN' && UI_REPOS.includes(p.repo)),
    mentions: mentioned.filter((p) => !(p.state === 'OPEN' && UI_REPOS.includes(p.repo))),
  };
}

/** The milestones of some issues, with how many each, in version order; '' (no milestone) last. */
export function milestonesOf(issues = []) {
  const n = {};

  for (const i of issues) {
    n[i.milestone] = (n[i.milestone] || 0) + 1;
  }
  const num = (t) => (t.match(/\d+/g) || []).map(Number);
  const cmp = (a, b) => {
    const x = num(a);
    const y = num(b);

    for (let k = 0; k < Math.max(x.length, y.length); k++) {
      if ((x[k] || 0) !== (y[k] || 0)) {
        return (x[k] || 0) - (y[k] || 0);
      }
    }

    return a.localeCompare(b);
  };

  return Object.keys(n).sort((a, b) => (!a) - (!b) || cmp(a, b)).map((title) => ({ title, count: n[title] }));
}
