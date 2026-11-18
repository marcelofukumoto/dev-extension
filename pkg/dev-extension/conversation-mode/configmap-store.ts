// Conversation mode's shared state: a JSON document in one key of a ConfigMap in dev-system.
//
// A ConfigMap rather than browser storage so every browser and the agents see the same thing - an
// agent can read or add to it with kubectl from the chat itself. Written whole, with the
// resourceVersion it was read at, and read again and re-applied on a conflict, so two writers do
// not lose each other's change silently. links.ts (which chat is about what) and marks.ts
// ("Nothing to do") are the two documents.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const NAMESPACE = 'dev-system';
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

export interface JsonStore<T> {
  /** The document, or `empty()` when the ConfigMap is not there yet. */
  read(): Promise<T>;
  /** Read, let `change` edit it, write it back; again on a conflict. Resolves to what was written. */
  update(change: (doc: T) => void): Promise<T>;
}

/**
 * The document in `name`'s `key`. `what` names it in errors ("The chat links could not be read").
 */
export function configMapStore<T>(name: string, key: string, what: string, empty: () => T): JsonStore<T> {
  let resourceVersion = '';

  async function read(): Promise<T> {
    const { status, body } = await call(`${ BASE }/${ name }`);

    if (status === 404) {
      resourceVersion = '';

      return empty();
    }
    if (status >= 300) {
      throw new Error(body?.message || `${ what } could not be read (HTTP ${ status }).`);
    }
    resourceVersion = body?.metadata?.resourceVersion || '';
    try {
      return JSON.parse(body?.data?.[key] || 'null') || empty();
    } catch {
      return empty();
    }
  }

  async function update(change: (doc: T) => void): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await read();

      change(doc);
      const data = { [key]: JSON.stringify(doc, null, 2) };
      const { status, body } = resourceVersion ? await call(`${ BASE }/${ name }`, {
        method: 'PUT',
        body:   JSON.stringify({
          apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: NAMESPACE, resourceVersion }, data
        }),
      }) : await call(BASE, {
        method: 'POST',
        body:   JSON.stringify({
          apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: NAMESPACE, labels: { 'dev.rancher.io/kind': name } }, data
        }),
      });

      if (status === 409) {
        continue;
      }
      if (status >= 300) {
        throw new Error(body?.message || `${ what } could not be saved (HTTP ${ status }).`);
      }
      resourceVersion = body?.metadata?.resourceVersion || '';

      return doc;
    }
    throw new Error(`${ what } kept changing while being saved; try again.`);
  }

  return { read, update };
}
