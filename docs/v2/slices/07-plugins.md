# Slice 7 spec: plugins, one at a time

Status: **spec, 2026-11-08.** The operator's answers are in §9; the contract PR (§2) is built.
Anchors are `path:line` at `1ed61c015`; re-check before relying on one. Prior slice:
[06-commands.md](06-commands.md). Contract: [architecture.md](../architecture.md) §4 P8 and §7,
[0019](../../decisions/0019-v2-package-map.md), [0020](../../decisions/0020-v2-sub-agent-worktrees-and-peer-sessions.md),
[03-teammates.md](03-teammates.md).

## Goal

Every native feature runs as a v2 plugin on the slice-6 contract (`definePlugin` / `composePlugins`,
`packages/plugin-sdk/src/plugin.ts`), in a top-level `plugins/<name>/` package with tier subpaths
`/core`, `/pod`, `/control` and `/client`, registered in the apps that need it. A plugin declares
its events, views, commands, pod handlers, control handlers and client state once; the apps compose
the ones they run, and no plugin imports another.

**Exit criterion** (roadmap row 7, made concrete):
1. For each plugin in §5, one real v2 session in a cloud pod proves the feature's user-visible
   behaviour, with every slot registered (live check recorded in the plugin's section file and in
   this document's §8).
2. A plugin's event body is typed without editing `core`; its view reaches the session view without
   `core` knowing the fold; its command dispatches through the one `sessions.command` path; its
   tools and hooks reach the pod without host code naming the plugin.
3. `plugins/*` imports only foundation packages: a lint rule fails a `plugins/a` → `plugins/b`
   import, and the app composition roots are the only files that name several plugins.
4. With the plugin list empty, every app behaves exactly as it does today.

## 1. What exists today

**The contract is a slot-complete shell, not yet a live seam.**
- `definePlugin` requires all seven slots and `composePlugins` flattens them
  (`packages/plugin-sdk/src/plugin.ts:22-85`). The slot payloads are thin:
  `PodHandler { eventType, handle }`, `ControlHook { name, appliesTo }`, `ClientHook { name, appliesTo }`
  and `ViewFold<TState>` (`packages/plugin-sdk/src/slots.ts:1-34`).
- Nothing consumes a composed plugin: `composePlugins` has no caller outside its spec
  (`packages/plugin-sdk/src/__tests__/plugin.spec.ts`).
- `eventSchemaOf(plugins)` (`packages/plugin-sdk/src/plugin.ts:87`) and the app registration lists
  (`apps/api/src/api/platform/control/registered-plugins.ts`,
  `apps/agent-host/src/registered-plugins.ts`,
  `apps/web/src/features/sessions/registered-plugins.ts`) were added in #2013. They are empty, and
  the composed decoder now reaches the view catch-up and the host's append.

**The command path is real.** `packages/commands` (`spec.ts`, `registry.ts`, `pod.ts`, `control.ts`),
the root `commands/` package with rewind, rename and summarise, the API's `COMMAND_REGISTRY`
(`apps/api/src/api/platform/control/command-registry.ts:15`), the holder's intake
(`packages/host/src/holder/inbox-intake.ts:28`) and web's per-capability actions (slice 6).

**The pod is where tools, hooks and the daemon live.**
- Tools: `daemonToolsOf` returns a fixed array of seven tools
  (`apps/agent-host/src/runtime/tools.ts:92-100`); `BashTool` gets `ForegroundOnlyShells`
  (`apps/agent-host/src/runtime/foreground-shells.ts:12`).
- Hooks: `HookChain` with `beforeTurn`, `beforeStep`, `afterTool`, `afterTurn`
  (`packages/agent/src/hooks/registry.ts:36-130`).
- Prompt: a `PromptFragmentRegistry` over fragments
  (`apps/agent-host/src/runtime/prompt-registry.ts:1-60`,
  `apps/agent-host/src/runtime/prompt-fragments/`).
- Daemon events: `RemoteCalls.onEvent` (`packages/host/src/calls/remote-calls.ts:41`), today consumed
  only by the branch observer (`packages/host/src/holder/branch-observer.ts:54`).
- The daemon already carries every op group — exec, files, git, mcp, services, shells, terminal
  (`apps/daemon/src/ops/index.ts:10-18`) — with `shells.output`/`shells.ended`, `services.ready`/
  `services.ended` and `terminal.*` frames.

**The session view is a fixed core shape.** `SessionViewState` (`packages/core/src/record/views/session-view.ts:20-28`),
`stepSessionView` (`:48`) and `SESSION_VIEW_VERSION = 3` (`:18`); the CP folds and persists it
(`packages/control/src/session-view-ops.ts:29-111`), the wire schema and web read it
(`packages/protocol`, `apps/web/src/features/sessions`).

**v2 has no feature beyond chat, tools, views, commands and the GitHub branch link.** Branch and PR
views exist in core (`packages/core/src/record/views/checkouts.ts`,
`views/pull-request-links.ts`, events `branches-observed` and `pull-request-linked`), recorded by the
host (`packages/host/src/holder/branch-observer.ts:46`, `pr-linker.ts:41`) with PR state joined from
v1's `GithubPrState` table (`packages/control/src/postgres/postgres-views.ts:74`). Nothing forwards a
daemon event except git branches; no v2 session starts a background shell, a service, a memory write,
a sub-agent or a peer session.

**v1 prior art to copy, never import** (`packages/harness/src/`): `plugins/github/` (4.7k lines),
`subscriptions/` (2.4k), `shells/`, `services/`, `memory/`, `agents/`, plus the surface code in
`apps/api`, `apps/tui`, `apps/web`. The v2 rule stands: copy the logic into the plugin, never import
v1 (`docs/v2/roadmap.md`, "v1 and v2 share no logic").

## 2. Complete the contract (first PR of the slice)

The slice-6 slots are placeholders because nothing real used them. Before the first plugin, one PR
makes them load-bearing. It changes no behaviour without a plugin.

**Events and views.** A plugin's folds run beside `stepSessionView`, not inside core:
- `PluginViewFold<TState> { name, initial, fold }` lives in `packages/core/src/record/views/plugin-view.ts`.
- `SessionViewState` and `SessionViewValue` gain `pluginViews: Readonly<Record<string, unknown>>` and
  `SESSION_VIEW_VERSION` is 4 (`packages/core/src/record/views/session-view.ts`). Core's
  `stepSessionView` leaves the bag untouched. The bump rebuilds each stored row once on its next read.
- `ControlPlane` takes `pluginViews?: readonly PluginViewFold[]` (`packages/control/src/control-plane.ts`);
  `foldEvents` (`packages/control/src/session-view-ops.ts`) runs `stepSessionView` then each fold and
  writes the result into `pluginViews`. Append, catch-up and the digest view all pass it.
- The bag is persisted with the view, carried on the wire (`sessionViewOutputSchema.pluginViews`) and
  read by `pluginViewOf({ views, name, schema })` in `packages/client/src/stream/plugin-views.ts`:
  undefined when absent, throws on a bag the schema refuses.
- `composePlugins(...).views` is the input, built at the app roots beside the decoder.

**Pod slots.** A plugin's pod slot is a factory over a context, so the plugin never imports the host
(`packages/plugin-sdk/src/slots.ts`):
```ts
export type PluginPodContext = {
  sessionId: string
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  events(): readonly V2Event[]
  call(
    op: CallOp,
    options?: { signal?: AbortSignal; onOutput?(bytes: Uint8Array): void },
  ): Promise<CallResult>
  onDaemonEvent(listener: (frame: DaemonEventFrame) => void): () => void
  log(message: string): void
}
export type PodSlot = {
  tools?(ctx: PluginPodContext): readonly ToolDefinition[]
  hooks?(ctx: PluginPodContext): HookChainArgs
  prompts: readonly PromptFragment[]
  commands: ReadonlyMap<string, CommandHandler<unknown>> // by inbox kind, e.g. "command:probe-observe"
  onDaemonEvent?(frame: DaemonEventFrame): void
}
```
`EMPTY_POD` and `EMPTY_CONTROL` are the spreadable empties. `composePlugins` flattens the slots in
`packages/plugin-sdk/src/compose-pod.ts`: tool names, prompt ids and command names are unique or it
throws (tool collisions throw when the pod context is built, the rest at compose time).
- `packages/host/src/holder/plugin-pod.ts` builds the context from the `SessionRecord` and
  `RemoteCalls` (`call` is `invoke` under a fresh key, `onDaemonEvent` is `RemoteCalls.onEvent`),
  extends the runtime's `ToolRegistry` with the plugin tools, and gives the loop a `HookChain` of the
  plugin hooks. Without `SessionRuntime.plugins` nothing changes.
- Prompt fragments join the registry through `agentHostPrompt({ extraFragments })`.
- Daemon frames fan out from `RemoteCalls.onEvent` to each slot's `onDaemonEvent` and to listeners a
  hook registered through the context.
- Pod inbox handlers are the `commands` map, keyed by the command's inbox kind; there is no separate
  inbox-handler slot yet.

**Pod append of a plugin body.** `AppendBody` accepts a `PluginEventBody` (#2013), and the command
context's `append` now does too. The plane validates with the composed schema.

**Control slots.** `ControlSlot` has `hooks` and `commands` (control-handled commands, as `rename` is).
`ports` is not built. The first plugin that needs a CP-side reaction (github subscriptions) added the
append hook: `ControlHook` is `AppendHook` (`packages/control/src/append-hooks.ts`), `{ name,
appliesTo(event), handle({ tx, sessionId, event }) }`. `ControlPlane` takes `appendHooks` and
`appendIn` runs them after `insertEvents`, inside the append transaction, so a throwing hook rolls
the append back (`packages/control/__tests__/append-hooks.spec.ts`). `ControlTx` gained
`upsertPrSubscriptionLease` / `deletePrSubscriptionLease` for the `GithubSubscription` transport row.

**Commands.** `PluginSlots.commands` is `readonly Command[]` from `@dltech/atlas-commands`. The API's
`nativeCommandRegistry` composes `[...nativeCommands, ...composedPlugins.commands]` and
`controlCommandHandlers()` merges the control handlers; the host's `composeCommands` and handler map
do the same with `composedPlugins.pod.commands`. A control command never enters `byInboxKind`.

**The `plugins/*` workspace and the import guard.** Root `package.json` workspaces gain `plugins/*`
(`package.json:6-11`). A `check-package-split.ts` rule (`scripts/split-guard/rules.ts`) rejects
`plugins/<a>` importing `plugins/<b>`.

**Proof for this PR.** The fixture plugin moved from `packages/plugin-sdk/src/__tests__` to
`packages/plugin-sdk/src/testing/fixture-plugin.ts` (exported as `@dltech/atlas-plugin-sdk/testing`,
now the `probe` plugin). Its fold reaches the view (control spec), its tool, hook, prompt fragment,
pod command and daemon handler run in a holder rig (`holder-plugins.spec.ts`), and its commands
dispatch through `postCommand` (API spec). No plugin means no change.

## 3. Order and packaging (operator confirms in §9)

One plugin per PR, each its own builder, worktree `/atlas/workspaces/wt-<slug>` and branch
`dennis/<slug>`, failing specs first, 40-minute box. Recommended order, which follows what a daily
user needs first:

| #   | PR                       | Package(s)                                           | Why here                                                                                     |
| --- | ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | contract                 | `packages/plugin-sdk`, `core`, `control`, host, apps | §2; no feature, everything after needs it                                                    |
| 2   | subscriptions and GitHub | `plugins/github` (subscriptions inside)              | the PR/branch/CI path a daily user needs; the only feature that also proves the control slot |
| 3   | shells                   | `plugins/shells`                                     | the tools a daily user leans on; proves the pod tool + daemon event seams                    |
| 4   | services and previews    | `plugins/services` (previews inside)                 | a preview is a published service port; same daemon op group                                  |
| 5   | memory                   | `plugins/memory`                                     | small; proves a plugin with no log events and a CP-owned table                               |
| 6   | crew                     | `plugins/crew`                                       | sub-agents; proves the biggest pod slot and the worktree argument                            |
| 7   | sessions                 | `plugins/sessions`                                   | peer sessions; the largest and the one with open questions                                   |

Each PR merges the plugin, its registration in the apps that need it, its live check and the roadmap
row update; the next starts from `origin/main` after the previous merges.

## 4. Registration and the end-to-end proof

- Each app imports the tier subpaths it runs and appends to its registration list:
  `apps/api` (`registered-plugins.ts` and the command registry), `apps/agent-host` (the same list
  feeds the plane, the tools, the hooks, the prompt and the daemon-event fan-out) and `apps/web`
  (`registered-plugins.ts`, plus the plugin's `/client` rendering).
- A plugin not registered in an app is absent there and its events decode as unreadable rows — one
  row, never a failed read (`docs/core-contract.md`).
- **Every plugin's proof is one live v2 session in a cloud pod on the atlas project**, driven from
  the web (or the v2 API for steps web lacks), with the result recorded in the plugin's section file
  under `$ATLAS_CONTEXT_DIR/sections/` and summarised here in §8. "Live" means the real
  `apps/agent-host` and sandbox daemon, not a rig.

## 5. The plugins

Each entry names what exists in v1 to copy, what the plugin declares, what leaves `core` and
`harness`, and what stays a foundation. Line counts are the survey's, not exact.

### 5.1 `plugins/github` (with subscriptions) — the subscriptions and GitHub path

**User-visible:** a session shows its branch, its PR with checks, and a CI change wakes the session;
the agent can subscribe to a PR and be told when it moves.

**v1 prior art (copy):**
- `packages/harness/src/plugins/github/`: `index.ts:51` (`GithubPlugin.contribute()` :68-247),
  `tracking.ts:41`, `family-tracker.ts:27`, `checkout-probe.ts:35`, `links.ts:51`,
  `pull-request-service.ts:32`, `pull-request-provider.ts:143`, `ci-watch-hook.ts:20`,
  `hooks.ts:55`/`:90`, `gh-pull-requests.ts:84`.
- `packages/harness/src/subscriptions/`: `registry.ts:29`, `journal.ts:46`, `provider.ts:18`,
  `delivery-buffer.ts`, `ready-queue.ts:97`.
- CP: `apps/api/src/api/cloud/github/` — subscriptions router/service, `githubPrs` stream and wakes,
  observation store and leases, webhook inbox, poll sweeper, `github-pr-state-writer.ts`, fan-out,
  `github-sandbox-wake*`.
- v2 already: `packages/core/src/record/branches.ts`, `views/checkouts.ts`,
  `views/pull-request-links.ts`, `packages/host/src/holder/branch-observer.ts`,
  `pr-linker.ts`, and the PR finder (it lived at `apps/agent-host/src/github/`; now `plugins/github/src/pod/finder.ts`, §8.2).

**Declares:**
- **Events:** `subscription-created`, `subscription-changed`, `subscription-ended` (v1 bodies in
  `packages/core/src/events/subscription-body.ts`; they are already core `EventBody` members, so the
  plugin's `events` list is empty and its schemas stay in core), and `pull-request-observed` if a PR
  change is worth a log row rather than a view update.
  **Correction (2026-11-08):** `branches-observed` and `pull-request-linked` stay in core with their
  folds (`checkouts`, `pull-request-links`). Architecture P6 puts branch, worktree and PR links in
  core as session facts, and the CP digest (`primaryBranch`) and web's v2 rows read them with
  types; a plugin fold would leave both reading an untyped bag for a value every session has. The
  host keeps the generic `BranchObserver`/`PrLinker`. What moves is the GitHub-specific half: the PR
  finder, the subscription machinery, CI watching and the prompt text.
- **Views:** `subscriptions` (a port of `subscriptionsOf`, `packages/core/src/subscriptions/subscription.ts:39`),
  the first real `pluginViews` entry (§2). `branches` and `pullRequests` stay core views.
- **Commands/tools:** `subscribe` (provider, target or current-branch PR, optional expiry),
  `unsubscribe`, `list_subscriptions`. In v1 these are tools
  (`packages/harness/src/tools/builtin/{subscribe,unsubscribe,subscription-list}.ts`); in v2 they
  become pod commands so the control handler can write the lease.
- **Pod:** the PR finder and linker, the branch observer's git watch, the subscription provider
  (`start/emit`), the CI-watch before-tool block, the after-tool/after-shell PR refresh, the CI
  prompt fragment, and the PR refresh on turn end. The host keeps the trigger points and calls the
  registered plugin handlers; no host file names GitHub.
- **Control:** subscribe/unsubscribe transport leases (`GithubSubscription`, living until the
  subscription's own expiry; no heartbeat in v2), the
  observation lease and budget (Redis), PR state reads, the wake of a linked session (one inbox
  `message` per live subscription, deduped and acked by the `GithubPrEventDelivery` row),
  and the PR state join into the view (replacing `postgres-views.ts:74`'s direct dependency on the v1
  table, or reading it through a CP port until cutover).
- **Client:** the PR badge and checks tally (`apps/web/src/features/shell/thread-pull-requests.ts`,
  `apps/web/src/features/threads/checks-tally.tsx`), a subscription indicator.
- **Transport:** `stream` for live PR events while a session is open.

**Leaves `harness`/v1:** the plugin's `contribute()` wiring, the per-thread tracking maps, the file
cache and the `gh` poller fallback (TUI-local; not carried), the `GithubUiBridgePort`.

**Stays a foundation:** git probing (`checkout-probe`, `run-command`, `git-watch`), webhook ingress,
`GithubPrState` and its event tables, the observation store's Redis plumbing, sandbox wake and boot.

**Proof (live):** on a v2 session, work on a branch and see it in the view; link a PR and see its
state and checks; subscribe to it; a CI change appends the subscription event and wakes the session;
unsubscribe and the next change wakes nothing. If the sandbox cannot push or open a PR (no GitHub
credentials), the operator pushes and the pod observes — record which in the section file.

### 5.2 `plugins/shells` — background shells and their live output

**v1 prior art:** `packages/harness/src/shells/` (`port.ts:50`, `shell-registry.ts`, `durable/*`),
tools `bash.ts:64`, `shell-output.ts:81`, `shell-input.ts:19`, `shell-kill.ts:60`, `shell-list.ts:43`,
`operator-shell-input.ts:21`; events `packages/core/src/events/shell-*`; assembly rules
`running-shells-block`, `background-shell-block`, `shell-kill-coverage`;
`packages/agent/src/loop/shell-completion.ts`; commands `/shells` and `/cd`
(`packages/core/src/commands/catalogue.ts:9`, `:5`).

**Declares:**
- **Events:** `shell-started`, `shell-ended`, `shell-killed`, plus an output notice (v1's
  `shell-*` bodies), moved out of core.
- **View:** `shells` roster (id, name, cwd, status, tail length, awaiting-input).
- **Commands:** `shells` (open the panel; a TUI affordance at slice 9), `cd` stays a host command.
- **Pod:** tools `shell` (background launch), `shell_output`, `shell_input`, `shell_kill`,
  `shell_list` over the daemon's `shells.*` ops; a shell-completion hook that folds a finished
  shell into the next step; the running-shells prompt fragment.
- **Control:** none beyond the view.
- **Client:** roster and selected shell; the transcript's shell lines
  (`packages/client/src/transcript/shell-lines.ts`).
- **Transport:** `stream` for `shells.output` (replaces v1's polling of `read-shell-output`).

**Stays a foundation:** the daemon's `shells` op group and process management, `RemoteCalls`, the
spool and cursor mechanics.

**Proof (live):** start a background shell, read its output while it runs, send stdin, kill it, see
the roster and the ended line; restart the agent host and the roster still sees the daemon's process.

### 5.3 `plugins/services` (with previews) — declared services and a public URL

**v1 prior art:** `packages/harness/src/services/` (`service-registry.ts`,
`declared-{services,ensure,launch,references,view}.ts`, `service-health.ts`, `service-restarter.ts`),
tools `service-start.ts:55`, `service_stop`, `service_list`, `service_restart`; events/notices in
`service-notices.ts`; the preview path `apps/api/src/api/platform/sandboxes/sandbox-self.router.ts:102`
→ `preview-tunnel.service.ts` → `apps/preview-worker`; client `use-previews`/`preview-ports` and the
in-app preview browser (`apps/web/src/features/threads/preview-*`).

**Declares:**
- **Events:** `service-started`, `service-ready`, `service-ended`, `service-restarted`,
  `port-exposed{port, url}`.
- **View:** `services` roster with exposure (port, URL) — the input to the preview list.
- **Commands/tools:** `service_start{name?, command?, port?, exposePort?}`, `service_stop`,
  `service_list`, `service_restart`; `.atlas/services.yaml` resolution and setup move here from
  `declared-*`.
- **Pod:** the service supervisor over the daemon's `services.*` ops, the health and restart policy,
  the declared-service ensure/setup/reference logic, and the `exposePort` call to the API with the
  sandbox token.
- **Control:** none that is new; the preview tunnel and the `preview-worker` stay infrastructure. The
  client's preview list reads the view.
- **Client:** the services panel and the preview browser (web; Mac renders web).
- **Transport:** `stream` for the service log tail.

**Stays a foundation:** the daemon's `services` op group and `port-probe`, the API's preview tunnel,
the `preview-worker` Cloudflare app.

**Proof (live):** start a service with a portal, open the URL through the preview host and see the
page; the roster shows the port; stop it and the view and the preview list update.

### 5.4 `plugins/memory` — the agent's own memory

**v1 prior art:** `packages/harness/src/memory/` (`memory-port.ts:22`, `cloud-memory-port.ts:36`),
tools `memory-write.ts:39`, `memory-read.ts:27`, `memory-edit.ts:30`, `memory-delete.ts:26`; the
`BeforeTurn` index hook `packages/harness/src/hooks/load-memory.ts:15`; the system text
`packages/core/src/memory/prompt.ts`; the API `memories` router/service and the `Memory` table.

**Declares:**
- **Events:** none. Memory is per-user state, not session history; a write does not belong in the
  transcript.
- **Views:** none (it is not per-session).
- **Commands/tools:** the four tools; a `memory` command only if a surface needs to list entries in
  a session (not planned).
- **Pod:** the four tools over an injected memory port (the v1 API route until cutover), the index
  hook and the prompt fragment.
- **Control:** the CP handlers for the `Memory` table once v2 owns it (the port stays behind the
  plugin so the tool never talks to the API directly at cutover).
- **Client:** the settings memory UI (`apps/web/src/features/settings/*memory*`).
- **Transport:** `none`.

**Proof (live):** write a memory, see it in the next turn's injected index, edit it with a revision
and a stale revision is refused, read and delete it, and it appears in the web settings list.

### 5.5 `plugins/crew` — sub-agents

**v1 prior art:** `packages/harness/src/agents/` (registry, child runner, supervisor), tools
`agent-spawn.ts:60`, `agent-say.ts:29`, `agent-stop.ts:49`, `agent-list.ts:51`, `report-to-main.ts:30`,
and the worktree tools `enter-worktree.ts:52`, `exit-worktree.ts:88`, `worktree-list.ts:35`; events
`packages/core/src/events/agent-schema.ts:14-44`; folds `packages/core/src/agents/*`; assembly rules
`agent-endings-block`, `agent-reported-block`, `running-agents-block`; client
`packages/client/src/crew/*`.

**Declares:**
- **Events** (leave core): `agent-spawned`, `agent-ended`, `agent-restarted`, `agent-reported`;
  `worktree-entered`/`worktree-exited` stay a foundation event (they are not crew-specific and
  `packages/agent/src/loop/settle-pending.ts:5` already folds `activeWorktree`).
- **View:** `crew` (roster, standing, last report).
- **Commands/tools:** `agent_spawn{agentType, intent, brief, worktree?}`, `agent_say`, `agent_stop`,
  `agent_list`, `report_to_main`. `agent_spawn`'s `worktree` is 0020 decision 1: a new branch name
  or an existing worktree path the pod creates or adopts before the child's first turn.
- **Pod:** the child runner and supervisor, the deny list (`subscribe`, `operator_input` and the
  memory tools denied; the worktree tools allowed, 0020 decision 2), the run-under-one-lease
  behaviour, and the report a child sends.
- **Control:** none; children live under the parent's lease.
- **Client:** the crew panel and per-agent activity.
- **Transport:** `stream` for live child output if the panel shows it in v2.

**Leaves `harness`:** the teammate path entirely (sessions replaces it), the per-thread family
tracking, the TUI-only panels.

**Proof (live):** a v2 session spawns a sub-agent that enters a worktree, edits a file, commits and
reports; the parent reads the report; the view shows the child and its worktree; `subscribe` is
denied inside the child; the parent removes the worktree.

### 5.6 `plugins/sessions` — peer sessions

There is no v1 code to copy: `spawn_session`, `message_session` and `list_sessions` do not exist in
v1 (only ADR 0020 and [03-teammates.md](03-teammates.md) describe them). The teammate workflow
survives as the peer-session preset (03-teammates, "The decision").

**Declares:**
- **Events:** none of its own; a spawned session is an ordinary session. The `spawned-by` link is a
  session-record field written by the spawn command, and `sender` on an inbound message is an
  envelope field (03-teammates, "Sender as a first-class field").
- **Views:** `spawnedBy` (the sidebar nesting and the Done grouping). Slice 4's view does not carry
  it; this plugin adds the fold, and web's sidebar reads it
  (`apps/web/src/features/shell/v2-rows.ts:19`).
- **Commands** (control-handled, like `rename`): `spawn_session{agentType?, brief?, worktree?,
  intoPod?}`, `message_session{sessionId, text}`, `list_sessions`. The tools of the same names post
  them.
- **Pod:** the three tools; the sender ACL and the per-session message budget are enforced by the
  control handler, not the pod.
- **Control:** creating the session and its main thread (`createSessionWithMainThread`), the
  `spawned-by` link, placement (`podRef` = the spawner's pod for the teammate preset), the inbox
  message that wakes an idle peer, and the budget count.
- **Client:** the sidebar nesting and the Done group; the peer's own session page is the ordinary one.
- **Transport:** `none`; the session stream carries everything.

**Open (0020, to settle in this plugin's spec section):** the per-session message budget (a number
and a window); whether `intoPod` is default-on for a teammate preset or an option; whether the
preset groups under the spawner in the sidebar via `spawned-by` alone or needs a family label.

**Proof (live):** a v2 session spawns a peer with the teammate preset; it shares the pod; the parent
messages it and the peer replies; the sidebar nests it under the parent; the operator archives it and
it moves to Done; the budget refuses a message past the limit.

## 6. Test plan

| Layer                                   | What                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract                                | The fixture plugin registers every slot; a plugin with a missing slot fails typecheck; two plugins collide on a tool, hook or prompt id and boot fails; `plugins/a` → `plugins/b` fails the split guard |
| Pure (`/core`)                          | Each plugin's folds and guards over plain event arrays; command argument schemas and refusal strings                                                                                                    |
| Control conformance (memory + Postgres) | A plugin event folds into `pluginViews` and survives the view catch-up; a plugin's control command writes its row and appends nothing; a plugin command's pending row clears on its outcome             |
| Pod (rig)                               | Each plugin's tools run over the in-memory daemon; hooks fire at their phase; a daemon event reaches the registering plugin; a plugin body appends and re-reads (the #2013 spec's shape)                |
| Web                                     | Each plugin's client state renders from the view and the snapshot; a refusal shows its reason                                                                                                           |
| Live (one per plugin)                   | The proof named in §5, on a real v2 cloud session; recorded in §8 and the section file                                                                                                                  |

## 7. Out of scope

- The TUI's v2 session surface, its slash commands and its panels: slice 9. Web presents capabilities
  as affordances; no slash commands (operator, 2026-11-07).
- `/rotate`, `/new`, `/model`, `/help` and the rest of the v1 catalogue; `/cd` stays host-side.
- Repo-loaded plugins (v1's `directory-source`, `repo-plugins`, `purity`, `manifest` machinery):
  slice 7 moves native plugins only.
- The unread dot (slice 8); local pods and `atlasd` (slice 9); v1 retirement (slice 10).
- Moving v1's durable shell supervisor, its notice/awaiting-input machinery or its file PR cache:
  the daemon's own process state replaces the supervisor; notices become plugin events.

## 8. Results

Filled per plugin as each PR merges: the package, its registrations, the live check table and any
correction this spec needed.

### 8.1 `plugins/github`, PR 1 of 2 (subscriptions)

Shipped: `plugins/github` (`@dltech/atlas-plugin-github`, `/core` `/pod` `/control` `/client`),
registered in `apps/api`, `apps/agent-host` and `apps/web`; the `subscriptions` view; `subscribe` /
`unsubscribe` as pod commands and `subscribe` / `unsubscribe` / `list_subscriptions` as pod tools
(target resolved with `gh` over `ctx.call('exec')`); the CI-watch `beforeTool` hook and prompt
fragment; the control append hook that writes and removes the `GithubSubscription` lease in the
append transaction. One writer: the pod appends the journal event, the CP derives the lease from it.

**Lease lifetime.** v1's 5-minute `GithubSubscription.expiresAt` was a liveness heartbeat. v2 has
no heartbeat, so the append hook sets `expiresAt` and `liveUntil` from the `subscription-created`
body's own `expiresAt`, falling back to `DEFAULT_SUBSCRIPTION_TTL_MS` (24 h) when it is absent or
unreadable. A subscription created once stays live until it ends or expires; no timer or poller.

**The wake.** The control plane cannot append to a session (no holder lease), so its write is the
inbox. `GithubPrEventMailboxService.record` (the one place every webhook, poll and discussion event
passes) calls `noticeV2Sessions` (`apps/api/src/api/cloud/github/github-v2-notice.ts`) in the
same transaction as the event row when the caller passes one. For each live `GithubSubscription` of
the event's user and PR whose `threadId` is a `V2Thread`, it inserts a `GithubPrEventDelivery` row
keyed `(eventId, threadId)` and, only when that insert wins, posts one `message` inbox entry via
`postInboxEntryIn` (`@dltech/atlas-control/postgres`: allocate id, insert, `NOTIFY` wake and change
in the same `Tx`). The holder already turns a `message` entry into `user-said` and a turn
(`inbox-intake.ts`), so there is no new inbox kind and no plugin inbox handler. The text is
deterministic (`github-v2-notice-text.ts`): PR number and URL plus the verdict with the checks
tally, mergeability, a merged/closed transition, or the review/comment author.

**Ack.** The delivery row is inserted already acked (`ackedAt` set, no lease), so it is both the
dedupe and the ack: v1's `githubPrs.ackEvents` exists because a pod journals the event later, but a
v2 inbox entry is durable in the same transaction, so there is nothing for a pod to ack and the
replay path (`claimDeliveries`) skips an acked row. One notice per event per subscription holds
across a repeated fan-out, a webhook plus a poll, and a restart, because event rows are
dedupe-keyed per user and the delivery primary key is `(eventId, threadId)`. Spec:
`github-v2-notice.spec.ts` fans the same event out twice.

Not shipped here: the PR finder move and the header indicator; both shipped in §8.2, which completes the plugin.

**Live check (2026-11-08, production).** Session `26efecc4-fe86-457a-b357-caccbda4d825`, thread
`ef3aa40c-b3fb-403c-86e1-d3ce49173cd6`, project `cmvh6z3ls002i08jwseqmwbrv`
(dennisofficial/atlas), agent host `fbedb2479`, throwaway PR #2023 (closed after the check).

| Step                           | Result                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe` tool on PR #2023   | `subscription-created` at seq 21                                                                                                                  |
| Lease row                      | `branch "#2023"`, `threadId` = the main thread, `expiresAt` 2026-11-09T14:07:53Z (24 h), `pollBacked: true`                                       |
| Second commit (`0baef077a`)    | one `GithubPrEventDelivery` row, kind `mergeability`, acked 14:08:15Z                                                                             |
| The notice                     | one `user-said`: `GitHub: PR #2023 (https://github.com/dennisofficial/atlas/pull/2023) is mergeable.`, with an assistant reply — the session woke |
| Duplicate event                | none: one delivery row for that event                                                                                                             |
| `unsubscribe` tool             | the `GithubSubscription` row was gone                                                                                                             |
| Third commit after unsubscribe | no delivery in the following four minutes (`silent=yes`, one delivery in total)                                                                   |

### 8.2 `plugins/github`, PR 2 of 2 (finder move, indicator, acting as the user)

Shipped:
- **The finder and identity lookup moved into the plugin.** `GithubPullRequestFinder` and
  `githubIdentityLookup` are `plugins/github/src/pod/finder.ts` and `identity.ts`, exported from
  `@dltech/atlas-plugin-github/pod` with their specs. The plugin does not import
  `@dltech/atlas-host`: it declares the structural types it needs (`GithubTokenSource`,
  `PullRequestFinder`/`FoundPullRequest`, `IdentityLookup`/`GitIdentity`), which the host's
  `PullRequestFinder` and the shell env's `IdentityLookup` satisfy. The composition root
  (`apps/agent-host/src/runtime/session-runtime-factory.ts`) builds `pullRequests.finder` and the
  shell env identity from the plugin; `apps/agent-host/src/github/` is deleted. The host keeps the
  generic `PullRequestSource`, `BranchObserver` and `PrLinker`.
- **Subscription indicator.** `subscribedPullRequestsOf` (`/client`) turns the `subscriptions` view
  into `{ number, label, url }` for active GitHub rows; `sessionViewModelOf` reads it from
  `view.pluginViews` and `SessionHeader` renders a bell with the PR numbers, each linking to the PR,
  beside the branch and PR badge. No new fetch.
- **The pod acts as the user.** Audit of `shell-env.ts`, `signing-setup.ts` and the prompt
  fragments found nothing that adds a co-author trailer or an Atlas identity, so nothing was
  removed. The git identity is the signing key's user name and email, else the GitHub noreply
  identity; commits are signed when a key exists. Specs: `shell-env.spec.ts` asserts one
  `user.name`/`user.email` pair, no trailer, template or hooks-path entry and no `atlas` in the
  identity; `signing.e2e.spec.ts` asserts a real commit in a sandbox shell is signed, verifies, and
  its message is the one given, with no `Co-authored-by` or Atlas text.

Not changed: the PR badge and checks tally stay in web, fed by the core `pullRequests` view
(§5.1's correction); only the indicator is plugin data. Host files still name GitHub where it is
the transport, not a feature: the token reader, the credential helper and `github.com` URL rewrite
in `shell-env.ts`, and clone. These move with the shells/services slices or a future git plugin.

**Live check (2026-11-08, production).** Session `64e981de-056d-4cad-95e2-070bb93d2334`, thread
`ae18de86-f218-4398-9c27-f03fc350c65c`, agent host `72c4f274e`, throwaway PR #2027 (closed after
the check).

| Step                                             | Result                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent branches, commits and pushes           | commit `f98715ad520215ee8fa7fae23203bbe525ad914c`, author and committer `dennisofficial <34203433+dennisofficial@users.noreply.github.com>`, GitHub verification `verified: true, valid`, message `chore: identity live check` — no `Co-authored-by`, no Atlas text |
| The agent opens PR #2027 and the finder links it | the session view carries the link (`pullRequests`)                                                                                                                                                                                                                  |
| `subscribe` to #2027                             | `pluginViews.subscriptions` holds one active row, label `dennisofficial/atlas#2027`, the data the header bell renders                                                                                                                                               |
| `unsubscribe`                                    | the bag empties without a reload                                                                                                                                                                                                                                    |

The header's rendering itself is covered by `session-header.spec.tsx` and
`session-view-model.spec.ts`; the live run proves the view data behind it.

### 8.3 `plugins/shells`

Shipped: `plugins/shells` (`@dltech/atlas-plugin-shells`, `/core` `/pod` `/control` `/client`),
registered in `apps/api` and `apps/agent-host`; the `shells` view; the tools `shell` (background
launch), `shell_output`, `shell_input`, `shell_kill` and `shell_list` over the daemon's `shells.*`
ops; the ending recorder that appends `background-shell-ended` from the `shells.ended` frame, deduped
against the journal and serialised behind the in-flight launch; the running-roster `beforeStep` hook;
the prompt fragment. `background-shell-started` gained an optional `cwd` so the roster can show it
(v1 events still decode; v1 never sets it).

What this plugin does not need, and why:
- **No completion hook.** Core assembly already hands `background-shell-ended` to the model
  (`packages/core/src/assembly/rules/messages-from-events.ts:293`) and `close-quiet-step.ts:33`
  nudges a quiet model when one arrived. The plugin only appends the ending; a hook would duplicate
  both.
- **No `afterShell` phase.** `HookChain.afterShell` exists but nothing in the v2 loop calls it. The
  trigger is the daemon frame.
- **No `PodSlot.onDaemonEvent`.** It is handed a frame and no context, so the recorder is registered
  as a listener from `hooks(ctx)` through `ctx.onDaemonEvent` (`packages/plugin-sdk/src/slots.ts:12`).
- **No live-output stream yet.** Spec §5.2's "Transport: `stream` for `shells.output`" is declared
  (`transport: 'stream'`) but nothing consumes `ComposedPlugins.transports`, and the pod has no
  channel to a browser except the durable journal, which would flood. The options are written up as
  an open question in the plugin's section file; this PR does not invent one.

Not shipped here: the web roster chip (a follow-up PR reads `pluginViews.shells` in the session
header). The transcript's ended line already renders from the core event
(`packages/client/src/transcript/notice-entries.ts:22`).

**Live check (2026-11-08, production).** Session `7850e6ff-c1be-4a0c-918f-f841caa3e7b8`, thread
`759c2536-d748-4de1-86a0-1642c9ec0fa9`, project `cmvh6z3ls002i08jwseqmwbrv` (dennisofficial/atlas),
agent host `a4bb01faa`, replaced mid-check by `629a89369` (which is what the restart row proves).

| Step                     | Result                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start a background shell | `shell-c83ae35a`, `background-shell-started` at seq 25, `cwd: /atlas/workspaces/workspace`, description `ticker`                                                                                                                                                 |
| Read it while it runs    | `shell_output` at seq 34 → `tick 1`, `status: running`, `remainingCharacters: 0`                                                                                                                                                                                 |
| The roster               | `shell_list` at seq 35 → the row, `state: running`, 7 characters printed                                                                                                                                                                                         |
| Kill it                  | `shell_kill` at seq 40 → `tick 2`; exactly one `background-shell-ended`, seq 39, `status: killed`                                                                                                                                                                |
| The view                 | `pluginViews.shells` = `[{ shellId, name: "\"ticker\" (…) ", cwd, status: killed, characters: 7, awaitingInput: false }]`                                                                                                                                        |
| Answer its stdin         | `shell-03f3defa` launched with `input: true`; `shell_input` wrote `hello\n` (seq 54); `shell_output` (seq 59) → `got:hello`                                                                                                                                      |
| Restart the agent host   | keeper `shell-4e38e2b0` (`while true; do echo alive; …`) started at seq 67; the deploy of `629a89369` replaced the holder; the next turn's `shell_list` (seq 76) still returned it — running, 306 characters printed. The daemon, not the journal, is the roster |
| Teardown                 | keeper killed (seq 83, `status: killed`), session archived, temporary `AuthSession` row deleted                                                                                                                                                                  |

## 9. Answers (2026-11-08)

1. **Order and packaging.** As recommended in §3: the contract, then github (subscriptions inside one
   package), shells, services (previews inside), memory, crew, sessions.
2. **Teammate budget.** 20 messages per peer session, resettable by the operator.
3. **GitHub.** The pod acts with the operator's OAuth credentials. Commits are the user's, with no
   co-author trailer and no Atlas trace. The sandbox may push and open PRs.
4. **MCP and skills.** Their own slice, out of slice 7 (see Next below).

## Next

MCP and skills get their own row after slice 7; §7 no longer proposes them for this slice.
