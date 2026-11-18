# Conversation mode on the node

What Conversation mode needs on mf-dev outside the extension, kept here so it is versioned. None of
it is part of the bundle; it is installed by hand.

| File | Installed at (node path) | In the pods |
|------|--------------------------|-------------|
| `conv-shell` | `/var/lib/rancher/dev-workspaces/.conversation/bin/conv-shell` (mode 755, uid 1000) | `/workspaces/.conversation/bin/conv-shell` |
| `conv-root-setup` | `/var/lib/rancher/dev-workspaces/.conversation/bin/conv-root-setup` (mode 755) | run as root by conv-shell, once per container: Chromium's apt libraries |
| `mf-dev-signing.pub` | `/var/lib/rancher/dev-workspaces/.conversation/.home/.ssh/` (the private key beside it, mode 600, never in this repo) | added to GitHub as Marcelo's SSH **signing** key |
| `CLAUDE.local.md` | `/var/lib/rancher/dev-workspaces/.conversation/rancher-interrupt-duty/CLAUDE.local.md` (in `.git/info/exclude`) | the repo's root |

Also on the node, not in here:

- the interrupt-duty checkout, `/workspaces/.conversation/rancher-interrupt-duty`
- `/workspaces/.conversation/.home/.gitconfig`: Marcelo Fukumoto <marcelo.fukumoto@suse.com>, `gpg.format ssh`,
  commits and tags signed with `mf-dev-signing`, `gh auth git-credential` for github.com
- Playwright: `@playwright/cli@0.1.18` in `/workspaces/.conversation/npm-global` (`npm install -g --prefix`),
  Chromium in `/workspaces/.shared/playwright`
- the Secret's `kubeconfig.<name>` keys, which conv-shell writes to the repo's `kubeconfig/<name>`
- the tools in `/workspaces/.conversation/bin`: kubectl 1.33.5, helm 4.2.3 (`helm`), helm 3.22.1 (`helm3`),
  aws-cli v2 (installed from inside the lte-duty pod so its links use pod paths)
- the Secret `dev-system/conversation-env` (key `.env`) and the ConfigMap `dev-system/conversation-links`
- the `lte-duty` workspace, whose pod the commands run in

To update a file: copy it to the node path above with `install -m 755` (or 644). conv-shell is read
on every command, so the next command uses the new one.
