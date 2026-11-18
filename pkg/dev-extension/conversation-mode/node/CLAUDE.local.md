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
  helm 4 hangs on it), `aws`, `gh`, `jq`, `python3`, `node`, `yarn`, `ffmpeg`, `ssh`, `git`, and
  Playwright as on the Mac: `playwright-cli` 0.1.18 on PATH, `npm root -g` = its install, Chromium in
  `/workspaces/.shared/playwright`, so `load-playwright.mjs`, `record.mjs` and `cody-record.mjs` work.
  Right after a pod restart Chromium's system libraries are put back in the background (about 20 s,
  log in the pod's `/tmp/.conv-root-setup.log`): if a browser fails to start on missing libraries,
  wait and run it again. **Not here yet**: `roa` (its Linux build needs glibc 2.38, the image has
  2.36), Docker (so no k3s/RKE2-in-a-container, no fleet agents), `~/.config/roa`, the `id_rsa_mf`
  SSH key. Say so when a task needs one rather than working around it.
- **Kubeconfigs**: `kubeconfig/created-dashboard-2.yaml` (previews, review pages) and
  `kubeconfig/kube_config_server_mf.yaml` (the mf server, Harvester mode, boards) are here, from the
  same Secret as `.env`, so `preview/deploy-branch.sh` and the review-page scripts work as on the Mac.
  The duty pod has 12 GiB and 4 CPUs: enough for a dashboard production build, slower than the Mac.
- **Commits are signed** with mf-dev's own SSH signing key, as Marcelo Fukumoto
  <marcelo.fukumoto@suse.com> (`~/.gitconfig` in `/workspaces/.conversation/.home`); pushes use `gh`'s
  credentials. Commit with plain `git commit` (add `-s` where the repository wants DCO, as harvester
  repos do). Do not look for another way to commit, such as the GitHub API, to get around signing.
- **Never print a secret.** Not a value from `.env`, the workspace env, a kubeconfig, a Secret or a
  token in a file: every conversation's transcript is stored in the agent pod, and anything printed
  there stays. Use a variable by name (`"$JIRA_PAT"`), check one exists with `${VAR:+set}`, and never
  `cat .env`, `env`, `printenv`, `set` or `kubectl get secret -o yaml` where the output would show. If a
  value lands in the output by accident, say so, so it can be rotated.
- **Secrets**: `.env` and `kubeconfig/` are copied in from the Secret `dev-system/conversation-env` by
  conv-shell; `GH_TOKEN` is the `.env`'s `GH_TOKEN_DEV_EXTENSION`. The AWS keys are left out on purpose,
  and `id_rsa_mf` is not here: they get added one by one, when a task needs them.
- **What is waiting on Marcelo on GitHub** - his open pull requests, reviews asked of him, pull requests he
  reviewed, issues assigned to him, across Rancher, Harvester and Longhorn - is already fetched and kept by
  conversation-api: `curl -s http://conversation-api.dev-system:8080/work` (JSON: `work.mine`,
  `work.reviewing` with `reviewRequested`, `work.issues`; `at` is when it was fetched). Use it before
  searching GitHub yourself. `curl -s -X POST http://conversation-api.dev-system:8080/refresh` fetches it
  again (at most once a minute) and pushes it to the dashboard.
- **Memory** is a separate copy from the Mac's, taken 2026-11-18 (baseline in
  `/workspaces/.conversation/memory-baseline-2026-11-18`). Both sides keep writing; they are merged by
  hand from time to time.
- `$HOME` for commands is `/workspaces/.conversation/.home`.
