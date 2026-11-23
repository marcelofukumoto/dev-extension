// Conversation mode: the script transcripts.ts runs with `node -e` in the agent pod, kept here as
// a module so it is tested by running it (tests/conversation-mode.test.mjs) the way the pod does.
//
// argv: <home> <project key> <chat id>... - prints, as JSON by chat id:
//   first  the first thing a person said (to name the chat by), up to 600 characters
//   urls   the URLs and `owner/repo#n` references in what was said - the people's messages and
//          claude's prose, never tool output, which is full of URLs nobody chose to show
//   now    what the agent did last, in a few words, and when: the tool it called (the command's
//          own description, the file it edits, the question it asks) or the first line it wrote
//   step   the step its to-do list marks in progress, '' when there is none
//   last   when the chat last moved (ISO): its newest message, either side's - or, for a chat
//          that has not run yet, when it was made (its sessions/<id> directory); '' when unknown
//   said   the last message a person sent, `{ text, at }` (up to 1500 characters), or null: what
//          the chat was last asked, which says where it stands
// The transcript is the one claude keeps for the repo's working directory, found by the id the
// pane recorded (/workspace/sessions/<id>.id). Ids are checked before they reach a path.
export const TRANSCRIPT_READ = `
const fs = require('fs');
const [home, projKey, ...ids] = process.argv.slice(1);
const URL_RE = /https?:\\/\\/[^\\s<>()"'\`[\\]{}|\\\\^]+/g;
// The punctuation a sentence puts after a URL - "see https://x/, then" - is not the URL's (linkify.mjs, cleanUrl).
const TRAILING = /[.,;:!?*_~>]+$/;
const REF_RE = /(?:^|[\\s(\\[])([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)#(\\d+)\\b/g;
const out = {};
const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\\n') : '';
const short = (s, n) => { s = String(s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
const host = (u) => { try { return new URL(u).host; } catch (e) { return short(u, 60); } };
function toolText(b) {
  const i = b.input || {};
  switch (b.name) {
    case 'Bash': return i.description ? short(i.description, 120) : '$ ' + short(String(i.command || '').split('\\n')[0], 100);
    case 'Read': return 'Reading ' + base(i.file_path);
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return 'Editing ' + base(i.file_path || i.notebook_path);
    case 'Write': return 'Writing ' + base(i.file_path);
    case 'Grep': return 'Searching for "' + short(i.pattern, 60) + '"';
    case 'Glob': return 'Looking for ' + short(i.pattern, 60);
    case 'WebFetch': return 'Reading ' + host(i.url);
    case 'WebSearch': return 'Searching the web: ' + short(i.query, 80);
    case 'Task': case 'Agent': return 'Agent: ' + short(i.description || i.prompt, 100);
    case 'AskUserQuestion': return 'Asking: ' + short(((i.questions || [])[0] || {}).question, 120);
    case 'Skill': return 'Using the ' + short(i.skill || i.command, 40) + ' skill';
    default: return String(b.name || 'a tool').replace(/^mcp__[^_]+(?:_[^_]+)*__/, '');
  }
}
const sessions = home.replace(/\\/[^/]+$/, '') + '/sessions/';
const madeAt = (id) => { try { const st = fs.statSync(sessions + id); return new Date(st.birthtimeMs || st.mtimeMs).toISOString(); } catch (e) { return ''; } };
for (const id of ids) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) continue;
  let uuid = '';
  try { uuid = fs.readFileSync(sessions + id + '.id', 'utf8').trim(); } catch (e) {}
  if (!/^[0-9a-f-]{36}$/.test(uuid)) { out[id] = { first: '', urls: [], now: null, step: '', last: madeAt(id), said: null }; continue; }
  let lines = [];
  try { lines = fs.readFileSync(home + '/.claude/projects/' + projKey + '/' + uuid + '.jsonl', 'utf8').split('\\n'); } catch (e) {}
  let first = '';
  let now = null;
  let step = '';
  let last = '';
  let said = null;
  const urls = [];
  for (const line of lines) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    if (e.isMeta || e.isSidechain) continue;
    if (e.timestamp && e.timestamp > last) last = e.timestamp;
    const content = e.message && e.message.content;
    if (e.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (!b) continue;
        if (b.type === 'tool_use' && b.name === 'TodoWrite') {
          const doing = ((b.input || {}).todos || []).find((t) => t && t.status === 'in_progress');
          step = doing ? short(doing.activeForm || doing.content, 120) : '';
        } else if (b.type === 'tool_use') {
          now = { text: toolText(b), at: e.timestamp || '' };
        } else if (b.type === 'text' && String(b.text || '').trim()) {
          now = { text: short(String(b.text).trim().split('\\n').find((l) => l.trim()).replace(/^[#>*\\s-]+/, ''), 140), at: e.timestamp || '' };
        }
      }
    }
    if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) continue;
    const text = textOf(content);
    if (!text || /^\\s*</.test(text)) continue;
    if (e.type === 'user' && !first) first = text.slice(0, 600);
    if (e.type === 'user' && !/^\\s*\\[Request interrupted/.test(text)) said = { text: text.trim().slice(0, 1500), at: e.timestamp || '' };
    for (const u of text.match(URL_RE) || []) { const url = u.replace(TRAILING, ''); if (url) urls.push(url); }
    for (const m of text.matchAll(REF_RE)) urls.push('https://github.com/' + m[1] + '/issues/' + m[2]);
  }
  out[id] = { first, urls: urls.slice(-200), now, step, last: last || madeAt(id), said };
}
process.stdout.write(JSON.stringify(out));
`;

/**
 * What to say a chat is doing, from its transcript and its state, or '' when there is nothing to
 * say: only a chat that is working or waiting for you has a "now" worth showing.
 */
export function doingText(transcript, state) {
  if (state !== 'working' && state !== 'input') {
    return '';
  }
  const now = transcript?.now?.text || '';
  const step = transcript?.step || '';

  if (state === 'input') {
    return now;
  }
  if (step && now && step !== now) {
    return `${ step } — ${ now }`;
  }

  return step || now;
}
