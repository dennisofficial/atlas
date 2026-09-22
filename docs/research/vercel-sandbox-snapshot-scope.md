# Vercel Sandbox snapshot scope: what survives stop/resume, and where to put a workspace

Research date: 2026-09-21. Primary sources: vercel.com/docs and vercel.com/changelog, the
vercel/sandbox GitHub repo (cloned at `main`, 2026-09-21), the published `@vercel/sandbox@3.3.0`
npm package in this repo (`node_modules/.bun/@vercel+sandbox@3.3.0/...`), and Vercel Academy.
Community sources (GitHub issues/discussions on other repos, HN, vendor blogs) are marked as
secondary color. Anything I could not verify against a primary source is marked **[unverified]**.

Context: Atlas Cloud runs agent loops in persistent Vercel Sandboxes (`@vercel/sandbox@3.3.0`,
`persistent: true`) and placed both the user workspace (`WORKSPACE_PATH =
'/vercel/sandbox/workspace'`, `apps/api/src/api/sandboxes/vercel-sandbox.client.ts:30`) and the
serve binary + state (`/vercel/sandbox/atlas-serve{,.log,.lock,.token,.headers}`,
`apps/api/src/api/sandboxes/serve-launch.ts:4-10`) under `/vercel/sandbox`. A live probe today
(`apps/api/scripts/snapshot-probe.mjs`) wrote a marker to `/vercel/sandbox/probe.txt`,
`/root/probe.txt`, and `/tmp/probe.txt`, ran `stop()`, confirmed a snapshot existed, and resumed:
`/root` and `/tmp` survived, `/vercel/sandbox/probe.txt` did not.

## 1. Is `/vercel/sandbox`'s exclusion from snapshots documented anywhere?

**No.** I found no mention of any per-path snapshot exclusion in:

- The snapshots concept page (https://vercel.com/docs/sandbox/concepts/snapshots, last updated
  2026-08-26) — describes capture as "its filesystem" with no exclusion list.
- The persistence concept page
  (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes, last updated 2026-09-15) —
  "the SDK automatically snapshots the filesystem", no exclusions.
