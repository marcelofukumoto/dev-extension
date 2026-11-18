// conversation-api: what it asks GitHub, and the shape it answers in.
//
// The page's dashboard draws GithubPr / GithubIssue rows as github.ts's myWork() answers them; the
// server answers in the same shape (the fields projects.mjs and the dashboard read), so the page
// does not care which of the two asked. One query per product and section, as the page learned to:
// GitHub gives a GraphQL query ten seconds, and all of a product's searches in one did not fit.

const FAILED_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATUS = new Set(['FAILURE', 'ERROR']);

const PR_FIELDS = `
  number title url isDraft updatedAt reviewDecision mergeable mergeStateStatus
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 60) { nodes {
    __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state }
  } } } } } }
  latestOpinionatedReviews(first: 10) { nodes { state body author { login } } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
  reviews(last: 30) { nodes { author { login } submittedAt } }
`;

const ISSUE_FIELDS = `
  number title url updatedAt
  repository { nameWithOwner }
  milestone { title }
  labels(first: 10) { nodes { name } }
`;

/** The searches one section is, as `alias: query` pairs. */
export function sectionSearches(repos, section) {
  const scope = repos.map((r) => `repo:${ r }`).join(' ');

  if (section === 'mine') {
    return { mine: `${ scope } is:open is:pr author:@me archived:false` };
  }
  if (section === 'reviewing') {
    return {
      requested: `${ scope } is:open is:pr user-review-requested:@me -author:@me archived:false`,
      reviewed:  `${ scope } is:open is:pr reviewed-by:@me -author:@me archived:false`,
    };
  }

  return { issues: `${ scope } is:open is:issue assignee:@me archived:false` };
}

/** One GraphQL query for one section of one product. */
export function sectionQuery(repos, section) {
  const searches = sectionSearches(repos, section);
  const fields = section === 'issues' ? `... on Issue { ${ ISSUE_FIELDS } }` : `... on PullRequest { ${ PR_FIELDS } }`;
  const first = section === 'issues' ? 50 : 30;

  return `query { viewer { login } ${ Object.entries(searches).map(([alias, q]) => `${ alias }: search(query: ${ JSON.stringify(q) }, type: ISSUE, first: ${ first }) { nodes { ${ fields } } }`).join(' ') } }`;
}

/** What a pull request's checks add up to: failing, pending, total, and which ones fail. */
export function checksOf(node) {
  const rollup = node?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const contexts = rollup?.contexts?.nodes || [];
  const failed = [];
  let pending = 0;

  for (const c of contexts) {
    if (c.__typename === 'CheckRun') {
      if (c.status !== 'COMPLETED') {
        pending++;
      } else if (FAILED_RUN.has(c.conclusion)) {
        failed.push(c.name || 'a check');
      }
    } else if (c.__typename === 'StatusContext') {
      if (FAILED_STATUS.has(c.state)) {
        failed.push(c.context || 'a status');
      } else if (c.state === 'PENDING' || c.state === 'EXPECTED') {
        pending++;
      }
    }
  }

  return rollup ? {
    state: rollup.state || '', failing: failed.length, pending, total: contexts.length, failingNames: [...new Set(failed)].slice(0, 6)
  } : null;
}

/** A pull request as the dashboard draws it (github.ts's GithubPr, the fields it reads). */
export function shapePr(node, login, reviewRequested = false) {
  const repo = node.repository?.nameWithOwner || '';
  const mine = (node.reviews?.nodes || []).filter((r) => r?.author?.login === login && r.submittedAt);
  const reviewedAt = mine.length ? mine[mine.length - 1].submittedAt : '';
  const opinions = node.latestOpinionatedReviews?.nodes || [];
  const approved = node.reviewDecision === 'APPROVED' || opinions.some((r) => r.state === 'APPROVED');
  // Who is holding it, and the first thing they said: the reason a "changes requested" is blocked.
  // Who the review is asked of now: one who asked for changes and is in here was asked again.
  const requestedFrom = (node.reviewRequests?.nodes || []).map((r) => r?.requestedReviewer?.login).filter(Boolean);
  const changesBy = opinions.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => ({
    login: r.author?.login || '',
    said:  String(r.body || '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 160) || '',
    asked: requestedFrom.includes(r.author?.login),
  }));

  return {
    key:            `${ repo }#${ node.number }`,
    number:         node.number,
    url:            node.url,
    title:          node.title,
    repo,
    author:         node.author?.login || '',
    draft:          !!node.isDraft,
    approved,
    reviewDecision: node.reviewDecision || '',
    checks:         checksOf(node),
    updatedAt:      node.updatedAt || '',
    pushedAt:       node.commits?.nodes?.[0]?.commit?.committedDate || '',
    reviewedAt,
    reviewRequested,
    requestedFrom,
    changesBy,
    // What stands between it and a merge, as GitHub sees it: CLEAN, BLOCKED (a branch rule), BEHIND,
    // DIRTY (conflicts), UNSTABLE (a non-required check fails), UNKNOWN (not worked out yet).
    mergeable:  node.mergeable || '',
    mergeState: node.mergeStateStatus || '',
  };
}

