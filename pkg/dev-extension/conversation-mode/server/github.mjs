// conversation-api: what it asks GitHub, and the shape it answers in.
//
// The page's dashboard draws GithubPr / GithubIssue rows as github.ts's myWork() answers them; the
// server answers in the same shape (the fields projects.mjs and the dashboard read), so the page
// does not care which of the two asked. One query per product and section, as the page learned to:
// GitHub gives a GraphQL query ten seconds, and all of a product's searches in one did not fit.

const FAILED_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATUS = new Set(['FAILURE', 'ERROR']);

const PR_FIELDS = `
  number title url isDraft updatedAt reviewDecision mergeable mergeStateStatus body
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 60) { nodes {
    __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state }
  } } } } } }
  latestOpinionatedReviews(first: 10) { nodes { state body author { login } } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
  reviews(last: 30) { nodes { author { login } submittedAt state } }
`;

const ISSUE_FIELDS = `
  number title url updatedAt
  repository { nameWithOwner }
  milestone { title }
  labels(first: 10) { nodes { name } }
`;

/** The searches one section is, as `alias: query` pairs. */
export function sectionSearches(repos, section, maintained = []) {
  const scope = repos.map((r) => `repo:${ r }`).join(' ');
  const ours = repos.filter((r) => maintained.includes(r));

  if (section === 'mine') {
    return { mine: `${ scope } is:open is:pr author:@me archived:false` };
  }
  if (section === 'reviewing') {
    return {
      requested: `${ scope } is:open is:pr user-review-requested:@me -author:@me archived:false`,
      reviewed:  `${ scope } is:open is:pr reviewed-by:@me -author:@me archived:false`,
    };
  }
  if (section === 'maintained') {
    // Everything open in the repositories you maintain (projects.mjs, MAINTAINED); a query of its
    // own, so the review searches stay inside GitHub's ten seconds.
    return { maintained: `${ ours.map((r) => `repo:${ r }`).join(' ') } is:open is:pr -author:@me archived:false` };
  }

  return { issues: `${ scope } is:open is:issue assignee:@me archived:false` };
}

/** One GraphQL query for one section of one product. */
export function sectionQuery(repos, section, maintained = []) {
  const searches = sectionSearches(repos, section, maintained);
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

/**
 * Every reviewer and where each stands, as GitHub's Reviewers box shows them: `pending` (asked and
 * not answered since - a yellow dot), `changes` (red), `approved` (green), `commented` (grey). Asked
 * again outranks what they said before, as it does there. The author is not a reviewer.
 */
export function reviewersOf(node) {
  const author = node.author?.login || '';
  const out = new Map();

  for (const r of node.reviews?.nodes || []) {
    const login = r?.author?.login;

    if (login && login !== author && r.state === 'COMMENTED' && !out.has(login)) {
      out.set(login, { login, state: 'commented' });
    }
  }
  for (const r of node.latestOpinionatedReviews?.nodes || []) {
    const login = r?.author?.login;

    if (login && login !== author && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')) {
      out.set(login, { login, state: r.state === 'APPROVED' ? 'approved' : 'changes' });
    }
  }
  for (const r of node.reviewRequests?.nodes || []) {
    const who = r?.requestedReviewer;
    const login = who?.login || (who?.slug ? `team:${ who.slug }` : '');

    if (login) {
      out.set(login, { login, state: 'pending', ...(who.slug ? { team: true } : {}) });
    }
  }
  const order = {
    changes: 0, pending: 1, approved: 2, commented: 3
  };

  return [...out.values()].sort((a, b) => order[a.state] - order[b.state] || a.login.localeCompare(b.login));
}

/** The checklist boxes the description leaves unticked (rancher/dashboard's Description check wants them all). */
export function uncheckedBoxes(body) {
  return String(body || '').split('\n')
    .map((l) => l.match(/^\s*[-*]\s+\[ \]\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map((t) => (t.length > 120 ? `${ t.slice(0, 119) }…` : t))
    .slice(0, 5);
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
    // Your own standing verdict on it (APPROVED, CHANGES_REQUESTED), '' when you gave none.
    myReview:  opinions.find((r) => r.author?.login === login)?.state || '',
    reviewers: reviewersOf(node),
    unchecked: uncheckedBoxes(node.body),
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
  if (section === 'maintained') {
    // Yours to look at as the repository's maintainer. One that is also asked of you or reviewed by
    // you comes from those searches first (mergeWork keeps the first), and is that instead.
    return {
      login, mine: [], reviewing: nodes('maintained').map((n) => ({ ...shapePr(n, login, false), maintained: true })), issues: []
    };
  }

  return {
    login, mine: [], reviewing: [], issues: nodes('issues').map(shapeIssue)
  };
}

/**
 * Ask GitHub. Throws `GitHub answered <status>` the way github.ts does; an error worth asking again
 * for carries `retriable` - a 50x, and an answer that never came whole: a connection GitHub dropped
 * mid-answer (a 200 with nothing, or half of one, which JSON.parse would only call "Unexpected end
 * of JSON input") or one that could not be made.
 */
export async function askGithub(token, query, fetchImpl = fetch) {
  const retriable = (message) => Object.assign(new Error(message), { retriable: true });
  let resp;
  let text;

  try {
    resp = await fetchImpl('https://api.github.com/graphql', {
      method:  'POST',
      headers: {
        authorization: `Bearer ${ token }`, 'content-type': 'application/json', 'user-agent': 'conversation-api'
      },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) {
      throw Object.assign(new Error(`GitHub answered ${ resp.status }.`), { retriable: resp.status >= 500, answered: true });
    }
    text = await resp.text();
  } catch (e) {
    if (e.answered) {
      throw e;
    }
    throw retriable(`GitHub could not be reached (${ e.cause?.code || e.message }).`);
  }
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw retriable(text.trim() ? 'GitHub\'s answer was cut short.' : 'GitHub answered with nothing - the connection dropped.');
  }

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
