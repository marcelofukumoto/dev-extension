// Conversation mode's links: which chat is about which pull request or issue, and the pages that
// belong to it (previews, review pages).
//
// One ConfigMap, dev-system/conversation-links, key `links.json`: `{ "<chat id>": { subject,
// links } }`. A ConfigMap rather than browser storage so every browser and the agent see the same
// thing - an agent can add a link with kubectl from the chat itself. Written whole, with the
// resourceVersion it was read at, so two writers do not lose each other's change silently.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

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

const NAMESPACE = 'dev-system';
const NAME = 'conversation-links';
const KEY = 'links.json';
const BASE = `/k8s/clusters/local/api/v1/namespaces/${ NAMESPACE }/configmaps`;

function csrf(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)CSRF=([^;]*)/);

  return { 'X-Api-Csrf': match ? decodeURIComponent(match[1]) : 'CSRF' };
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Json }> {
  const write = !!init.method && init.method !== 'GET';
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json', ...(write ? csrf() : {}), ...(init.headers || {})
    },
  });

  return { status: resp.status, body: await resp.json().catch(() => ({})) };
}

let resourceVersion = '';

/** The links, or an empty map when nothing has been linked yet. */
export async function readLinks(): Promise<LinkMap> {
  const { status, body } = await call(`${ BASE }/${ NAME }`);

  if (status === 404) {
    resourceVersion = '';

    return {};
  }
  if (status >= 300) {
    throw new Error(body?.message || `The chat links could not be read (HTTP ${ status }).`);
  }
  resourceVersion = body?.metadata?.resourceVersion || '';
  try {
    return JSON.parse(body?.data?.[KEY] || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * Change the links: `change` gets the current map and edits it. Read, changed and written again
 * on a conflict, so a link the agent added a moment ago is not overwritten by a stale page.
 */
export async function updateLinks(change: (links: LinkMap) => void): Promise<LinkMap> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const links = await readLinks();

    change(links);
    const data = { [KEY]: JSON.stringify(links, null, 2) };
    const { status, body } = resourceVersion ? await call(`${ BASE }/${ NAME }`, {
      method: 'PUT',
      body:   JSON.stringify({
        apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: NAME, namespace: NAMESPACE, resourceVersion }, data
      }),
    }) : await call(BASE, {
      method: 'POST',
      body:   JSON.stringify({
        apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: NAME, namespace: NAMESPACE, labels: { 'dev.rancher.io/kind': 'conversation-links' } }, data
      }),
    });

    if (status === 409) {
      continue;
    }
    if (status >= 300) {
      throw new Error(body?.message || `The chat links could not be saved (HTTP ${ status }).`);
    }
    resourceVersion = body?.metadata?.resourceVersion || '';

    return links;
  }
  throw new Error('The chat links kept changing while they were being saved; try again.');
}
