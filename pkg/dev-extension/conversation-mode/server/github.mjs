// conversation-api: what it asks GitHub, and the shape it answers in.
//
// The page's dashboard draws GithubPr / GithubIssue rows as github.ts's myWork() answers them; the
// server answers in the same shape (the fields projects.mjs and the dashboard read), so the page
// does not care which of the two asked. One query per product and section, as the page learned to:
// GitHub gives a GraphQL query ten seconds, and all of a product's searches in one did not fit.

const FAILED_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATUS = new Set(['FAILURE', 'ERROR']);

const PR_FIELDS = `
  number title url isDraft updatedAt reviewDecision
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state contexts(first: 60) { nodes {
    __typename ... on CheckRun { status conclusion } ... on StatusContext { state }
  } } } } } }
  latestOpinionatedReviews(first: 10) { nodes { state } }
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

/** What a pull request's checks add up to: failing, pending, total. */
export function checksOf(node) {
  const rollup = node?.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const contexts = rollup?.contexts?.nodes || [];
  let failing = 0;
  let pending = 0;

  for (const c of contexts) {
    if (c.__typename === 'CheckRun') {
      if (c.status !== 'COMPLETED') {
        pending++;
      } else if (FAILED_RUN.has(c.conclusion)) {
        failing++;
      }
    } else if (c.__typename === 'StatusContext') {
      if (FAILED_STATUS.has(c.state)) {
        failing++;
      } else if (c.state === 'PENDING' || c.state === 'EXPECTED') {
        pending++;
      }
    }
  }

  return rollup ? {
    state: rollup.state || '', failing, pending, total: contexts.length
  } : null;
}

/** A pull request as the dashboard draws it (github.ts's GithubPr, the fields it reads). */
export function shapePr(node, login, reviewRequested = false) {
  const repo = node.repository?.nameWithOwner || '';
  const mine = (node.reviews?.nodes || []).filter((r) => r?.author?.login === login && r.submittedAt);
  const reviewedAt = mine.length ? mine[mine.length - 1].submittedAt : '';
  const approved = node.reviewDecision === 'APPROVED' || (node.latestOpinionatedReviews?.nodes || []).some((r) => r.state === 'APPROVED');

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
