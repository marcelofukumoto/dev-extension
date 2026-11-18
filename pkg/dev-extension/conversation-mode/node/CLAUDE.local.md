# Where this runs: mf-dev, not the Mac

This checkout is the interrupt-duty project running in Conversation mode on mf-dev
(https://mf-dev.ui.rancher.space), our fork of codyrancher/dev-extension. The same repo, skills and
memory as on Marcelo's Mac, in a different machine. Read this before trusting a path from memory.

- **The repo is at `/workspaces/.conversation/rancher-interrupt-duty`**. Memory and older notes say
  `/Users/mfukumoto/Projects/rancher-interrupt-duty`: that is the Mac copy. Translate, do not create it.
- **Your file tools and your commands run in two different pods, with two different `/tmp`s.**
  Read/Write/Edit run in the agent pod; Bash runs in the `lte-duty` pod. Your scratchpad (under
  `/tmp/claude-1000/...`) exists only for the file tools, so a file written there is "No such file" to
  `cat`, `jq` or a script. Anything both sides need goes under `/workspaces/.conversation/tmp/` (shared,
  yours, cleaned by hand): write it there with Write and read it from Bash, or the other way round.
- **Commands run in the `lte-duty` workspace pod** (node:24, Debian 12) through
  `/workspaces/.conversation/bin/conv-shell`. Your file tools run in the agent pod; both see
  `/workspaces/...` at the same path.
- **Tools**: `kubectl` 1.33, `helm` (v4, as on the Mac), `helm3` (v3 - use it for the Rancher chart,
  helm 4 hangs on it), `aws`, `gh`, `jq`, `python3`, `node`, `yarn`, `ffmpeg`, `ssh`, `git`. Installed
  in `/workspaces/.conversation/bin`, on PATH. **Not here yet**: `roa` (its Linux build needs glibc 2.38,
  the image has 2.36), Docker (so no k3s/RKE2-in-a-container, no fleet agents), Playwright/Chromium,
  `~/.config/roa`. Say so when a task needs one rather than working around it.
- **Never print a secret.** Not a value from `.env`, the workspace env, a kubeconfig, a Secret or a
  token in a file: every conversation's transcript is stored in the agent pod, and anything printed
  there stays. Use a variable by name (`"$JIRA_PAT"`), check one exists with `${VAR:+set}`, and never
  `cat .env`, `env`, `printenv`, `set` or `kubectl get secret -o yaml` where the output would show. If a
  value lands in the output by accident, say so, so it can be rotated.
- **Secrets**: `.env` is copied in from the Secret `dev-system/conversation-env` by conv-shell, and
  `GH_TOKEN` comes from the workspace's own env. `kubeconfig/`, `id_rsa_mf` and AWS credentials are not
  here yet - they get added one by one, when a task needs them.
- **Memory** is a separate copy from the Mac's, taken 2026-11-18 (baseline in
  `/workspaces/.conversation/memory-baseline-2026-11-18`). Both sides keep writing; they are merged by
  hand from time to time.
- `$HOME` for commands is `/workspaces/.conversation/.home`.
