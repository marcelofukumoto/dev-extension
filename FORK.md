# This fork

marcelofukumoto/dev-extension is codyrancher/dev-extension plus a Conversation mode, published
as its own Helm repository at https://marcelofukumoto.github.io/dev-extension and installed on
mf-dev in place of the upstream chart (both register the same `dev` product, so only one can be
installed).

## Keeping it mergeable

Upstream changes almost daily, so our code stays out of its way:

- New code lives in new files. The edits to upstream files are kept small and listed here, so a
  merge conflict is one of these and nothing else.
- Merge upstream into `main` (`git fetch upstream && git merge upstream/main`), then set the
  version below again.

Edits to upstream files: none yet.

## Version

`<upstream minor>.<upstream patch × 100 + n>`: upstream 0.3.722 is our 0.3.72201, 0.3.72202, …
and upstream 0.3.723 is our 0.3.72301. A version of ours always sorts above the upstream release
it is based on, and a bump of `pkg/dev-extension/package.json` on `main` is what publishes
(`.github/workflows/build-extension-charts.yml`).
