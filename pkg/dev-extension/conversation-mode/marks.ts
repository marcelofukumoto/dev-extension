// "Nothing to do" marks (nothing-to-do.mjs), kept in the ConfigMap dev-system/conversation-attention,
// key `marks.json`, so every browser sees them and an agent can read why rows were marked:
// `kubectl -n dev-system get configmap conversation-attention -o jsonpath='{.data.marks\.json}'`.
import { configMapStore } from './configmap-store';
import { emptyMarks } from './nothing-to-do.mjs';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const store = configMapStore<Json>('conversation-attention', 'marks.json', 'The "Nothing to do" marks', emptyMarks);

export function readMarks(): Promise<Json> {
  return store.read();
}

export function updateMarks(change: (doc: Json) => void): Promise<Json> {
  return store.update(change);
}
