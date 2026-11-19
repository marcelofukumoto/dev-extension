// "Nothing to do": a row of Needs your attention you checked and found nothing in to work on.
//
// A mark is kept with the row's stamp - what the pull request looked like when it was marked (when
// GitHub last saw it change, its failing checks, its review decision, whether it is a draft, and
// the kind of row it was). Anything at all that happens to it changes the stamp - a comment, a
// push, a review, a check, a label - and the row is back: the mark only ever holds for the exact
// state it was given for. A question's stamp is the last thing its agent did.
//
// Why each was marked is kept too, so the next one is a click (the reasons used before, most used
// first), and so the dashboard can suggest the mark: a row like ones marked before - same kind,
// same draft-ness, and the same author or the same reason it showed - gets the reason they got,
// and a review of a draft gets "Draft" without having been taught.
//
// The document (marks.ts keeps it in the ConfigMap dev-system/conversation-attention):
//   marks:   { <row key>: { kind, stamp, reason, at, title } }
//   reasons: { <reason>: { used, last } }
//   history: [{ reason, kind, draft, repo, author, why, at }]   (the newest HISTORY_KEPT)

export const HISTORY_KEPT = 300;

/** A marked row whose pull request has not been seen to change for this long is forgotten. */
export const MARK_KEPT_MS = 60 * 24 * 60 * 60 * 1000;

/** The reasons offered before any have been used. */
export const STARTER_REASONS = [
  'Draft - not ready for review yet',
  'Waiting on someone else',
  'Not mine to do',
  'Already handled',
];

export const DRAFT_REASON = STARTER_REASONS[0];

/** The rows about somebody else's pull request, where who wrote it says something. */
const REVIEW_KINDS = new Set(['review', 'rereview', 'waiting']);

export function emptyMarks() {
  return { marks: {}, reasons: {}, history: [] };
}

/** A question's stamp: the last thing its agent did. (A pull request's is projects.mjs's prStamp.) */
export function questionStamp(transcript) {
  return `question|${ transcript?.now?.at || '' }`;
}

/** attentionRows()'s rows with each question's stamp filled in from its transcript. */
export function withQuestionStamps(rows, transcripts = {}) {
  return rows.map((r) => (r.kind === 'question' ? { ...r, stamp: questionStamp(transcripts[r.chatId]) } : r));
}

/** The keys of the rows marked "Nothing to do" that still hold: the rail puts their items aside. */
export function quietKeys(rows, doc) {
  return new Set(rows.filter((r) => isQuiet(r, doc)).map((r) => r.key));
}

/** Whether a row is marked "Nothing to do" and nothing has happened to it since. */
export function isQuiet(row, doc) {
  const mark = doc?.marks?.[row.key];

  return !!mark && !!row.stamp && mark.stamp === row.stamp;
}

/** The row's reason, with the parts that differ from one pull request to the next taken out. */
export function whyKey(row) {
  return String(row.why || '')
    .replace(/"[^"]*"/g, '')
    .replace(/@[\w-]+/g, '@')
    .replace(/\(\+\d+ more\)/g, '')
    .replace(/\d+/g, '#')
    .trim();
}

/** What a mark learns from: the things a like row would share. */
export function features(row) {
  return {
    kind:   row.kind,
    draft:  !!row.draft,
    repo:   row.subject?.repo || '',
    author: row.author || '',
    why:    whyKey(row),
  };
}

/**
 * The reason to suggest for a row that is not marked, or null: a reason marks of rows like it
 * were given (the most used of them), else "Draft" for a review of a draft.
 */
export function suggestion(row, doc) {
  if (row.kind === 'question') {
    return null;
  }
  const f = features(row);
  const votes = {};

  for (const h of doc?.history || []) {
    if (h.kind !== f.kind || !!h.draft !== f.draft) {
      continue;
    }
    // The same author says something only about somebody else's pull request: on your own
    // (blocked, ready) the author is always you, and every row of yours would look alike.
    const alike = (REVIEW_KINDS.has(f.kind) && f.author && h.author === f.author) || (f.why && h.why === f.why);

    if (alike) {
      votes[h.reason] = (votes[h.reason] || 0) + 1;
    }
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

  if (best) {
    return { reason: best[0], from: 'learned' };
  }
  if (row.draft && (row.kind === 'review' || row.kind === 'rereview')) {
    return { reason: DRAFT_REASON, from: 'draft' };
  }

  return null;
}

/** The reasons to offer, most used first, then the starters nobody has used yet. */
export function reasonList(doc, max = 8) {
  const used = Object.entries(doc?.reasons || {})
    .sort((a, b) => (b[1].used - a[1].used) || String(b[1].last).localeCompare(String(a[1].last)))
    .map(([reason]) => reason);

  return [...used, ...STARTER_REASONS.filter((r) => !used.includes(r))].slice(0, max);
}

/** Mark a row "Nothing to do" (edits `doc`). */
export function mark(doc, row, reason, now = new Date().toISOString()) {
  const text = String(reason || '').trim() || 'Checked - nothing to do';

  doc.marks ||= {};
  doc.reasons ||= {};
  doc.history ||= [];
  doc.marks[row.key] = {
    kind: row.kind, stamp: row.stamp, reason: text, at: now, title: row.title || ''
  };
  doc.reasons[text] = { used: (doc.reasons[text]?.used || 0) + 1, last: now };
  doc.history.push({ reason: text, ...features(row), at: now });
  doc.history = doc.history.slice(-HISTORY_KEPT);

  return doc;
}

/** Take a row's mark away (edits `doc`). */
export function unmark(doc, key) {
  if (doc.marks) {
    delete doc.marks[key];
  }

  return doc;
}

/** Forget marks nobody will see again: old, and for a row that is no longer there (edits `doc`). */
export function prune(doc, liveKeys, now = Date.now()) {
  for (const [key, m] of Object.entries(doc.marks || {})) {
    if (!liveKeys.has(key) && now - (Date.parse(m.at) || 0) > MARK_KEPT_MS) {
      delete doc.marks[key];
    }
  }

  return doc;
}
