# Cloud session placement models: how amp and peers decide where a session lives

Research date: 2026-10-10. Primary sources: ampcode.com/docs, code.claude.com/docs,
learn.chatgpt.com/docs (OpenAI Codex user docs), docs.devin.ai, cursor.com/docs,
docs.github.com, docs.factory.com, conductor.build/docs. Every claim links the page that
owns it. Anything I could not confirm against a primary source is marked **[unconfirmed]**.

Context: Atlas currently supports local↔cloud session transfer (lift/descend). A developer
is considering dropping that in favor of amp-style placement: a session is born cloud or
born local and stays there. This note investigates how amp models placement, sandbox
lifecycle, and tooling distribution, then surveys comparable products, and distills design
patterns relevant to Atlas (which hot-swaps its in-sandbox serve binary per release and
must deliver user skills, memory, and settings into the sandbox).

## 1. amp's session placement model

**Threads are the unit of work; executor is a per-thread property.** amp's unit is a
"thread" — one conversation with the agent, with a URL (`https://ampcode.com/threads/T-…`)
that opens in the web app, the CLI, and the iOS/macOS apps. The key design statement:
"Where the agent runs is separate from where you look at it: a thread can run in an orb,
on a runner, or in a local CLI session." — https://ampcode.com/docs/threads

**The executor is chosen at birth and does not migrate.** A thread is started in one of
three executor kinds, and there is no documented "move this thread to another executor"
operation:

