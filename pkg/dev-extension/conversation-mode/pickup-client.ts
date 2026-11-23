// Conversation mode: Find work's side of conversation-api (server/server.mjs, GET /pickup).
//
// The server asks GitHub for every tab (pickup.mjs) the first time a page asks, keeps the answer a
// quarter of an hour, and asks again on `refresh` at most once a minute. A first answer takes a few
// seconds - every tab is a query or two - so the wait is longer than /work's.
import { WORK_API } from './work-client';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `{ type: 'pickup', at, tabs: [{ id, name, url, filter, issues, total, truncated, error }], errors }`. */
export async function fetchPickup(refresh = false, timeoutMs = 60000): Promise<Json> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);

  try {
    const resp = await fetch(`${ WORK_API }/pickup${ refresh ? '?refresh=1' : '' }`, { headers: { Accept: 'application/json' }, signal: stop.signal });
    const body = await resp.json().catch(() => ({}));

    if (!resp.ok || body?.type !== 'pickup') {
      throw new Error(body?.error || body?.message || `conversation-api answered ${ resp.status }`);
    }

    return body;
  } catch (e) {
    const err = e as { name?: string, message?: string };

    throw new Error(err?.name === 'AbortError' ? 'GitHub took too long to answer' : (err?.message || String(e)));
  } finally {
    clearTimeout(timer);
  }
}
