// Conversation mode: the links worth a click in a conversation, and a chat's title from its first
// message. Plain functions over text, so the rules are tested without a page.

const URL_RE = /https?:\/\/[^\s<>()"'`[\]{}|\\^]+/g;
const TRAILING = /[.,;:!?*_~>]+$/;

/**
 * A URL without the punctuation a sentence put after it ("see https://x/, then" is https://x/).
 * Every URL a chip is made from goes through it, wherever it was found or pinned.
 */
export function cleanUrl(url = '') {
  return String(url || '').trim().replace(TRAILING, '');
}

/** Every URL in a text, in order, once each, without the punctuation a sentence puts after it. */
export function extractUrls(text = '') {
  const seen = new Set();
  const out = [];

  for (const raw of String(text).match(URL_RE) || []) {
    const url = cleanUrl(raw);

    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  return out;
}

/**
 * `owner/repo#123` references in prose, as GitHub links. A reference does not say whether it is a
 * pull request or an issue; `/issues/` is the one GitHub redirects to the pull request when it is one.
 */
export function extractRefs(text = '') {
  const out = [];

  for (const m of String(text).matchAll(/(?:^|[\s(\[])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g)) {
    out.push(`https://github.com/${ m[1] }/issues/${ m[2] }`);
  }

  return out;
}

/** A GitHub pull request or issue in a URL - `/files`, `#discussion_r…` and the like included. */
export function githubRef(url = '') {
  const m = String(url).match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)/);

  if (!m) {
    return null;
  }
  const kind = m[2] === 'pull' ? 'pr' : 'issue';

  return {
    repo: m[1], number: Number(m[3]), kind, url: `https://github.com/${ m[1] }/${ m[2] }/${ m[3] }`
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * What a link is, and what to call it on a chip.
 *
 * - pr / issue: a GitHub pull request or issue, as `repo#n`
 * - ci: a GitHub Actions run
 * - preview: a dashboard preview this project deploys (`rancher<slug>r.<domain>`)
 * - page: a board or a review page on the mf hosts (`<name>.mf-main.ui.rancher.space`, …)
 * - env: a Rancher of ours (`mf-dev.ui.rancher.space`, `mf-rancher-16.ui.rancher.space`)
 * - jira, doc, other
 */
export function classifyUrl(url) {
  const ref = githubRef(url);

  if (ref) {
    return {
      kind: ref.kind, label: `${ ref.repo.split('/').pop() }#${ ref.number }`, url: ref.url, key: `${ ref.repo }#${ ref.number }`
    };
  }
  const host = hostOf(url);
  const first = host.split('.')[0];
  const run = url.match(/^https?:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/actions\/runs\/(\d+)/);

  if (run) {
    return {
      kind: 'ci', label: `${ run[1] } run`, url: url.replace(/\/job\/.*$/, ''), key: `ci:${ run[2] }`
    };
  }
  const jira = url.match(/^https?:\/\/jira\.suse\.com\/browse\/([A-Z][A-Z0-9]+-\d+)/);

  if (jira) {
    return {
      kind: 'jira', label: jira[1], url, key: `jira:${ jira[1] }`
    };
  }
  if (/\.(ui\.rancher\.space|sslip\.io)$/.test(host)) {
    if (/^rancher.+r$/.test(first) && !/^rancher-/.test(first)) {
      return {
        kind: 'preview', label: first.replace(/^rancher/, '').replace(/r$/, ''), url, key: `host:${ host }`
      };
    }
    if (/^mf-[\w-]+$/.test(first) && host.split('.').length <= 4) {
      return {
        kind: 'env', label: first, url, key: `host:${ host }`
      };
    }

    return {
      kind: 'page', label: first, url, key: `host:${ host }`
    };
  }
  if (/(^|\.)(confluence\.suse\.com|docs\.harvesterhci\.io|extensions\.rancher\.io|ranchermanager\.docs\.rancher\.com|longhorn\.io)$/.test(host)) {
    return {
      kind: 'doc', label: host.replace(/^www\./, ''), url, key: url
    };
  }

  return {
    kind: 'other', label: host.replace(/^www\./, '') || url, url, key: url
  };
}

/** The order chips are shown in: what the chat is about, then where to look at it, then the rest. */
const KIND_ORDER = ['subject', 'preview', 'page', 'pr', 'issue', 'ci', 'env', 'jira', 'doc', 'other'];

/**
 * A chat's links as chips: its subject first, then what an agent or a person pinned (`saved`),
 * then what the conversation itself mentioned (`urls`, newest last as in a transcript - shown
 * newest first within a kind). One chip per thing: a PR mentioned as `/files` and as `#issuecomment`
 * is one PR, and a host is one preview however many of its pages were linked.
 */
export function chatLinks({ subject = null, saved = [], urls = [] } = {}) {
  const byKey = new Map();
  const add = (chip, rank) => {
    if (!byKey.has(chip.key)) {
      byKey.set(chip.key, { ...chip, rank });
    }
  };

  if (subject?.url) {
    const c = classifyUrl(cleanUrl(subject.url));

    add({ ...c, kind: 'subject', sub: c.kind }, -1);
  }
  saved.forEach((l, i) => {
    const url = cleanUrl(l?.url);

    if (url) {
      add({ ...classifyUrl(url), label: l.label || classifyUrl(url).label }, i);
    }
  });
  [...urls].map(cleanUrl).filter(Boolean).reverse().forEach((u, i) => add(classifyUrl(u), 1000 + i));

  return [...byKey.values()]
    .sort((a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (a.rank - b.rank))
    .map(({ rank, ...chip }) => chip);
}

/**
 * A title from a chat's first message: its first line that says something, without markdown, cut
 * at a word inside `max`. '' when there is nothing to name it by.
 */
export function titleFromMessage(text = '', max = 60) {
  const line = String(text).split('\n')
    // A pasted image or file arrives as its path on a line of its own: not a thing to name a chat by.
    .map((l) => l.replace(/(^|\s)\/\S+\.(png|jpe?g|gif|webp|pdf|txt|log|json|ya?ml|md)\b/gi, ' '))
    .map((l) => l.replace(/https?:\/\/\S+/g, '').replace(/[#*`>_~]+/g, ' ').replace(/\s+/g, ' ').trim())
    .find((l) => l.length > 2) || '';

  if (line.length <= max) {
    return line;
  }
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');

  return `${ (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, '') }…`;
}

/** Whether a title is one this page made up ("Chat 3"), and so may be replaced by a better one. */
export function isDefaultTitle(title = '') {
  return /^Chat \d+$/.test(title);
}
