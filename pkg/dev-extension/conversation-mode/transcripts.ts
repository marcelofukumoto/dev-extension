// Conversation mode: what the chats' transcripts say, read in the agent pod.
//
// One exec for every chat at once: for each, the first thing the person said (to name the chat
// by), and the URLs and `owner/repo#n` references in what was said - the people's messages and
// claude's prose, never tool output, which is full of URLs nobody chose to show. The transcript is the one claude keeps for the
// repo's working directory, found by the id the pane recorded (/workspace/sessions/<id>.id).
import { podExecOnce, clusterBase } from '../api';
import { waitForStudio } from '../conversations';
import { CONVERSATION_HOME, CONVERSATION_REPO } from './config.mjs';

export interface ChatTranscript {
  /** The first message a person sent, up to 600 characters; '' before there is one. */
  first: string;
  /** URLs in the conversation's messages, oldest first, at most 200. */
  urls: string[];
}

// Run with node in the agent pod. Ids are checked before they reach a path.
const READ = `
const fs = require('fs');
const [home, projKey, ...ids] = process.argv.slice(1);
const URL_RE = /https?:\\/\\/[^\\s<>()"'\`[\\]{}|\\\\^]+/g;
const REF_RE = /(?:^|[\\s(\\[])([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)#(\\d+)\\b/g;
const out = {};
const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\\n') : '';
for (const id of ids) {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) continue;
  let uuid = '';
  try { uuid = fs.readFileSync(home.replace(/\\/[^/]+$/, '') + '/sessions/' + id + '.id', 'utf8').trim(); } catch (e) {}
  if (!/^[0-9a-f-]{36}$/.test(uuid)) { out[id] = { first: '', urls: [] }; continue; }
  let lines = [];
  try { lines = fs.readFileSync(home + '/.claude/projects/' + projKey + '/' + uuid + '.jsonl', 'utf8').split('\\n'); } catch (e) {}
  let first = '';
  const urls = [];
  for (const line of lines) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch (x) { continue; }
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    if (e.isMeta || e.isSidechain) continue;
    const content = e.message && e.message.content;
    if (Array.isArray(content) && content.some((c) => c && c.type === 'tool_result')) continue;
    const text = textOf(content);
    if (!text || /^\\s*</.test(text)) continue;
    if (e.type === 'user' && !first) first = text.slice(0, 600);
    for (const u of text.match(URL_RE) || []) urls.push(u);
    for (const m of text.matchAll(REF_RE)) urls.push('https://github.com/' + m[1] + '/issues/' + m[2]);
  }
  out[id] = { first, urls: urls.slice(-200) };
}
process.stdout.write(JSON.stringify(out));
`;

/** What each chat's transcript says, by chat id. Chats with no transcript yet read as empty. */
export async function readTranscripts(ids: string[]): Promise<Record<string, ChatTranscript>> {
  if (!ids.length) {
    return {};
  }
  const api = await waitForStudio();
  const pod = api ? await api.agent.pod().catch(() => null) : null;

  if (!api || !pod) {
    return {};
  }
  const projKey = CONVERSATION_REPO.replace(/[/.]/g, '-');
  const out = await podExecOnce(api.agent.namespace, pod, api.agent.container, ['node', '-e', READ, CONVERSATION_HOME, projKey, ...ids], clusterBase('local'));

  try {
    return JSON.parse(out.trim() || '{}');
  } catch {
    return {};
  }
}