- **Orb** — a remote machine amp creates per thread (amp's cloud). Chosen in the web
  composer ("New Orb"), or from the CLI with `amp -ox`, or from the TUI command palette
  ("thread: new in orb"). — https://ampcode.com/docs/orbs/getting-started,
  https://ampcode.com/docs/cli/spawning-orbs
- **Runner** — a user's own machine running `amp --no-tui` (headless) or a TUI with
  `amp.remoteThreadCreation.enabled`. Web/mobile clients can create threads on a runner
  and remote-control them. — https://ampcode.com/docs/cli/runners
- **Local CLI** — `amp` in a terminal on your machine. — https://ampcode.com/docs/cli

**Cross-surface continuity is built into each direction separately rather than as one
symmetric "transfer" primitive:**

- **Cloud (orb) → local:** `amp sync <thread>` mirrors an orb thread's git changes into
  your local checkout while the agent keeps working remotely. The agent itself does not
  relocate; the *workspace changes* do. — https://ampcode.com/docs/orbs ("Sync Changes to
  Your Computer")
- **Orb → CLI attach:** `amp threads continue T-…` attaches the CLI to an orb thread;
  `amp threads continue T-… -ox 'msg'` sends one message that "runs on the thread's own
  orb." — https://ampcode.com/docs/threads, https://ampcode.com/docs/cli/spawning-orbs
- **Local CLI → web:** Cross-Client Access lets you continue a running CLI thread from
  ampcode.com ("Start Amp in the CLI, open the thread on the web … and send messages to
  keep working from anywhere"). The executor stays the local machine; the web is a remote
  control surface. Optional `--remote-control-terminal` exposes the local terminal to the
  web UI. — https://ampcode.com/docs/cli/remote-control
- **Any → orb spawn:** `amp -ox "prompt"` and `amp threads continue T-… -ox 'msg'` create
  or message orb threads from the terminal. —
  https://ampcode.com/docs/cli/spawning-orbs

**What is shared between surfaces:** the thread itself (prompts, replies, tool calls,
changed files) is server-side state on ampcode.com and is visible from every client. What
is *not* shared: the execution environment. Each executor kind has its own filesystem; amp
never moves a running agent's machine. When a thread runs in an orb, the web UI shows
Changes/Portals/Files/Terminal panes that open *into the orb's machine*. —
https://ampcode.com/docs/threads ("Inside a Thread")

**Verdict for question 1:** amp is closest to "born cloud or born local" — placement is
chosen at thread creation and never migrates the executor. But it is not *only* that: amp
adds three compensating primitives (thread-as-shared-state readable everywhere, remote
control of local threads from web/mobile, and `amp sync` to pull orb changes to a local
checkout) so that the lack of executor migration is rarely felt as a wall.

## 2. amp sandbox/runtime lifecycle (orbs)

**Per-session machine.** "Orbs are remote machines where Amp agents work… Every orb
thread gets a fresh, isolated environment with your code, plugins, development tools, and
the context of the thread that created it." Orbs are E2B microVMs running Debian 12 in
Google Cloud us-west1. — https://ampcode.com/docs/orbs,
https://ampcode.com/docs/orbs/customizing ("Amp's default E2B orbs currently run in Google
Cloud us-west1")

**Persist-by-default with park/wake.** The lifecycle is explicitly documented:

- "When the agent is done, the orb goes to sleep, and a sleeping orb costs nothing, even
  if it sleeps for weeks. When you send another prompt, the orb wakes up with your
  conversation, files, and services still in place." — https://ampcode.com/docs/orbs
- Pause conditions: the agent has done no work for 5 minutes AND the user has not
  interacted with the orb for 20 minutes (whichever is later). Opening the thread, opening
  a portal, or sending a message wakes it. Archiving a thread pauses the orb immediately.
  — https://ampcode.com/docs/orbs/sizes-and-costs ("When an Orb Pauses")
- `.agents/resume` runs "after initial activation and again whenever the orb wakes" — the
  documented hook for re-authentication and state repair after wake. Amp waits up to 10s
  for it, then lets it continue in the background. —
  https://ampcode.com/docs/orbs/customizing

**Two snapshot layers:**

1. **Project snapshot** — a saved copy of a prepared orb (repo + everything
   `.agents/setup` installed). Reused across threads in the project for up to 72 hours,
   refreshed when stale or when the repo source/shared config changed. Not invalidated by
   editing `.agents/setup` alone; delete via `amp projects snapshots delete`. —
   https://ampcode.com/docs/orbs/customizing ("The Orb Lifecycle")
2. **Per-thread orb state** — the running orb's own filesystem, which survives pause/wake
   ("your files and services still in place"). — https://ampcode.com/docs/orbs

**Spawn pacing:** burst of 20 metered orbs per user, then one new orb per 5 minutes;
excess starts queue rather than fail. — https://ampcode.com/docs/orbs ("Orb Spawn Pacing")

**Costs:** billed per minute while running; paused orbs are free. 60 GB disk per orb at
current sizes. — https://ampcode.com/docs/orbs/sizes-and-costs

**Verdict for question 2:** per-thread VM, persist-with-sleep semantics, documented wake
triggers and a first-class resume hook. amp treats the idle-VM problem exactly as Atlas
does (park, snapshot, wake on interaction), but couples it to the per-thread executor so
"waking the thread" and "waking the machine" are the same event.

## 3. Tooling & skills distribution into a remote runtime

amp has four distinct distribution channels, each with different placement semantics:

### 3.1 Skills — hosted Git repos fetched per thread, plus machine-local dirs

- Personal and workspace skills live in **Git repositories hosted by ampcode.com**
  ("Amp stores each scope in its own Git repository"). A push publishes; "New threads load
  it automatically, and Amp can reload it in the current thread." —
  https://ampcode.com/docs/customize/skills ("Skill Repositories"),
  https://ampcode.com/docs/customize/global-plugins-and-skills
- Precedence order (first match wins): machine-local dirs
  (`~/.config/agents/skills/`, `~/.agents/skills/`, `~/.config/amp/skills/`), project
  `.agents/skills/`, Claude-compat dirs, configured extra paths, then personal repo, then
  workspace repo, then official amp skills. — https://ampcode.com/docs/customize/skills
  ("Skill Sources and Precedence")
- Because the personal/workspace repos are hosted, they are available **everywhere you use
  Amp — including orbs**, whose executor "does not read the settings file on your
  computer." — https://ampcode.com/docs/customize/mcp ("MCP Servers in Orbs")
- Reload semantics: the `reload_skills` tool "rescans local directories and fetches the
  latest personal and workspace skills." Existing threads do not automatically reload
  hosted plugins after a push. — https://ampcode.com/docs/customize/skills,
  https://ampcode.com/docs/customize/global-plugins-and-skills

### 3.2 AGENTS.md — layered, with a hosted global variant for cloud

- Repo `AGENTS.md` files travel with the clone. Personal `$HOME/.config/amp/AGENTS.md`
  and system-wide files apply only on the machine. For cloud, ampcode.com holds a
  **Global AGENTS.md** in Personal Settings → Advanced, and a workspace-level Global
  AGENTS.md that admins set; these are included before personal and repository guidance.
  — https://ampcode.com/docs/customize/agents-md

### 3.3 MCP — split between local config (executor-side) and hosted remote definitions

- Local MCP servers (`amp.mcpServers` in settings files) are executor-local: an orb does
  not read your laptop's settings file. To reach an orb you either bundle MCP servers in
  a skill's `mcp.json` committed to the repo, commit `.amp/settings.json`, or use
  **remote MCP definitions stored by ampcode.com** (personal/workspace/project scope),
  which are "available across Amp clients without a local settings file" and handle OAuth
  server-side. — https://ampcode.com/docs/customize/mcp
- Running threads refresh remote tool lists in the background. —
  https://ampcode.com/docs/customize/mcp ("Remote Server IDs and Overrides")

### 3.4 Environment/secrets — hosted, applied per thread at wake

- Project Secrets & Env Vars are stored on ampcode.com (encrypted) and "applied" as the
  "current thread environment" when an orb starts or wakes (step 5 of the orb lifecycle).
  Personal values override project values. — https://ampcode.com/docs/orbs/customizing,
  https://ampcode.com/docs/orbs/handling-secrets
- Runners can opt into the same hosted env with `--amp-env`; each new thread start re-
  fetches variables, and "You do not need to restart the runner after you change a
  variable." — https://ampcode.com/docs/cli/runners ("Secrets & Env Vars")

### 3.5 Agent binary updates

- The orb image bundles `amp` (authenticated after activation). —
  https://ampcode.com/docs/orbs/customizing ("Installing Software")
- CLI updates are automatic by default (`amp.updates.mode: "auto"`); runners check hourly
  and restart into the new version once no thread is running, at most once per 12 hours.
  — https://ampcode.com/docs/cli/settings, https://ampcode.com/docs/cli/runners ("Keep a
  Runner Updated")
- **[unconfirmed]** How the amp binary *inside a running orb* is versioned or hot-swapped
  mid-thread is not documented. Docs only say orbs "include" amp and that the executor is
  "restored" on wake.

**Verdict for question 3:** amp's answer is "host user-level customization server-side,
fetch at thread start, reload on demand." Anything machine-local is deliberately
machine-only (`~/.config/agents/skills`, local `amp.mcpServers`); anything that must
follow the user into the cloud lives in ampcode.com-hosted Git repos (skills, plugins) or
hosted settings documents (Global AGENTS.md, remote MCP defs, secrets). Project-level
tooling travels with the repo (`.agents/skills`, `.agents/setup`, `.amp/settings.json`).

## 4. Comparables

### 4.1 Claude Code cloud sessions — one-way teleport out, never in

- **Placement:** sessions run in an Anthropic-managed isolated VM per session (or a
  self-hosted environment). Start from browser, mobile, desktop, or `claude --cloud`. —
  https://code.claude.com/docs/en/claude-code-on-the-web
- **Transfer:** asymmetric. `claude --teleport` pulls a cloud session *into* the terminal
  (fetches the pushed branch, loads conversation history; the terminal copy diverges —
  "new work there stays local and doesn't appear in the cloud session"). You **cannot
  push an existing terminal session to the cloud**; `--cloud` always creates a new
  session. The Desktop app's "Open in" menu can send a local session to the cloud —
  the one documented local→cloud move. —
  https://code.claude.com/docs/en/claude-code-on-the-web ("Move tasks between terminal
  and cloud")
- **Repo transfer without GitHub:** for repos without a GitHub remote, `claude --cloud`
  bundles the local repo (history + uncommitted tracked changes, minus credential-shaped
  files, ≤100 MB) and uploads it. — same page ("Send local repositories without GitHub")
- **Lifecycle:** VMs expire after a period of inactivity ("the session's VM is
  reclaimed"); reopening the session provisions a fresh VM with conversation history
  restored but background processes and pending `/loop` wakeups lost. Exact idle timeout
  not stated on this page. — same page ("Environment expired")
- **Config distribution:** cloud sessions read "cloud environments" (saved config:
  network allowlist, env vars, setup scripts cached ~5 min), plus repo `.claude/settings.json`
  and `.claude/agents/`; credentials stay outside the VM behind a GitHub proxy. —
  https://code.claude.com/docs/en/claude-code-on-the-web, 
  https://code.claude.com/docs/en/cloud-environments (referenced)

### 4.2 OpenAI Codex Cloud — born-cloud tasks from published environments

- **Placement:** tasks are born cloud ("Codex Cloud runs coding tasks in the cloud").
  Environments are reusable published setups; "Each new task gets its own isolated
  workspace from the published environment." —
  https://learn.chatgpt.com/docs/environments/cloud-environments
- **Transfer:** no local→cloud migration. The Codex CLI, IDE extension, web, and mobile
  are separate surfaces; cloud tasks are continuable across web/mobile/desktop but not
  relocatable to local. [unconfirmed: no documented equivalent of Claude's `--teleport`]
- **Lifecycle:** each task runs in a VM (2 vCPU/8 GiB on Plus; 4/16 GiB + 32 GB disk on
  Pro/Business/Enterprise). "A task's saved VM state is recoverable for up to seven days
  after you last start a turn or resume the task." Existing tasks keep their own saved
  files including uncommitted changes; new tasks start from the published environment
  snapshot. Repository refresh runs in the background preserving dependency caches. —
  https://learn.chatgpt.com/docs/environments/cloud-environments ("VM specifications",
  "Reuse and update saved state")
- **Config distribution:** environment-scoped install script + "start skill" recorded
  during an agent-led setup conversation, published as a filesystem snapshot; env vars
  and network secrets (proxy-substituted) per environment; personal vault for per-user
  values. "Skills stored in your repository are available in cloud tasks. Personal skills
  from your local computer aren't synced to cloud environments." —
  https://learn.chatgpt.com/docs/environments/cloud-environments ("Current limitations")

### 4.3 Devin — real bidirectional handoff, as an explicit copy operation

- **Transfer:** `/handoff` moves a local CLI session to the cloud: "packages up the
  conversation context and your current git branch, then creates a cloud session that
  picks up where you left off," including the uncommitted diff. Reverse: `/pickup`
  (also `/handoff` from a cloud session) fetches the cloud session's PR branch, checks it
  out locally, and starts a local session on it. — https://docs.devin.ai/cli/handoff,
  https://docs.devin.ai/cli/cloud
- **Runtime:** each cloud session gets its own VM with shell, browser, repo clones;
  `/ssh` opens a shell on the VM. Sessions persist and can be resumed by URL/ID. —
  https://docs.devin.ai/cli/cloud
- **Config:** not investigated deeply; Devin's environment customization docs were not
  fetched. [unconfirmed]

### 4.4 Cursor Cloud Agents — born-cloud, environment snapshots, user config explicitly excluded

- **Placement:** cloud agents run in isolated VMs per agent, kicked off from web, iOS,
  desktop (Cloud mode), Slack, GitHub/Bitbucket comments, Linear, or API. No local→cloud
  migration of an interactive IDE session is documented. —
  https://cursor.com/docs/cloud-agent
- **Runtime:** "Cursor manages VM provisioning, isolation, snapshots, startup, artifacts,
  and capacity for every Cloud Agent." Environments configured via agent-led setup, saved
  snapshot, or `.cursor/environment.json` Dockerfile; "Builds prepare each environment in
  the background so agents start with repositories and dependencies ready." "Builds
  preserve disk state only. Running processes, exported shell variables, and in-memory
  caches don't continue into an agent run." — https://cursor.com/docs/cloud-agent/setup
- **Config distribution:** repo-committed `.cursor/environment.json`, hooks from
  `.cursor/hooks.json` (and team/enterprise hooks on Enterprise), secrets from a
  team-scoped dashboard injected at agent start ("Agents already running won't pick up
  new secrets"). Explicit exclusion: "User-level hooks from `~/.cursor/hooks.json` are
  also not available since cloud VMs don't have access to your local home directory." —
  https://cursor.com/docs/cloud-agent, https://cursor.com/docs/cloud-agent/setup

### 4.5 GitHub Copilot coding agent — born-cloud, ephemeral, Actions-native

- **Placement:** sessions are born cloud (assigned issues, `@copilot` mentions, agents
  panel). The environment is "its own ephemeral development environment, powered by
  GitHub Actions." No local surface and no transfer. —
  https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment
- **Runtime:** ephemeral per task; runs on standard or larger/self-hosted Actions runners
  (Ubuntu x64 or Windows x64 only). No documented park/resume semantics — the environment
  is discarded. — same page
- **Config distribution:** a special repo workflow, `.github/workflows/copilot-setup-steps.yml`
  (single `copilot-setup-steps` job, must be on the default branch), plus repo-level
  secrets/variables for the agent. Everything user-customized is repo-committed or
  org-configured; there is no personal-config channel at all. — same page

### 4.6 Factory (droid) — local CLI with optional cloud session mirroring

- Factory's droid CLI runs locally but has a `cloudSessionSync` setting: "every CLI
  session is mirrored to Factory web so you can revisit conversations in the browser."
  Org-level retention controls apply. This is transcript mirroring, not executor
  relocation — closer to amp's thread-as-shared-state. —
  https://docs.factory.com/docs/droid-cli/settings ("Cloud session sync")
- "Droid Computers" provide cloud machines reachable from any browser. —
  https://docs.factory.com/ [depth not investigated]

### 4.7 Conductor — purely local orchestrator

- Conductor runs Claude Code, Codex, Cursor, and OpenCode agents locally in parallel,
  each in its own workspace/branch. No cloud execution and no placement question. —
  https://www.conductor.build/docs

## 5. Design patterns worth stealing

Patterns distilled for a product that (a) hot-swaps its in-sandbox serve binary on every
release and (b) has user skills + memory + settings that must reach the sandbox.

### 5.1 Placement: born-placed, with three escape hatches instead of transfer

Every product except Devin avoids symmetric live migration:

- **amp, Cursor, Codex, Copilot:** executor chosen at creation, never moves. Continuity
  is provided by (1) shared server-side thread state readable from any client, (2) remote
  control of a local session from web/mobile (amp Cross-Client Access, Claude Remote
  Control), and (3) artifact-level moves — `amp sync` mirrors the orb's git branch to a
  local checkout; Claude `--teleport` copies the session down and deliberately forks it.
- **Devin** is the outlier with true bidirectional `/handoff`, and it is a *copy* —
  package context + branch + diff, create a new session elsewhere — not a process
  migration.
- **Claude Code** proves the asymmetric middle is shippable: `--teleport` (cloud→local,
  fork-on-arrival) covers the "let me finish this locally" need; local→cloud is only
  available as "create a new cloud session from this repo/branch," never as moving a live
  session.

Implication for Atlas: dropping lift/descend is industry-normal. The compensating
primitives that make it painless are: server-side thread state with multi-client read
access, a one-way "pull the cloud session's branch + history down" copy, and remote
control of local sessions from other devices. Atlas already has the first and third; the
second (descend-as-copy rather than descend-as-relocation) is the cheap survivor —
consistent with the existing "#722 descend-as-raw-files" direction.

### 5.2 Runtime lifecycle: park with a resume hook, snapshots at two granularities

- amp's orb lifecycle is the fullest documented model: pause after (5 min agent-idle AND
  20 min user-idle), wake on message/thread-open/portal-request, free while paused,
  `.agents/resume` re-runs on every wake for re-auth/repair, project snapshots (72 h TTL)
  amortize setup across threads while per-thread state survives independently.
- Claude Code instead reclaims expired VMs and restores only conversation history —
  losing background processes. Users experience this as "session expired."
- Codex keeps saved VM state for 7 days per task; Cursor's Builds preserve disk only and
  warn that processes/env-vars don't survive.

Implication for Atlas: amp validates the park/snapshot design Atlas already has, and adds
two refinements worth copying: (1) a **documented resume hook** (`resume`-script analog)
so users can repair state that doesn't survive a park — Atlas currently makes the harness
own all of that; (2) **two snapshot tiers** — a shared prepared-project snapshot
(setup-amortizing, TTL'd) separate from per-session live state — which Atlas could use to
make first-boot-in-a-repo fast without conflating it with session resume.

### 5.3 Config distribution: host the user layer server-side; the executor reads local, the cloud fetches hosted

The consistent pattern across amp, Codex, Claude, and Cursor:

1. **Repo-committed config travels with the clone** (`.agents/skills`,
   `.claude/settings.json`, `.cursor/environment.json`, `copilot-setup-steps.yml`,
   AGENTS.md). Zero distribution machinery needed — but zero user-level customization.
2. **User-level customization that must work in the cloud is hosted server-side**: amp's
   personal/workspace skills Git repos, Global AGENTS.md, remote MCP definitions, and
   Secrets & Env Vars all live on ampcode.com and are fetched at thread start / wake.
   Codex hosts environments, secrets, and personal vault. Claude hosts cloud environments
   and env vars.
3. **Machine-local config is deliberately machine-only**: amp's
   `~/.config/agents/skills`, Cursor's `~/.cursor/hooks.json` ("cloud VMs don't have
   access to your local home directory"), Codex's personal skills ("aren't synced to
   cloud environments"). Nobody tries to sync arbitrary local home directories into
   sandboxes.
4. **Reload is explicit and pull-based**: amp's `reload_skills` rescans + refetches;
   secrets apply on next thread start; runners refetch env per thread. Nobody pushes
   config into a running session's filesystem.

Implication for Atlas: the "user skills + memory + settings must reach the sandbox"
requirement argues for amp's hosted-layer design — a server-side copy of the user-level
document that cloud sessions pull at boot/wake. Atlas already has the client-pushed
variant ("whole user document pushed to cloud sessions on Ready and on change" — see
project memory "Settings sync is client-only"); amp's model shows the alternative where
the cloud side *owns* the user layer and the local machine is just another client of it.
If Atlas drops session transfer, the push-on-Ready model loses its hardest case (mid-
session relocation) and the remaining question — who is source of truth for user settings
when a cloud session runs for days — is one amp answers with "the server is."

### 5.4 Hot-swapping the in-sandbox binary: nobody documents it; the closest analogs are snapshot hygiene and drain-restart

- amp's runner auto-update is the only documented live-update story: check hourly,
  restart into the new version **once no thread is running**, at most once per 12 hours —
  i.e. drain-then-swap, never swap under a live session. —
  https://ampcode.com/docs/cli/runners ("Keep a Runner Updated")
- Nobody documents hot-swapping the agent binary inside a running cloud session
  **[unconfirmed for all products surveyed]**. The documented lifecycle units (orb pause/
  wake, Claude VM reclaim/reprovision, Codex task resume) are all natural swap points:
  the binary can be replaced while the sandbox is asleep and nobody observes a mid-turn
  change.
- amp's warning that "Software installed manually from the Terminal is available only in
  that orb" (https://ampcode.com/docs/orbs/customizing) shows they accept per-orb drift
  for mutable payloads and correct it through the snapshot/setup layer.

Implication for Atlas: the hot-swap-per-release design is more aggressive than anything
publicly documented. The market-standard shape is "swap at sleep/wake boundaries and
drain-restart long-lived daemons," which Atlas already approximates with rotation +
drain. If born-placed placement makes cloud sessions *longer-lived* (they can never be
lifted home to escape a bad serve), the drain path and the park/wake swap window become
more load-bearing, not less.
