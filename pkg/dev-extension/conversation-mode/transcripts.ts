// Conversation mode: what the chats' transcripts say, read in the agent pod.
//
// One exec for every chat at once: for each, the first thing the person said (to name the chat
// by), the URLs and `owner/repo#n` references in what was said, and what the agent is doing now.
// The script is transcript-read.mjs's, which says what each of those is.
import { podExecOnce, clusterBase } from '../api';
import { waitForStudio } from '../conversations';
import { CONVERSATION_HOME, CONVERSATION_REPO } from './config.mjs';
import { TRANSCRIPT_READ } from './transcript-read.mjs';

export interface ChatTranscript {
  /** The first message a person sent, up to 600 characters; '' before there is one. */
  first: string;
  /** URLs in the conversation's messages, oldest first, at most 200. */
  urls: string[];
  /** What the agent did last, in a few words, and when (ISO); null before it did anything. */
  now: { text: string, at: string } | null;
  /** The step its to-do list marks in progress; '' when there is none. */
  step: string;
}


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
  const out = await podExecOnce(api.agent.namespace, pod, api.agent.container, ['node', '-e', TRANSCRIPT_READ, CONVERSATION_HOME, projKey, ...ids], clusterBase('local'));

  try {
    return JSON.parse(out.trim() || '{}');
  } catch {
    return {};
  }
}
