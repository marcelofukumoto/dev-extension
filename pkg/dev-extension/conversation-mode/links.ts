// Conversation mode's links: which chat is about which pull request or issue, and the pages that
// belong to it (previews, review pages).
//
// One ConfigMap, dev-system/conversation-links, key `links.json`: `{ "<chat id>": { subject,
// links } }`, kept as configmap-store.ts keeps its documents - so an agent can add a link with
// kubectl from the chat itself.
import { configMapStore } from './configmap-store';

export interface ChatSubject {
  repo: string;
  number: number;
  kind: 'pr' | 'issue';
  url: string;
  title: string;
}

export interface ChatLink {
  label: string;
  url: string;
}

export interface ChatLinks {
  subject?: ChatSubject;
  links?: ChatLink[];
}

export type LinkMap = Record<string, ChatLinks>;

const store = configMapStore<LinkMap>('conversation-links', 'links.json', 'The chat links', () => ({}));

/** The links, or an empty map when nothing has been linked yet. */
export function readLinks(): Promise<LinkMap> {
  return store.read();
}

/**
 * Change the links: `change` gets the current map and edits it. Read, changed and written again
 * on a conflict, so a link the agent added a moment ago is not overwritten by a stale page.
 */
export function updateLinks(change: (links: LinkMap) => void): Promise<LinkMap> {
  return store.update(change);
}
