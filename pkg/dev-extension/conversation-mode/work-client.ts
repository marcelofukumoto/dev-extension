// Conversation mode: the page's side of conversation-api (server/server.mjs).
//
// The server asks GitHub and keeps the answer; the page reads it once (GET /work), then listens on
// its WebSocket for every new answer, and asks for a refresh (POST /refresh) when somebody presses
// refresh or a chat finishes a turn - the server decides whether it is too soon. All of it through
// the apiserver's service proxy, behind Rancher's login, the way the page reaches dev-api.

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const WORK_API = '/k8s/clusters/local/api/v1/namespaces/dev-system/services/http:conversation-api:8080/proxy';

function csrf(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)CSRF=([^;]*)/);

  return { 'X-Api-Csrf': match ? decodeURIComponent(match[1]) : 'CSRF' };
}

/** The server's latest answer, or null when it is not there (not deployed, restarting). */
export async function fetchWork(timeoutMs = 8000): Promise<Json | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);

  try {
    const resp = await fetch(`${ WORK_API }/work`, { headers: { Accept: 'application/json' }, signal: stop.signal });

    if (!resp.ok) {
      return null;
    }
    const body = await resp.json();

    return body?.type === 'work' ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask for a refresh. `started: false` means the last answer is under a minute old. */
export async function requestRefresh(reason: string): Promise<{ started: boolean } | null> {
  try {
    const resp = await fetch(`${ WORK_API }/refresh?reason=${ encodeURIComponent(reason) }`, {
      method: 'POST', headers: { Accept: 'application/json', ...csrf() }
    });

    return resp.ok || resp.status === 202 ? await resp.json() : null;
  } catch {
    return null;
  }
}

/**
 * Listen for answers. Reconnects on its own, backing off to a minute, until `close()`.
 * `onWork` gets each `{ type: 'work', at, work, errors, refreshing }` the server pushes.
 */
export function listenForWork(onWork: (m: Json) => void): { close: () => void } {
  let socket: WebSocket | null = null;
  let retry = 2000;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) {
      return;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

    socket = new WebSocket(`${ scheme }://${ window.location.host }${ WORK_API }/ws`);
    socket.onopen = () => {
      retry = 2000;
    };
    socket.onmessage = (e) => {
      let m: Json;

      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m?.type === 'work') {
        onWork(m);
      }
    };
    socket.onclose = () => {
      if (!closed) {
        timer = setTimeout(open, retry);
        retry = Math.min(60000, retry * 2);
      }
    };
  };

  open();

  return {
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      socket?.close();
    },
  };
}
