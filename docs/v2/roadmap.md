# Atlas v2 roadmap

Ordered slices, the current state, and how the work moves between sessions. The design is in
[architecture.md](architecture.md); the package map is [0019](../decisions/0019-v2-package-map.md).

## How v2 is built: one slice per session

Each slice is built in its own Atlas session and handed to a fresh session when it is done.
1. **Start.** Read [README.md](README.md), then this file's [Current state](#current-state), then
   the slice's spec in [slices/](slices/). If the spec does not exist, writing it is the first job,
   and the operator approves it before building starts.
2. **Build.** One branch and one or more PRs per slice. Every PR merges to `main` with v1 still
   working, because v1 is the daily driver. A slice that touches v1 code (an extraction) changes
   no v1 behaviour.
3. **Verify.** The slice's exit criterion holds, CI is green, and the operator restarts and tests
   v1 after the merge.
4. **Update the docs in the same PR as the code.** Mark the slice done below, write what the next
   session must know under Current state, and fix any doc the code proved wrong. `docs/v2` is the
   only handover that survives: cloud session scratch and `/tmp` do not.
5. **Hand off.** Run the handoff skill. The handoff doc points at these files; it does not repeat
   them.

## Current state

_Updated at the end of every slice. Last update: 2026-11-10._
- **Done 2026-11-10: slice 7b, MCP and skills** ([spec](slices/07b-mcp-skills.md), live check in
  its §9). `plugins/skills` is registered (#2150), so a session offers `skill`, `skill_install`,
  `skill_edit` and `skill_delete`, its listing carries the cloud rows, the clone's `.atlas/skills` and
  `.agents/skills`, and its built-ins; the cloud source and the revision-checked writer run over the
  host's own Postgres. On production, one session listed and loaded a built-in, a repo skill and a
  cloud skill, installed/edited/deleted one in each layer, and a repo `opentui` shadowed the cloud row
  of that name. `plugins/mcp` read both cloud rows with their layers, a project `.atlas/mcp.json`
  disabled stub hid the cloud project row, a stdio server from the clone connected, answered
  `mcp__echo__echo`, delivered its `instructions` in an `mcp-instructions` block, and a server pointed
  at a missing file showed `failed` with its stderr. The live run also found five defects, fixed in
  #2157: `>-` frontmatter descriptions, a skill installed mid-turn that could not be loaded until the
  next turn, MCP config rejections that vanished from the view, instructions arriving a turn late, and
  a killed server still reading `connected`. The last gap closed the same day: a cloud row's
  sealed OAuth grant is now used (#2168), so both cloud servers connect: the roster read `Posthog connected` with one tool and
  `mcp__Posthog__exec` returned live project data, and after a Settings sign-in `wispr-flow connected`
  with fifteen tools answered `search_meetings`. A row with no grant stays `needs-auth`. Refresh of an
  expired grant is its own slice.

- **Slice 7c built, live check outstanding (2026-11-09)** (`#2116`, `#2121`): `plugins/web` gives a
  v2 session `web_search`, `web_fetch` and `browser` — the search over the operator's backend and
  `search.<backend>` key through one narrow `PodControl.webSearch` read, the fetch host-side with
  v1's formats, patterns and cache, the browser over the daemon's `exec` with a per-session
  `--session atlas-<sessionId>`. `task_write` is a host core tool again (it is not in `daemonTools`,
  which gates effects, detach and deed claims), and `MirrorPlanHook` composed by `hostHooksOf()` puts
  the plan back in the next step's context, so the prompt that has advertised the checklist since
  slice 3 no longer lies. Both specs pass and every touched package typechecks cold; **no live v2
  session has run them yet** — slice 7c §8 is where that gets recorded.
- **Spec written 2026-11-10: slice 7d, MCP sign-in from the transcript**
  ([spec](slices/07d-mcp-sign-in.md); open questions in its §7). Both cloud MCP servers sign in once from
  Settings and connect (#2168), but nothing in a session can start a sign-in: a server only the repo
  names has no row to hold a grant, and v2 has no sign-in flow of its own. The slice adds `mcp_sign_in`
  to `plugins/mcp`, a host-owned OAuth flow ported from v1 (discovery, registration, PKCE, callback,
  sealed grant, refresh with a row claim instead of a Redis lock), a public callback on the agent host,
  and the same tool for a repo-only entry, which would create a user-scope row to hold its grant (its
  §7 asks the operator to confirm that).

- **Spec written 2026-11-09: slice 7c, the native tools v2 lacks** ([spec](slices/07c-native-tools.md);
  open questions in its §11). Slice 7 and 7b closed every plugin, and these tools were handed to no
  one. Three are ported: `plugins/web` carries `web_fetch` (host-side, v1's formats, patterns and
  cache) and `browser` (the image's baked `agent-browser` over the daemon's `exec`), and `task_write`
  becomes a host core tool — the prompt has advertised it since slice 3 with no tool behind it, so
  every v2 session is told to keep a checklist it cannot write. `web_search`, `web_fetch` and
  `browser` shipped together as `plugins/web` (#2116), with one narrow `PodControl.webSearch` read of
  the operator's backend and `search.<backend>` secret — no general secret read, so a pod tool cannot
  open the operator's account. Three are
  **not ported with the reason on the record**: `operator_input`/`operator_shell_input` need a human
  answer inside a running tool call, which v2 has no path for; `cloud_config` would give a session
  write authority over the operator's account that 0027 removed, and every row it manages has an
  owner; `execution_location` has one location in v2. Two names in the handover were not tools at all
  (`worktree_adopt` is `enter_worktree`'s `path` branch, `agent_tokens` is a pair of DI tokens).
- **Spec written 2026-11-09: slice 7b, MCP and skills** ([spec](slices/07b-mcp-skills.md); open questions in its §10). Slice 7 closed all six plugins and handed these two here. The one contract change is a live tool source: `ComposedPodRegistry` takes a supplier so a plugin's tools are re-read every step, which is what an MCP server whose tool list changes needs. `plugins/mcp` reads cloud rows (`public.McpServer`, unsealed with the host's `SecretCipher` as GitHub tokens already are) and the clone's `.mcp.json` / `.atlas/mcp.json`, spawns stdio servers through the daemon's existing `mcp.*` ops, and keeps v1's tool naming, effect mapping and instructions hook. `plugins/skills` turns the dead `skill-index.ts` read into the listing and adds `skill` over repo dirs
  (`.atlas/skills`, `.agents/skills`, symlinks followed), cloud rows and compiled built-ins, plus full
  CRUD from a session — install, edit and delete — with no pod copy of a cloud skill: the rows are the
  only copy and their files are served on demand. MCP stays read-only: no sign-in, no `mcp-edit`.

- **`plugins/sessions` live-checked on production (2026-11-09)** (`#2095`, `#2097`, `#2099`): a
  session can create another session with a brief — an ordinary one by default (its own sandbox and
  a fresh clone) or, with `intoPod: true`, a teammate sharing its sandbox and context, and a
  teammate cannot make a teammate. It can message any session of the operator's and list them; the
  sidebar nests a spawned session under its spawner and folds an archived one into that row's Done
  group, and the brief and the reply cross in a named agent lane. The 20-message budget the feature
  first shipped was removed the same day. Session `b6cdbfe7-63b3-4f46-a3fe-c493b3fe06cc`, agent host
  `bd4eb64b1` (spec §8.9).

- **The agent host calls the API for nothing, and both backends are NestJS (2026-11-09)**
  (`dennis/agent-host-owns-its-work`, [0027](../decisions/0027-both-backends-own-their-work.md)):
  `hostSelf.*` and `hostMemory.*` are gone; memory is `@dltech/atlas-memory` and previews are
  `@dltech/atlas-previews`, evaluated in-process by the host over its own Postgres, and `apps/api`
  keeps thin Nest adapters that answer exactly as before. `AGENT_HOST_TOKEN`, its middleware and
  its tier entries are deleted. The host boots a `@nestjs/core` application context with modules
  and providers while the stream server keeps `Bun.serve`. The host tier now carries
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_ZONE_ID` for `exposePort`.
- **`plugins/memory` live-checked on production (2026-11-09)**: write → index in the next prompt →
  read → edit → a stale edit refused with `read it again` → delete, all through the agent; sessions
  `8a7ed307-0e59-48a1-8637-b48e328713b8` and `cef48f40-2327-4ff6-819b-dfa015c41709` (spec §8.7). The
  first run found the reply envelope leaking into the tools, fixed in #2071.
- **Slice 7 PR 8, `plugins/memory`** (`dennis/memory`): the four memory tools and the index hook,
  over a new `PodControl.memory` port that the host answers on `hostMemory.*` with
  `AGENT_HOST_TOKEN` — a v2 cloud pod has no user token, so memory cannot use the v1 route (spec
  §8.7). No events, no view: memory is per-user state, not session history.
- **`plugins/crew` live-checked on production (2026-11-09)**: a v2 session spawns a sub-agent that
  runs on its own thread, reports, and wakes the parent, and a second child proves it has no
  `subscribe` and no memory tools (spec §8.8, session `ccdf548d-9092-49f7-8378-532f6aacf703`). The
  seam is a local `PluginPodContext.crew` port — children run in the agent host under the parent's
  lease, with no hop to the API — and `PodSlot.childDeny` carries ADR 0020's deny list. A reviewer
  round found eight defects in the pump (a swallowed mid-call message, self-restarting failures, two
  runners for one child, unfenced child records, a progress report suppressing the completion, an
  idle release under a live child, `subscribe` reaching children, and listeners outliving a child),
  all fixed before the merge.
- **Slice 7 PR 9, `plugins/crew`** (`dennis/crew-plugin`, #2079): the five sub-agent tools, the
  `crew` view and the child-run supervisor. Worktree tools and the web panel are 1b.
- **The web preview list** (`dennis/web-previews`, #2063): a session's published previews show in web
  as a header chip opening a list of their public URLs. It reads the `services` view, not the CP's
  tunnel tables — the view is what streams and what knows whether the service is up (spec §8.6).
- **Slice 7 PR 6, services part 2 — previews** (`dennis/service-previews`, #2058): the host publishes a
  service through `ctx.control.exposePort`, the daemon runs cloudflared with the returned token,
  `service-started` carries the `url`, and a stop takes it down. Live-checked on production
  2026-11-08: `200 preview-ok` over HTTPS, then `530` after the stop (spec §8.5). Two fixes fell out:
  `hostSelf.exposePort` resolved v1 sessions instead of `v2.V2Session` (#2059), and the tunnel token
  was leaking into the daemon's op journal and cloudflared's argv, both closed.
- **Slice 7 PR 7, declared services** (`dennis/declared-services-v2`, #2056): `service_start` by a
  name from `.atlas/services.yaml` — `needs`, `setup` once per session with the declaration's env,
  `health` through a new daemon `healthPath`, stale detection by `declarationHash`, restart and stop by
  name (spec §8.4).
- **Slice 7 PR 5, `plugins/services` part 1** (`dennis/services`): the plugin over the daemon's
  `services.*` ops — the `services` view, `service_start`/`stop`/`restart`/`list`, the ready/ended
  frame recorder with a log tail, and `service-ready` as the first real plugin event. Live-checked on
  production 2026-11-08: start with a readiness wait, list, stop, one `service-ended`, the roster in
  `pluginViews.services` (spec §8.4). Declared services and previews are part 2. The check also
  exposed a loop defect — a turn kept alive for an event the model had already answered — fixed in
  #2047.
- **Slice 7 PR 4, `plugins/shells`** (`dennis/shells`): the fifth plugin tier package. The `shells`
  view folds the core `background-shell-*` events; `shell` / `shell_output` / `shell_input` /
  `shell_kill` / `shell_list` drive the daemon's `shells.*` ops; the pod appends the ending from the
  daemon frame; a `beforeStep` hook adds the running roster and a prompt fragment explains the
  tools. Live-checked on production 2026-11-08: start, read, answer stdin, kill, the roster in
  `pluginViews.shells`, and a shell still listed by `shell_list` after the agent host was replaced
  (spec §8.3). The web header shows a chip with the running shells (#2036).
- **Slice 7, `plugins/shells` follow-up** (`dennis/shells-live-output`): the running-shells reminder
  moved out of the plugin's `beforeStep` hook into `defaultRules`, derived from the journal when no
  live source is given, and the live output stream §5.2 declared shipped: the pod publishes
  `shell-output` live frames driven by the daemon's throttled `shells.output` frame, a bounded Redis
  backlog replays them to a browser joining mid-shell, and the web header's shells chip opens each
  running shell's tail. The durable journal still records only the start and the ending (spec §8.3).
- **Slice 7 PR 3, `plugins/github` complete** (`dennis/github-ui`): the PR finder and identity lookup
  moved from `apps/agent-host/src/github/` into the plugin's `/pod`, called from the agent-host
  composition root; the session header shows the PRs the session is subscribed to; specs prove the
  sandbox shell is the user's identity with no trailer or Atlas trace. Live-checked on production
  2026-11-08: a sandbox commit is the user's, signed and verified, with a clean message; the
  subscription view drives the header bell and empties on unsubscribe (spec §8.2).
- **Slice 7 PR 2, `plugins/github` subscriptions** (`dennis/github-plugin`): first registered plugin.
  Subscribe/unsubscribe/list, the CI-watch hook and the `subscriptions` view are live; the CP derives
  the `GithubSubscription` lease from the journal event through a new control append hook, which
  lives until the subscription's own expiry (24 h default, no heartbeat). A PR event posts one inbox
  message to each subscribed v2 session, deduped by the delivery row. Live-checked on production
  2026-11-08: one notice and a woken turn on a CI change, silence after unsubscribe (spec §8.1).
- **Slice 7 PR 1, the plugin contract** (`dennis/plugin-contract`): plugin views ride the session view
  (version 4), pod tools/hooks/prompts/commands/daemon events and control commands are live, and
  `plugins/*` joins the workspace with an import guard. No plugin is registered yet.
- **Spec written 2026-11-08: slice 7, plugins** ([spec](slices/07-plugins.md); open questions in its
  §9). It completes the slice-6 contract first (plugin views in the session view, pod tools/hooks/
  prompts/daemon events, control commands), then moves each feature into `plugins/<name>/` in the
  operator's order: github with subscriptions, shells, services with previews, memory, crew,
  sessions. The decode-site groundwork merged in #2013: the plane's composed schema now reaches the
  view catch-up, the command tail, the digest view and the host's append, and the three apps build
  the schema from an empty registered-plugin list.
- **Done 2026-11-08: slice 6, `plugin-sdk` and `commands`** ([spec](slices/06-commands.md); PRs #2002,
  #2003, #2005, #2006, #2007, #2008). `core` gained the type-level event registry and the composed
  decoder, `packages/plugin-sdk` the slot-complete contract (proven by a fixture plugin), and
  `packages/commands` the command contract: one spec per capability, `handledIn: 'pod' | 'control'`,
  and a single `sessions.command` that validates and posts `command:<name>` into the inbox. The
  holder runs a command between turns, appends `input-refused` when it refuses, and never mid-turn.
  A v2 session can now be rewound from a message (spend holds, the meter drops), summarised up to a
  message, and renamed from a pencil on the session row — web affordances, no slash commands there.
  The TUI renderers and text dispatch land with slice 9.
- **Done 2026-11-07: slice 5, client SDK, web and Mac** ([spec](slices/05-realtime.md); PRs #1873, #1875, #1876,
  #1880, #1886, #1905, #1914, #1928, #1933, #1939, #1940, #1963, #1971 and the scale gate PR). The scale gate passes
  on one node: a 20k-event thread opens in 145 ms cold and 74 ms warm (target 1 s), and 1,000 followers on one thread
  at 100 events/s see p99 49.7 ms to the socket (target 250 ms) at 87 % of one core and 277 MB RSS, after per-node
  shared reads replaced 2,000 queries per append. The Mac app wraps the web build (`apps/mac` `build:web`); release
  v1.250.3 (7005a2a8b) carries every v2 web change.
- **Done 2026-11-07: slice 4, views** ([spec](slices/04-views.md); PRs #1984, #1988–#1992, fix #1994). Status,
  context meter, spend (every call, rewound or not), branches and PR links with v1's PR state and checks are
  `core` folds materialized in `v2.V2SessionView` in the append transaction; PR state is joined from
  `public.GithubPrState`, and a GitHub state write announces linked sessions. Start failure is its own status
  (`start-failed`) with a Retry action (`retry` inbox entry). Stream protocol 2 sends `view{session}`;
  protocol-1 clients keep `view{status}`. Live check in the spec §11. Gaps: v2 sandboxes cannot push or open
  PRs (no GitHub credentials); rewind is not on v2 until slice 6; the unread dot is slice 8.
- **Done:** slice 0 (design). Decision 0018 accepted, 0019 (package map) proposed; D6 storage verified (Prisma 8
  `namespace v2`); research censuses refreshed to `a0bf4110`.
- **Done:** slice 1, record core ([spec](slices/01-record-core.md)). Pure rules in
  `packages/core/src/record/`; `@dltech/atlas-control` (`ControlPlane` over one
  `ControlStorePort.transact`, in-memory and Postgres adapters, one conformance suite); the
  Postgres `v2` schema (migration `20261102T0507_v2_record_core`). The scale check
  (`ATLAS_SCALE_TESTS=1`, 20k events) is flat: 50-event append ≈8 ms, 500-event ranged read
  ≈18 ms at both ends, index scan on `(threadId, seq)`.
- **Done:** slice 2, the `agent` package ([spec](slices/02-agent.md); PRs #1696, #1702 and the exit PR).
  `packages/agent` holds the loop, intake, retries and dispatcher; `harness` re-exports it. Prompt
  fragment groups replaced `ctx.agent`; `./testing` ships in-memory record, intake, scripted model and
  fake tools; six exit tests run the loop with no pod, lease or filesystem. v1 unchanged.
  Follow-up PR: supersede a thinking-only request (spec section), behind a setting.
- **Decided 2026-11-02: D8, [0021](../decisions/0021-v2-loop-runs-on-the-agent-host.md).** The agent
  loop runs on a long-lived agent host (Render, Virginia; a separate `apps/agent-host` service
  in the Comp AI Render workspace, confirmed by the operator); sandboxes stay on Vercel Sandbox and
  only execute, through a small in-sandbox daemon over one persistent WebSocket (measured
  3.6-6.5 ms p50 per call).
- **Decided 2026-11-02: [0022](../decisions/0022-v2-background-jobs-in-apps-trigger.md).** v2 background
  jobs and schedules run on trigger.dev in their own `apps/trigger` (own deploy, keys and trigger.dev
  project; contracts in `packages/jobs`), never as timers in the agent host. Built when v2 first needs
  a job, after the reconciler. v1's `apps/api/src/trigger/` takes fixes only and retires at slice 10.
- **Done 2026-11-07: [0026](../decisions/0026-v2-hosts-pull-sessions.md), hosts pull sessions.** PRs #1949,
  #1953, #1965, #1969, #1968 and #1975. Each host runs one `SKIP LOCKED` claim loop (doorbell plus a 20 s
  tick, woken at the earliest `retryAfter`); retry state lives on the lease row; a held session is one scope
  (`runHeld`) whose only lease release is `settle`; a session that crashes its host 5 times shows the failed
  state until the next message. Fault rows F28, F29, F34, F36 and F37 cover it. Verified live on prod
  2026-11-07: a broken sandbox fails in 3 s and recovers on the next message, a restart mid-tool hands the
  turn over in ~2 s with the tool run once, a session parked for 6.6 h resumes in ~2 s, and a failed setup
  script continues with the model told. A hard kill of the host could not be tried live: Render exposes no
  kill and no shell, and its suspend freezes the instance rather than killing it
  ([live-exit-tests](research/slice-3/live-exit-tests.md)). Audit steps 4–5 landed 2026-11-08: deadlines at
  the daemon ready wait, `sandbox.wake()`, the drain and the LISTEN connection (#2016), and a per-turn
  progress watchdog that records `run-failed{kind:'stalled'}` after 11 minutes of silence (#2019). Still
  open from the audit: a Stop API route, crash-loop quarantine and the fault-rig invariant.
- **Done: slice 3, the agent host and the sandbox daemon (0021).** Spec:
  [slices/03-agent-host.md](slices/03-agent-host.md); PRs #1735 to #1846. Render Virginia → Vercel `iad1`
  RTT was measured first ([research/d8/rtt-render.md](research/d8/rtt-render.md): 5–20 ms p50 per tool
  call, Postgres 5.5 ms). The toggle is per session with a `v2` badge. What it delivered:
  - A runnable agent host (`apps/agent-host`, Render) and sandbox daemon (`apps/daemon`); the lease
    holder runs the loop, appends hash-chained events to Postgres and survives a restart: retry
    deadlines, hook decisions and tool results are recorded, so a new holder resumes the turn.
  - A fault rig and the fault rows F1–F21 against real processes; rows that cannot fit in about 20 s
    run when `ATLAS_FAULT_TESTS=1`, which the nightly sets.
  - Large payloads: tool inputs and outputs spill to content-addressed blobs in the append
    transaction; the API pages events under a byte budget and returns an oversized single event as a
    marker; branch observation from the sandbox's git refs is logged as `branches-observed`.
  - A new session is prepared (clone, setup script) before its first turn, and a failed setup is a
    status with a reason (`setup-failed`), not a log line.
  - Wakes are Postgres `LISTEN`/`NOTIFY`, and the host has no polling timers; an idle session stays
    parked across an agent-host deploy.
  - **Live numbers (2026-11-04, production, the atlas repo).** New session: create to workspace
    prepared 26 s (sandbox and daemon about 6 s, clone and `bun install` about 20 s). Then a warm
    wake: the first message reached `user-said` in 66 ms, a bash call took 65 ms, and the reply came
    3.4 s after posting. Before prepare-before-first-turn, a cold first turn took 3438 ms to
    `user-said` and 19.9 s in total. Parked wake (sandbox parked, no holder): post to `user-said`
    3.0 s (claim and config), the model ran while the sandbox resumed, its first bash call waited
    2.8 s for the daemon and took 0.23 s, and the reply came 8.9 s after posting. The first parked
    measurement, 9.0 s to `user-said`, had exposed a turn waiting for the sandbox (#1841).
  - **Live exit tests (2026-11-05, production, two Render instances):**
    [research/slice-3/live-exit-tests.md](research/slice-3/live-exit-tests.md). Pass: 8 (append p99 237 ms),
    10 (claim 118 ms and first step 2.7 s at 20k events), F10, F11, F19, F21, and a deploy mid-turn with a
    stream client (going-away, close 1001, resume by cursor, no gap or duplicate). Under the hog the daemon
    answered in ≤ 1 ms and a stop landed in about 220 ms.
  - The first live run failed test 9, F12 and F18 and found two more bugs (keep-alive never renewed a
    sandbox; status stuck on `thinking`). Fixed in #1889 to #1893: the bash result names an OOM kill; the
    host starts without the `dotenvx run` wrapper (it SIGKILLed the drain) and drains once; a stopped sandbox
    is re-woken while held and a side-effecting call never reruns on a new boot. 9, F12 and F18 then passed
    live. An interrupted result also kept a stale `Exit code: 1` `modelText` (#1897 drops it). F9 is now "Redis down:
    unaffected", since no wake path uses Redis. Continue from [handoffs/slice-4.md](handoffs/slice-4.md).
- **Decided 2026-11-04, slice 3:** wakes move from Redis pub/sub to Postgres `LISTEN`/`NOTIFY`
  ([0021](../decisions/0021-v2-loop-runs-on-the-agent-host.md) amended); the agent host polls nothing,
  and one reactive reconcile loop per held session replaces the inbox, stop and idle polls; a session is
  prepared before its first turn; v1 and v2 share no logic: v1 has its own copy of the loop
  (`packages/agent-v1`), `packages/agent` is v2-only, a lint guard (`scripts/check-package-split.ts`)
  rejects imports across the split, and v1 is deleted at cutover.
- **Slice 3 spec settled (2026-11-02 and 2026-11-03), in [slices/03-agent-host.md](slices/03-agent-host.md):**
  oversize single events against the 4 MB body cap (point 12); the per-session `engine: v2` flag and
  who sees it (point 9); v1's API stays the only writer of users, projects, credentials and settings
  until cutover (point 2); the sandbox disk is one session, threads keep a subdirectory (point 7); branch
  and PR tracking from the git refs of the sandbox's clones, with the session view every local branch
  except the default (point 11); appends to the CP within ~1 s (point 4, measured by exit test 8, still
  to run live); the agent-host service shape and the `pod` package rename (point 1); the RTT measurement
  first (Measurements).
  Carried forward:
  **Slice 5 exit gains:** opening a session active a moment ago shows its latest event within ~1 s,
  cold and warm cache (clients open from the CP tail plus a cache keyed by (epoch, seq), then follow
  the stream; the agent host is never on the open path). **Slice 9:** local sandboxes clone, never bind-mount
  the operator's checkout.
- **Design added 2026-11-03, read before specifying slices 3 and 6:**
  [slices/summarise-at-message.md](slices/summarise-at-message.md) (summarise up to a
  message as an inbox command; decided 2026-11-03: prefix only, a rewind may undo a summary, and a
  refused inbox command appends `input-refused{inboxId, reason}`).
- **Design added 2026-11-06:** [slices/holder-checkpoints.md](slices/holder-checkpoints.md)
  (architecture §12 L3 for the agent host: per-step loop and holder state as checkpoints advanced on
  append, rebuilt only on history edits; follows #1956).
- **Scale target:** ~20k events per thread, from production data (architecture §12). Earlier 1M
  figures were a hypothetical stress size; whole-log work is removed only where that is trivial.
- **Design added 2026-11-06: [slices/media-urls.md](slices/media-urls.md).** Images live once in a
  private Vercel Blob store; events carry a `MediaRef`, and the agent host sends each model a
  signed URL from one shared 6-day signing window. Spike: [research/image-urls/](research/image-urls/README.md).
  Slices A (foundation and URL requests), B (v2 web composer images), C (images the agent reads).
- **Added 2026-11-07: every model provider in the agent host.** The session runs on the selected
  `model.id` (project over user) on Anthropic (key or Claude OAuth), OpenAI (key or ChatGPT OAuth),
  OpenRouter, Vercel AI Gateway and Inference.net (`apps/agent-host/src/model/providers/`). A model
  whose provider has no account is a `configured: false` gap, never a silent switch to another model.
- **Open:** browsing the files of a parked sandbox (a workspace mirror kept by the control plane) is
  proposed, not scheduled. D2 (local control plane), needed only at slice 9. 0020 (sub-agent worktrees, peer
  sessions) proposed; teammates survive as the peer-session preset — placement, ownership and
  conversation separated, the operator owning and archiving — settled in
  [slices/03-teammates.md](slices/03-teammates.md) (a design section, not a build slice).
- **Needs triage:** credential availability (truthful waiting for a dead or exhausted model
  account, operator recheck/pause, explicit recovery). v1 slices 1–4A are merged and 4B is built
  but unmerged; whether v2 adopts that design or rebuilds it is undecided. See
  [research/credential-availability/](research/credential-availability/README.md).
- **v1 fixes found while doing v2** (shipped separately): #1649 append-fork reconcile; #1651
  fault-killed sub-agents end once; #1653 sub-agent session-index race (a sibling's mirror write
  could put a sub-agent in an empty session); #1657 keeps atlas-serve out of the OOM killer's path and
  ahead of workloads on CPU (the v1 half of architecture §11; measured in
  [pod-saturation](research/pod-saturation.md)). The fork bomb, which wedged a pod, is fixed by
  the `atlas-serve` / `atlas-work` cgroup split with `pids.max` and a box per workload (§11 R2;
  shipped in #1684).
  Measured since: `+memory` also delegates once the root is empty (`memory.max` contains a hog),
  `cgroup.kill` catches setsid escapees, and the split does not survive snapshot/resume, so it must
  be applied on every boot ([pod-saturation](research/pod-saturation.md) scenario 5).
- **Design added 2026-11-02, read before specifying slices 3, 4, 6 and 7:** architecture §14
  (archive is read-only and enforced by the CP; archived sandboxes are deleted after 7 days with no
  unsaved-work guard; auto-archive after 72 h idle, pinned exempt; sandbox idle stop 5–10 min,
  measured in slice 3). v1 gets the 7-day deletion now as a daily sweep.
- **Design added 2026-11-02, read before specifying slices 1, 3, 4 and 5:** architecture §12 (a
  long thread, ~20k events, runs smoothly: ranged reads only, materialized current state, artifacts out of line,
  tail-first clients; evidence [log-scale](research/log-scale.md)) and §13 (the lease is liveness;
  one reconciler per session; the Kubernetes patterns v2 follows).

## Slices

| #   | Slice                                                               | Goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | State       |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0   | Design and records                                                  | Lock the decisions; write the design docs                                                                                                                                                                                                                                                                                                                                                                                                                                         | 0018, 0019 and these docs merged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Done        |
| 1   | Record core                                                         | Pure log/inbox/lease/history rules in `core`; the `control` package with a Postgres adapter over `namespace v2`                                                                                                                                                                                                                                                                                                                                                                   | Property tests pass for the seq-466 interleaving, stale-epoch writes, hash mismatch and append-only rewind; the v2 schema migrates cleanly beside v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Done        |
| 2   | `agent` package                                                     | Extract the loop (turn runner, retries, intake, tool dispatch, model port) from `harness` into `packages/agent`; v1 imports it                                                                                                                                                                                                                                                                                                                                                    | `harness` re-exports or imports `agent`; no v1 behaviour change; the loop runs in a test with no pod, lease or filesystem store                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Done        |
| 2b  | Tracing ([spec](slices/02b-trace.md))                               | `TracePort` in `observability`, PostHog export, spans on the loop's model calls, tools, hooks, intake and record                                                                                                                                                                                                                                                                                                                                                                  | A scripted turn yields a nested span tree; spans reach PostHog with names, ids and counts only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done        |
| 3   | Agent host + sandbox daemon (cloud)                                 | The agent host holds the lease, runs `agent`, appends hash-chained events to the CP, consumes the inbox; the sandbox daemon executes (exec, files, grep, shells, services, MCP, terminal) over one persistent WebSocket; v2 agent host ⇄ CP and agent host ⇄ daemon schemas in `protocol`; v2 API namespace                                                                                                                                                                       | The Render Virginia → Vercel `iad1` RTT is measured (0021); a scripted multi-turn session with tools runs through the daemon; killing an agent host mid-model-stream and mid-tool hands the turn to another agent host, which finishes it with no tool run twice; an agent host killed mid-bash leaves the call running and the next holder collects its result; a hook decision and a retry backoff survive a restart; a second writer at the same seq is rejected; append latency stays ~1 s; under a CPU and memory hog the lease never lapses, stop lands, and the watchdog kills the hog, not the daemon (architecture §11) | Done        |
| 4   | Views ([spec](slices/04-views.md))                                  | Status, the context meter (`contextMeterOf` in `core/src/record/context-meter.ts`, already written), session spend (every call, rewound or not), the session's checkout set (every thread's branch and worktree, 0020) and PR links with v1's PR state and checks are folds in `core`, materialized by the CP at a log position; a failed start shows its reason and a Retry action                                                                                               | Every field v1 clients derive by heuristic is a view or shown as unknown; the incident's branch and PR link appear from the log alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Done        |
| 5   | Client SDK, web and Mac                                             | `packages/client` session stream, view cache and inbox commands; web and Mac open v2 sessions behind the `engine: v2` flag                                                                                                                                                                                                                                                                                                                                                        | **First milestone:** a real cloud session on v2 from the web, with basic chat and tools, resumable after the stream drops and after a park                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Done        |
| 6   | `plugin-sdk` and `commands` ([spec](slices/06-commands.md))         | The type-level event registry and plugin contract; the `commands` package and the `commands/` root; rewind, summarise and rename as inbox commands, presented as message actions and a sidebar pencil on web and as slash commands in the TUI                                                                                                                                                                                                                                     | A capability declared once serves both presentations without a second implementation; a plugin's event body is typed without editing `core`, proven by a fixture plugin that uses every slot                                                                                                                                                                                                                                                                                                                                                                                                                                     | Done        |
| 7   | Plugins, one at a time ([spec](slices/07-plugins.md))               | Move crew (sub-agents carry the worktree tools but never subscribe), shells and services, subscriptions and GitHub, memory, previews into `plugins/`; add sessions (`spawn_session`, `message_session`, `list_sessions`) in place of nested teammates (0020). One spec each                                                                                                                                                                                                       | Each plugin runs on v2 with all its slots registered; no plugin imports another                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Done        |
| 7b  | MCP and skills ([spec](slices/07b-mcp-skills.md))                   | The two v1 capabilities no v2 session has: `plugins/mcp` starts the operator's MCP servers in the sandbox, exposes their tools as `mcp__<server>__<tool>` with v1's effects and their own `instructions`, and shows a `mcp` view; `plugins/skills` lists the repo's, the cloud's and the built-in skills in the prompt and loads one by name. Config comes from the cloud rows the host unseals over its own Postgres and from the files the clone carries, with v1's precedence. | One live v2 cloud session lists and loads a repo skill, a cloud skill and a built-in; one starts a stdio MCP server, calls one of its tools, receives its instructions, and shows `failed` with the tools gone after the server is killed; a disabled entry hides the name it repeats; with both plugins unregistered every app behaves as today                                                                                                                                                                                                                                                                                 | Done        |
| 7c  | Native tools v2 lacks ([spec](slices/07c-native-tools.md))          | The v1 tools no slice owns, decided one at a time: port `web_search`, `web_fetch` and `browser` into `plugins/web`, and `task_write`, the checklist the host prompt already advertises with no tool behind it. `operator_input`/`operator_shell_input`, `cloud_config` and `execution_location` are recorded as not ported, each with the reason.                                                                                                                                 | A live session searches, fetches a page as markdown with a pattern, drives the baked Chrome, and opens a checklist that comes back in the next prompt; every v1 tool name is accounted for as ported, already in v2, or not ported with evidence                                                                                                                                                                                                                                                                                                                                                                                 | In progress |
| 7d  | MCP sign-in from the transcript ([spec](slices/07d-mcp-sign-in.md)) | A session that finds an MCP server needing a sign-in hands back a link that finishes it, for a cloud row and for a server only the repo names; the host owns the flow (discovery, registration, PKCE, callback, sealed grant), and a grant that expires is refreshed without the operator.                                                                                                                                                                                        | A live session starts a sign-in from a tool result, the operator approves, and the next turn's roster shows the server connected with its tools; a repo-only entry does the same; no token reaches the transcript, the events or the sandbox.                                                                                                                                                                                                                                                                                                                                                                                    | Not started |
| 8   | Hardening and daily use                                             | Use v2 for the maintainer's own cloud work and close the gaps, including the unread dot (a per-session read marker, deferred from slice 4)                                                                                                                                                                                                                                                                                                                                        | A defined period of daily work on v2 with no manual repair of a session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Not started |
| 9   | Local                                                               | A docker pod against a control plane; then `atlasd` (D2) over SQLite; then the TUI on v2                                                                                                                                                                                                                                                                                                                                                                                          | A local session runs on v2 from Mac and the TUI, offline, in exactly one control plane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Not started |
| 10  | v1 retirement                                                       | Remove v1 once v2 has proven itself                                                                                                                                                                                                                                                                                                                                                                                                                                               | The maintainer decides; cutover moves everything to v2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Not started |

Notes:
- Slices 1 and 2 are independent and may swap order; slice 3 needs both.
- Slice 7 is one spec and usually one session per plugin.
- The exit criteria are the bar for calling a slice done; a spec may add stricter ones.