- The sandbox concepts page (https://vercel.com/docs/sandbox/concepts, last updated 2026-08-25)
  — "the filesystem is automatically snapshotted on stop and restored when the sandbox resumes".
- The SDK reference (https://vercel.com/docs/sandbox/sdk-reference, last updated 2026-09-15) —
  `stop()` / `snapshot()` entries name no exclusions.
- The `@vercel/sandbox` SDK source (`packages/vercel-sandbox/src/` in
  https://github.com/vercel/sandbox and the published 3.3.0 dist) — grepped for
  "ephemeral", "excluded", "tmpfs", "mount": no snapshot-scope language anywhere. The SDK only
  *requests* snapshots (`session.cjs` → `client.createSnapshot(...)`); capture is server-side and
  the server is closed-source.
- The SDK and image changelogs (`packages/vercel-sandbox/CHANGELOG.md`,
  `images/*/CHANGELOG.md` in vercel/sandbox) — no entry mentions exclusions.

Worse, Vercel's own launch material asserts the opposite of what the probe measured. The
changelog that introduced filesystem snapshots
(https://vercel.com/changelog/filesystem-snapshots-supported-on-vercel-sandboxes, published
2026-01-22) says "Snapshots capture the **entire filesystem** of a running Sandbox" and its
code sample writes `/vercel/sandbox/hello`, snapshots, creates a new sandbox from the snapshot,
and reads `/vercel/sandbox/hello` back — i.e. the official announcement demonstrates
`/vercel/sandbox` content surviving a snapshot. The repo's own
`examples/filesystem-snapshots/filesystem-snapshots.ts` does the same
(https://github.com/vercel/sandbox/blob/main/examples/filesystem-snapshots/filesystem-snapshots.ts).
Note that example is stale against SDK v3 (it uses `Snapshot.list()` as a plain promise and
`snapshot.id`, neither of which matches the current async-iterable API), so it may simply never
have been re-run since the platform behavior changed.

**What `/vercel/sandbox` is, per primary sources:**

- It is the **session's default working directory**. The SDK's `Sandbox.cwd` getter is documented
  as "The default working directory of the current session (e.g. `/vercel/sandbox`)"
  (`packages/vercel-sandbox/src/sandbox.ts:553-556` in the repo clone). `writeFiles` "Defaults to
  writing to /vercel/sandbox unless an absolute path is specified" (`sandbox.ts:1315`,
  `session.ts:640`), and relative `mkDir`/`writeFiles` paths resolve against it
  (https://vercel.com/docs/sandbox/sdk-reference, `sandbox.mkDir()` and `sandbox.writeFiles()`
  entries).
- Vercel's own agent-facing skill (`skills/sandbox/SKILL.md` in the vercel/sandbox repo) lists it
  in its Limitations table as "**Writable path | `/vercel/sandbox`**" — the one path the skill
  tells coding agents to write to.
- Inside the image, it is a directory created and owned by the sandbox user. The `al-base`
  Dockerfile does `mkdir -p /vercel/sandbox && chown vercel-sandbox:vercel-sandbox
  /vercel/sandbox` (`images/al-base/Dockerfile:92-93`). The `ubuntu`/`universal` images set
  `HOME=/vercel`, `WORKDIR /vercel`, and make `/vercel` the `ubuntu` user's home
  (`images/ubuntu/Dockerfile:18-24`, `images/universal/Dockerfile`: `chown -R ubuntu:ubuntu
  /vercel`, `ENV HOME=/vercel`, `USER ubuntu`, `WORKDIR /vercel`) — so `/vercel/sandbox` is a
  subdirectory of the default user's home.

Whether it is technically a separate ephemeral mount overlaid at boot (which would explain the
exclusion) is **[unverified]** — nothing public describes the in-VM layout, and the snapshot
machinery is server-side. The probe result is consistent with a per-session mount, but the only
verified fact is the observed behavior: contents do not survive stop/resume.

## 2. What path does Vercel use for workspaces that should persist?

There is no documented "this directory persists" workspace path. What exists:

- **The SDK's default cwd is `/vercel/sandbox`** (§1) — the path our probe shows is *not*
  snapshot-safe. Git `source`s clone into a subdirectory of the cwd named after the repo
  (repo `skills/sandbox/SKILL.md`: "Git sources are cloned into a subdirectory named after the
  repository... run commands with `cwd: \"sandbox-example-next\"`"), and all README/SDK
  examples put project files there (`packages/vercel-sandbox/README.md` getting-started example;
  `skills/sandbox/SKILL.md` uses `cwd: "/vercel/sandbox/app"`).
- **Multi-user paths**: `createUser` homes at `/home/<username>`, group dirs at
  `/shared/<group>` (`packages/vercel-sandbox/README.md`, "Multi-user" section;
  `sandbox-user.cjs:32`: `homeDir = username === "root" ? "/root" : \`/home/${username}\``).
  Nothing says whether these are snapshot-safe, but they are ordinary rootfs paths, not under
  `/vercel/sandbox`.
- **Vercel's own agent-harness course roots the workspace at `/workspace`.** Vercel Academy,
  "Build Your Own AI Coding Agent Harness", lesson "Snapshot and Restore"
  (https://vercel.com/academy/build-ai-agent-harness/snapshot-and-restore, served via
  www.vercel.reviews, last updated 2026-05-20): "Snapshots capture filesystem state. The contents
  of `/workspace` (or wherever your sandbox roots), the state of any installed packages, any
  files the agent created."
- **eve** (Vercel's own agent product) seeds agents with a `/workspace` directory, per
  `docs/research/vercel-platform-2026.md` §5 (source: https://eve.dev/docs).
- **Drives** are the documented answer for data that must outlive a sandbox entirely:
  `Sandbox.create({ mounts: { '/abs/path': drive } })`, independent lifecycle, region-pinned
  (https://vercel.com/docs/sandbox/concepts/drives). Overkill for same-sandbox stop/resume.

## 3. Is there a documented list of excluded paths (/tmp, /proc, mounts)?

**No documented exclusion list exists anywhere I could find** — not in the docs pages above, not
in the SDK source or its JSDoc, not in the changelogs, not in the repo's skill file. The only
normative statements are the sweeping ones: "Snapshots capture the entire filesystem"
(changelog, 2026-01-22) and "Snapshots capture the state of a running sandbox, including the
filesystem and installed packages" (snapshots concept page). The Academy lesson adds only that
snapshots do **not** capture "running processes, in-flight network connections, or in-memory
state" — process state, not filesystem paths.

Our probe's finding that **`/tmp` survived** contradicts nothing in the docs — no page claims
`/tmp` is excluded. It is the docs' "entire filesystem" claim that the probe contradicts, via
`/vercel/sandbox`.

Adjacent verified facts about snapshot scope/limits:

- Snapshot statuses include `failed` — "The capture didn't complete, so the snapshot can't be
  used. Take a new snapshot to retry." (snapshots concept page). Capture is not guaranteed.
- Default expiration 30 days after last use; `keepLastSnapshots: { count: 1 }` is the
  docs-recommended retention for keeping storage flat (persistence concept page).
- Snapshots are region-bound; cross-region create fails with `snapshot_region_mismatch`
  (snapshots concept page).
- Sandboxes that can't resume from a snapshot are removed after 14 days of inactivity
  (persistence concept page, "Sandbox retention").
- Disk is 64 GB ephemeral NVMe per sandbox (pricing page,
  https://vercel.com/docs/sandbox/pricing#resource-limits; changelog
  https://vercel.com/changelog/vercel-sandbox-64-gb-storage). Snapshot storage is billed at
  $0.08/GB-month and the pricing page advises smaller images to reduce snapshot size; **no
  documented maximum snapshot size** **[unverified beyond 64 GB disk being the obvious ceiling]**.
- `snapshot()`/`stop()` capture happens at session stop; the probe script
  (`apps/api/scripts/snapshot-probe.mjs:60-67`) had to poll up to 2 minutes before the snapshot
  appeared in `Snapshot.list()` — snapshot visibility after `stop()` resolves is eventually
  consistent, not instant.

## 4. Community reports (secondary color)

- **No community report of the `/vercel/sandbox` exclusion exists** that I could find. HN search
  (Algolia API, "vercel sandbox" stories and "vercel sandbox snapshot" comments) surfaces launch
  discussion and third-party agent SDKs, nothing on snapshot path scope. The vercel/sandbox repo
  has 5 open issues and a handful of discussions — none about snapshot exclusions. Reddit
  r/vercel search was unreachable (403), so that corner is unchecked rather than confirmed empty.
- **Snapshot-restore reliability pitfall, third-party harness:** NousResearch/hermes-agent
  issue #74753 (https://github.com/NousResearch/hermes-agent/issues/74753) — their persistent
  Vercel backend silently lost all persisted files on every restore because the SDK rejects
  `source` + `runtime` together, the restore call always failed validation, and the harness
  fell back to a fresh sandbox while deleting the valid snapshot mapping. Lesson: restore
  failures must be loud; a silent fresh-sandbox fallback is indistinguishable from "snapshot lost
  my files" until you diff the workspace.
- **Distrust of the sandbox fs as source of truth:** vercel/sandbox discussion #103
  (https://github.com/vercel/sandbox/discussions/103) — giselles-ai's `sandbox-volume` exists
  because "snapshots can resume a sandbox, but long-lived workspace state is a different
  problem"; they sync workspace files transactionally to Vercel Blob instead of treating the
  sandbox filesystem as authoritative. Written March 2026, before persistence went GA
  (GA 2026-05-26, https://vercel.com/changelog/sandbox-persistence-is-now-ga), but the pattern
  shows what practitioners reach for when snapshots alone don't feel safe.
- **Cross-provider comparison:** superserve.ai's sandbox-provider deep dive
  (https://www.superserve.ai/blog/openai-agents-sdk-sandboxes-which-provider-should-you-actually-use/,
  May 2026, vendor-disclosed) deliberately skipped benchmarking snapshot/restore latency across
  providers and calls persistent-by-default workspaces "genuinely hard... workspace drift, secret
  rotation, half-written files on resume". No published restore-latency numbers for Vercel
  anywhere I found; the docs only claim resume-from-snapshot "is even faster than starting a
  fresh sandbox" (concepts page).

## 5. Recommendation: where an agent harness should put things

Constraint set, all verified above: snapshots capture the ordinary rootfs (`/root` and `/tmp`
probe-verified today); `/vercel/sandbox` is probe-verified excluded; docs promise "entire
filesystem" and name no exclusions, so *any* path choice rests on the probe, not on a Vercel
guarantee; the SDK's relative-path conveniences default into the excluded directory, so all
file operations must use absolute paths (Atlas already does).

> **Correction (2026-09-21, later the same day).** The three-phase follow-up probe overturned
> the path-exclusion reading: with a fresh unique sandbox name — and in an explicit
> delete→recreate-under-the-same-name phase — **every** probed path survived every stop/resume
> cycle, including `/vercel/sandbox`. The two losses recorded above both came from probes that
> rapidly deleted and recreated a fixed sandbox name, so same-name churn (restore racing a stale
> snapshot lineage, or a fresh sandbox answering for the name) is the hazard, not the path. The
> production fs losses that motivated this research were self-inflicted deletes
> (`healedLaunch` on stale serve tokens, pre-#543 deploy wedges), not park/wake. The path
> recommendations below stand on their own merits — `/workspace` and `/opt/atlas/` are plain
> rootfs with Vercel-owned precedent — but they are hygiene, not a workaround for a snapshot
> exclusion that does not exist.

- **(a) User workspace → `/workspace`.** Two Vercel-owned precedents root agent workspaces
  there: the Vercel Academy agent-harness course ("The contents of `/workspace` (or wherever
  your sandbox roots)") and eve's `/workspace` seeding. It is an ordinary root-level directory
  on the 64 GB rootfs, outside `/vercel/*`, outside `$HOME` — so it survives snapshots by the
  same mechanism the probe confirmed for `/root`, and it reads naturally to agents and humans.
  One caveat: the probe verified `/root` and `/tmp` directly, not `/workspace`. Before
  migrating, extend `apps/api/scripts/snapshot-probe.mjs`'s `PATHS` with `/workspace/probe.txt`
  and `/opt/probe.txt` and re-run; it's a one-line change and settles the last unverified inch.
- **(b) Serve binary and agent state → `/opt/atlas/` (binary) with state beside it, not under
  the workspace.** `/opt` is the FHS-correct place for root-owned add-on software, is not a
  user home, not cwd, and not anything the SDK or image treats specially — the image Dockerfiles
  themselves install tooling under `/opt/node`. Keep the token/lock/headers with it
  (`/opt/atlas/atlas-serve.token`, etc.). `/root` is probe-verified and would also work, but the
  SDK's sudo wrapper sets `HOME=/root` and sources root's dotfiles (README "Sudo access"
  section), so `/root` is shared with every `sudo: true` command's environment; `/opt` is
  cleaner and equally ordinary rootfs. `/tmp` survived the probe too, but it is the platform's
  conventional scratch space and the obvious first candidate if Vercel ever *does* publish an
  exclusion list — do not build on it.
- Keep everything out of `/vercel/sandbox` permanently: the SDK's `writeFiles`/`mkDir`
  relative-path default and the official skill's "Writable path: `/vercel/sandbox`" guidance
  will keep inviting files back into the one directory that does not persist. The probe finding
  also invalidates the assumption behind Vercel's own snapshot announcement example, so treat
  the docs as wrong here and the probe as truth until Vercel says otherwise — and given capture
  can return status `failed` and restore fallbacks can silently mask data loss
  (hermes-agent #74753), the harness should verify post-restore (e.g. stat a sentinel written at
  stop time) rather than assume.

## Primary sources

- Vercel docs: [Snapshots](https://vercel.com/docs/sandbox/concepts/snapshots),
  [Persistence](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes),
  [Understanding Sandboxes](https://vercel.com/docs/sandbox/concepts),
  [JS SDK reference](https://vercel.com/docs/sandbox/sdk-reference),
  [Pricing and limits](https://vercel.com/docs/sandbox/pricing),
  [Drives](https://vercel.com/docs/sandbox/concepts/drives)
- Vercel changelog: [Filesystem snapshots (2026-01-22)](https://vercel.com/changelog/filesystem-snapshots-supported-on-vercel-sandboxes),
  [Sandbox persistence GA](https://vercel.com/changelog/sandbox-persistence-is-now-ga),
  [64 GB storage (2026-09-11)](https://vercel.com/changelog/vercel-sandbox-64-gb-storage)
- Vercel Academy: [Build Your Own AI Coding Agent Harness — Snapshot and Restore](https://vercel.com/academy/build-ai-agent-harness/snapshot-and-restore)
- Source code: [vercel/sandbox @ main, cloned 2026-09-21](https://github.com/vercel/sandbox) —
  `packages/vercel-sandbox/src/sandbox.ts:553-556,1315`, `packages/vercel-sandbox/src/session.ts:640`,
  `packages/vercel-sandbox/README.md`, `skills/sandbox/SKILL.md`,
  `images/universal/Dockerfile`, `images/ubuntu/Dockerfile`, `images/al-base/Dockerfile:92-93`,
  `examples/filesystem-snapshots/filesystem-snapshots.ts`;
  published `@vercel/sandbox@3.3.0` at
  `node_modules/.bun/@vercel+sandbox@3.3.0/node_modules/@vercel/sandbox/dist/`
- This repo: `apps/api/scripts/snapshot-probe.mjs` (the probe),
  `apps/api/src/api/sandboxes/vercel-sandbox.client.ts:30`,
  `apps/api/src/api/sandboxes/serve-launch.ts:4-10`
- Secondary color: [hermes-agent#74753](https://github.com/NousResearch/hermes-agent/issues/74753),
  [vercel/sandbox discussion #103 (sandbox-volume)](https://github.com/vercel/sandbox/discussions/103),
  [superserve.ai provider comparison](https://www.superserve.ai/blog/openai-agents-sdk-sandboxes-which-provider-should-you-actually-use/),
  [HN Algolia search](https://hn.algolia.com/api/v1/search?query=vercel%20sandbox)