/** An issue as the dashboard draws it (github.ts's GithubIssue, the fields it reads). */
export function shapeIssue(node) {
  const repo = node.repository?.nameWithOwner || '';

  return {
    key:           `${ repo }#${ node.number }`,
    number:        node.number,
    url:           node.url,
    title:         node.title,
    repo,
    labels:        (node.labels?.nodes || []).map((l) => l.name),
    milestone:     node.milestone?.title || '',
    updatedAt:     node.updatedAt || '',
    projectStatus: null,
  };
}

/** One section's GraphQL answer as a partial myWork() answer. */
export function shapeSection(section, data) {
  const login = data?.viewer?.login || '';
  const nodes = (alias) => (data?.[alias]?.nodes || []).filter((n) => n && n.number);

  if (section === 'mine') {
    return {
      login, mine: nodes('mine').map((n) => shapePr(n, login)), reviewing: [], issues: []
    };
  }
  if (section === 'reviewing') {
    const requested = nodes('requested').map((n) => shapePr(n, login, true));
    const seen = new Set(requested.map((p) => p.key));
    const reviewed = nodes('reviewed').map((n) => shapePr(n, login, false)).filter((p) => !seen.has(p.key));

    return {
      login, mine: [], reviewing: [...requested, ...reviewed], issues: []
    };
  }

  return {
    login, mine: [], reviewing: [], issues: nodes('issues').map(shapeIssue)
  };
}

/** Ask GitHub. Throws `GitHub answered <status>` the way github.ts does, so a 50x can be retried. */
export async function askGithub(token, query, fetchImpl = fetch) {
  const resp = await fetchImpl('https://api.github.com/graphql', {
    method:  'POST',
    headers: {
      authorization: `Bearer ${ token }`, 'content-type': 'application/json', 'user-agent': 'conversation-api'
    },
    body: JSON.stringify({ query }),
  });

  if (!resp.ok) {
    throw new Error(`GitHub answered ${ resp.status }.`);
  }
  const body = await resp.json();

  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join(' '));
  }

  return body.data;
}

// ── Software projects ─────────────────────────────────────────────────────────────────────────

/**
 * One query per card (projects.mjs, CARDS): the default branch's checks, the open milestones of
 * the repository its issues live in with how much of the card's own work is open and closed in
 * each (narrowed by its `ui` label when its product shares the repository), and its open bugs.
 */
export function projectQuery(card) {
  const [owner, name] = card.repo.split('/');
  const [iOwner, iName] = card.issues.split('/');
  const labels = card.ui ? `, labels: [${ JSON.stringify(card.ui) }]` : '';
  const bugs = `repo:${ card.issues } is:issue is:open ${ card.bugs.map((l) => `label:${ JSON.stringify(l).slice(1, -1).includes(' ') ? JSON.stringify(l) : l }`).join(' ') }`;

  return `query {
    code: repository(owner: ${ JSON.stringify(owner) }, name: ${ JSON.stringify(name) }) {
      defaultBranchRef { target { ... on Commit { statusCheckRollup { state } } } }
    }
    tracker: repository(owner: ${ JSON.stringify(iOwner) }, name: ${ JSON.stringify(iName) }) {
      milestones(states: OPEN, first: 40, orderBy: { field: CREATED_AT, direction: DESC }) { nodes {
        title url
        open: issues(states: OPEN${ labels }) { totalCount }
        closed: issues(states: CLOSED${ labels }) { totalCount }
      } }
    }
    bugs: search(query: ${ JSON.stringify(bugs) }, type: ISSUE, first: 1) { issueCount }
  }`;
}

const BUILD = {
  SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'running', EXPECTED: 'running'
};

/** A card's answer: `{ id, build, milestones: [{ title, url, open, closed }], bugs }`. */
export function shapeProject(card, data) {
  return {
    id:         card.id,
    build:      BUILD[data?.code?.defaultBranchRef?.target?.statusCheckRollup?.state] || '',
    milestones: (data?.tracker?.milestones?.nodes || []).map((m) => ({
      title: m.title, url: m.url, open: m.open?.totalCount || 0, closed: m.closed?.totalCount || 0
    })),
    bugs: data?.bugs?.issueCount ?? null,
  };
}
