# Slice 7c spec: the v1 tools v2 still lacks

Status: **spec, 2026-11-09.** Written after slice 7 closed all six plugins and slice 7b took MCP and
skills. Anchors are `path:line` at `f480c5771`; re-check before relying on one. Prior slices:
[07-plugins.md](07-plugins.md), [07b-mcp-skills.md](07b-mcp-skills.md).

Contract: [architecture.md](../architecture.md) §4 P8, [0019](../decisions/0019-v2-package-map.md),
[0027](../decisions/0027-both-backends-own-their-work.md) (the host reads its own Postgres and calls
the API for nothing).

## Goal

Close the tool gap between v1 and v2 for the tools no slice owns, deciding each one on evidence
rather than porting everything v1 has. A v2 session should be able to do the research and the
bookkeeping work a v1 session does today, and the spec should say plainly which v1 tools v2 will
never have and why.

**Exit criterion:**
1. A live v2 cloud session searches the web, fetches a page as markdown, filters it by pattern, and
   drives the baked Chrome through `browser`; and it opens a `task_write` checklist that comes back
   in the next prompt. Recorded in §8 with the session id.
2. Every v1 tool name is accounted for in §1.1 as ported, already in v2, or not ported with a
   reason — checked by diffing the v1 registry against v2's tool declarations.
3. With `plugins/web` unregistered and the plan tool absent, every app behaves exactly as today.

## 1. What exists today

### 1.1 The verified gap

I re-checked the gap by listing v1's real tool names (`readonly name` in
`packages/harness/src/tools/builtin/*.ts`) and grepping each for a v2 declaration. Two rows of the
brief I was handed were not tools at all, and two real tools were missing from it:

| v1 tool                                               | v2 today                                                  | Verdict                                    |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `web_search` (`web-search.ts:32`)                     | none                                                      | port → `plugins/web` (§2.1)                |
| `web_fetch` (`web-fetch.ts:95`)                       | none                                                      | port → `plugins/web` (§2.2)                |
| `browser` (`browser.ts:101`)                          | none                                                      | port → `plugins/web` (§3)                  |
| `task_write` (`packages/core/src/plan/plan.ts:9`)     | the prompt advertises it, no tool exists (§4.1)           | port → a core tool (§4)                    |
| `operator_input` (`operator-input.ts:23`)             | none                                                      | **not ported** (§5)                        |
| `operator_shell_input` (`operator-shell-input.ts:21`) | none                                                      | **not ported** (§5)                        |
| `cloud_config` (`cloud-config.ts:26`)                 | none                                                      | **not ported** (§6)                        |
| `execution_location` (`execution-location.ts:37`)     | none                                                      | **not ported**: v2 has one location (§7.3) |
| `worktree_adopt` (named in the brief)                 | no such v1 tool exists; `enter_worktree` adopts by `path` | **nothing to port** (§7.1)                 |
| `agent_tokens` (named in the brief)                   | `agent-tokens.ts` is two DI tokens, not a tool            | **nothing to port** (§7.2)                 |

Already in v2, so out of scope: `bash edit multi_edit read write glob grep` (core tools,
`apps/agent-host/src/runtime/tools.ts:90-98`), `shell_list/output/kill/input` (`plugins/shells`),
`service_*` (`plugins/services`), the four `*_memory` tools (`plugins/memory`), `agent_spawn/say/stop/
list`, `report_to_main`, `enter_worktree/exit_worktree/worktree_list` (`plugins/crew`),
`subscribe/unsubscribe/list_subscriptions` (`plugins/github/src/pod/tools.ts:39`, `:85`, `:113`).
`mcp-edit` and `skill_install` belong to slice 7b, which deliberately leaves `mcp-edit` out.

### 1.2 v1 behaviour being reproduced

- **`web_search`** takes `{query, count ≤ 20, default 8}`, asks one backend and renders the findings
  (`web-search.ts:11-67`). Seven backends live in `packages/harness/src/web/backends/`: Bing and
  DuckDuckGo scrape HTML with `htmlparser2`, Jina needs no key, and Tavily/Exa/Brave/SearXNG read a
  key named `secretNameOf(backend)` — the prefix is `search.`
  (`packages/harness/src/web/search.ts:94-96`). The backend is the `ESettingId.WebSearchBackend`
  setting, fallback Bing because it answers with no account at all
  (`packages/core/src/settings/registry.ts:465-472`).
- **`web_fetch`** takes `{url, format: markdown|text|html, pattern?, timeout ≤ 120, default 30}`,
  follows up to 10 redirects, caps the body at 25 MB and 120 000 characters
  (`packages/harness/src/web/fetch-page.ts:16-24`), converts HTML with `turndown` +
  `htmlparser2` (`web/extract.ts:1-2`), reads a pdf with `pdfjs-dist`'s legacy build (`web/pdf.ts:6`),
  caches non-file pages per `{url, format}` (`web/cache.ts`), saves an image or binary beside the
  session, and wraps anything from the web in `untrustedEnvelope` (`web-fetch.ts:190-215`).
- **`browser`** runs `agent-browser --session atlas-<threadId> <args>` as a child process, refuses a
  caller-supplied `--session`, truncates stdout to 16 000 + 4 000 characters and wraps the page in
  the untrusted envelope (`browser.ts:94-193`).
- **`task_write`** is a plan of at most 40 tasks of at most 120 characters, each
  `pending | in_progress | completed` (`packages/core/src/plan/plan.ts:5-30`); v1 mirrors the plan
  back through an after-tool hook so the model sees its own checklist
  (`packages/harness/src/hooks/mirror-plan.ts:12-29`).

### 1.3 The v2 seams that already exist

- **`PluginPodContext.call(op)`** hands a pod tool the daemon's whole op surface —
  `exec` with `argv`, `cwd`, `env`, `timeoutMs` and a streamed `onOutput`
  (`packages/protocol/src/ops/exec.ts:13-22`), the file ops, git and sessions
  (`packages/plugin-sdk/src/slots.ts:47-62`). A tool that shells out needs no new op.
- **`PodControl`** is the plugin's one door to the host (`packages/plugin-sdk/src/slots.ts:42-45`):
  `exposePort` and `memory` today, implemented by `podControlOf`
  (`packages/host/src/holder/pod-control.ts:13-35`) over `PodControlClient`, which the agent host
  answers in-process (`apps/agent-host/src/control/local-pod-control.ts:42`).
- **The host reads the operator's rows itself and unseals secrets with its own cipher**:
  `modelSettings` reads `UserSetting` then falls back through `ProjectSetting`
  (`apps/agent-host/src/config/config-reader.ts:124-140`), and `SecretCipher`
  (`apps/agent-host/src/config/secret-cipher.ts:15`) already opens model keys and GitHub tokens.
- **The sandbox image bakes `agent-browser` on `PATH`** with headless chromium already installed, and
  the build proves it runs (`apps/serve/sandbox-image/Dockerfile:170-185`); the v2 sandbox is that
  image (`apps/agent-host/src/host/runtime.module.ts:41-48`).
- **The plan types are in `core` and the prompt already promises the tool.** `TaskListFragment` is
  registered in the host's prompt (`apps/agent-host/src/runtime/prompt.ts:38`); `planInputSchema`,
  `planTasks` and `planReminder` are exported (`packages/core/src/plan/plan.ts:5-66`).

**No v2 code imports v1.** The search backends, the page fetch and the extractors are copied into the
plugin as v2-owned code; `scripts/check-package-split.ts` enforces the rule.

## 2. `plugins/web`: search and fetch

One package, `transport: 'none'`, no events, no view, no control hook — the web lane is a set of pod
tools and nothing else. Registered in `apps/agent-host/src/registered-plugins.ts`.

### 2.1 `web_search`

Input and output are v1's, unchanged, so a model moving between the two harnesses sees one tool.
The backend and its key are the only configuration, and they come from the operator's rows:

| What    | Row                                                             | Read by                                |
| ------- | --------------------------------------------------------------- | -------------------------------------- |
| backend | `UserSetting` / `ProjectSetting`, `ESettingId.WebSearchBackend` | the host, `secret-cipher`-free         |
| key     | `UserSecret` / `ProjectSecret` named `search.<backend>`         | the host, unsealed with `SecretCipher` |

The seam is one narrow addition to `PodControl` — `webSearch(): Promise<{ backend, key }>` — answered
by the host exactly where memory already is (§1.3). Narrow on purpose: a general "read any secret"
port would let any tool in the pod open the operator's account. An unknown or absent key is the
backend's own error, surfaced as a failed tool result, never a silent switch to another backend —
the same rule the model providers follow.

### 2.2 `web_fetch`

`fetchPage`, `extract`, `pdf`, `cache` and the envelope rendering are copied from v1 into
`plugins/web/src/pod/`, with `turndown`, `htmlparser2` and `pdfjs-dist` declared by the plugin. The
tool runs **in the host**, not in the sandbox: the host has egress to the internet, and a pod-only
fetch would have to invent a daemon op for HTTP.

One behaviour changes, and it is named rather than hidden: **a non-text body is not saved beside the
session.** v1 writes an image or a zip into the session's downloads directory; a host-side tool has no
workspace to write to, and the daemon's `writeFile` op takes a `string`, not bytes
(`packages/protocol/src/ops/files.ts:24-31`). The tool returns the content type, the byte count and
the final URL, and tells the model to fetch the file with `bash` + `curl -o` when it wants the bytes
in the pod. Adding a bytes write op to the protocol for this one case is not worth it; if large-file
work becomes common it is a daemon change, not a tool change.

## 3. `browser`

Ported into the same package as a pod tool over `exec`: one call is
`agent-browser --session atlas-<sessionId> batch "<command>" … "close"`, the session id comes from
`PluginPodContext`, the page comes back wrapped in the untrusted envelope with v1's truncation, and
each call defaults to a 120 s timeout capped at 600 s.

Chrome cannot persist between calls. Every exec runs in its own cgroup box
(`apps/daemon/src/ops/exec/index.ts:31-32`) and `killWorkloadBox` kills that box when the exec exits
(`packages/sandbox/src/workload-cgroups.ts:169-180`), so the long-lived browser daemon `agent-browser`
forks dies with the call that launched it: a later call with the same `--session` silently launches a
fresh Chrome and answers `about:blank`, with no error. A shared browser daemon outside the exec box
would be the only way to reuse one, which is a daemon change, not a tool change. So the input is
`commands` — the script one call runs, through `batch`, against a single browser — the tool appends
`close`, and a call costs a Chrome launch of roughly half a second.

Two v1 details change for v2's shape:
- The tool always passes `--session`, so a browser is per session, and a caller's own `--session` flag
  inside a command is still refused.
- The tool reports the missing binary as a failed call rather than a crash: the image bakes it, but a
  session in an older image must be told, not broken.
- A failed step reports the exit status, the script that ran, and everything the binary printed;
  the daemon merges stdout and stderr onto one channel, so the two arrive interleaved.

`browser` is `Destructive` and not concurrency-safe, as in v1: two calls driving one browser at once
interleave.

## 4. `task_write`, the tool the prompt already promises

### 4.1 The defect this closes

The host's prompt fragment says "task_write keeps a checklist beside the conversation that the
developer can watch" (`apps/agent-host/src/runtime/prompt-fragments/plan.ts:5-13`) and it is
registered at `apps/agent-host/src/runtime/prompt.ts:38`. **No v2 tool is called `task_write`**: the
only registrations are core's constants and v1's hook
(`packages/harness/src/hooks/mirror-plan.ts`). So every v2 session is told to keep a checklist it
cannot write, and `planFromEvents` (`packages/core/src/plan/from-events.ts:15-20`), which folds a plan
out of `task_write` tool results, has no v2 producer.

### 4.2 The change

The tool is a core tool in `apps/agent-host/src/runtime/tools.ts`, beside the seven daemon tools — no
config, no daemon op, no plugin: it writes nothing outside the event log, and a package per tool with
no slots would be ceremony. It uses `planInputSchema` and returns v1's rendering of the plan; the
mirror comes from an `afterTool` hook in the host's hook chain that appends `planReminder(tasks)` as
additional context for the next step, which is v1's behaviour copied, not imported.

The visible surface stays what it is today: the checklist appears as a tool call in the transcript.
A dedicated plan panel in web is **out of scope** — the plan fold in core is wired to no v2 surface
(§1.1), and adding one is a view change (core version bump, wire schema, web panel) that belongs with
slice 8's daily-use work.

## 5. `operator_input` and `operator_shell_input` — not ported

**Verdict: v2 does not port these, because the seam they need does not exist and the situation they
serve does not occur in v2 yet.**

What they do in v1 is block a tool call until a human pastes a value: into a file, or into a running
shell's stdin (`operator-input.ts:41-80`, `operator-shell-input.ts:41-77`). The only real use is an
interactive CLI login on the operator's own machine — `gh auth login`, a device code, a Docker
registry — where the operator can open a URL and paste a code back.

In v2 none of that holds:
1. **There is no path for a human answer into a running tool call.** The operator's words reach a
   session as `INBOX_KIND_MESSAGE` entries that `InboxIntake.prepare` turns into `user-said` events
   between steps (`packages/host/src/holder/inbox-intake.ts:67-95`); a tool that is mid-call cannot
   see them, and there is no inbox kind for a question, no event to render it and no web card to
   answer it.
2. **The shells it types into are in the pod.** `requirements` in the sandbox are not the operator's
   terminal, and v2 has no TUI (slice 9).
3. **Credentials arrive the way v2 already does it:** the host holds the cipher, model keys and
   GitHub tokens, and a login that needs a human is a flow Atlas builds (Vercel OAuth is the model),
   not a paste into a shell.

If slice 8 finds a real need — a session that must ask "which account?" and cannot proceed — the
honest build is a seam, not these two tools: a `PodControl.elicit({question, url})` that appends a
`question-asked` event, a web card that posts an answer as a new inbox kind, and an intake that
resolves the waiting call. That is a feature with a surface; it is deliberately not smuggled into
this slice.

## 6. `cloud_config` — not ported

**Verdict: v2 will never have a `cloud_config` tool. Settings stay the operator's surface and the
session reads what it needs.**

v1's tool is a read/write API client for five kinds of operator state — setting, secret, mcp, file,
skill — over the v1 tRPC client (`cloud-config.ts:26-55`, `cloud-config-run.ts:76-288`). Porting it
would mean:
1. **A session writing the operator's account.** v2's design gives a session no authority over
   `UserSetting`, `UserSecret`, `McpServer`, `ProjectFileMount` or `Skill` rows; the host reads rows it
   needs and writes only what a plugin owns (memory, session state). v1's tool was an API client for
   the same reason it existed at all: the pod had a user token. A v2 cloud pod has none, and 0027
   exists to keep it that way.
2. **Two writers for one piece of state.** Every kind it manages already has an owner: `plugins/mcp`
   reads `McpServer`, `plugins/skills` owns `Skill`/`SkillFile` writes (slice 7b §5.3), file mounts
   are what the sandbox boots with, and secrets are the operator's rows. Adding a second writer from
   inside a session is the drift the redesign removes.
3. **No gap in what the session can do.** Its own description says the writes take effect on the next
   sandbox start or the next turn (`cloud-config.ts:44-47`) — it configures _other_ sessions. The
   operator does that in Settings, which writes the same rows, and `plugins/web` (§2.1) is the only
   new reader.

What v2 loses, stated plainly: **a session can no longer set the operator's secrets or settings
while you are in it.** If that turns out to matter in daily use, the narrow version is a
`PodControl.config` write for one key at a time, with the Settings page still the full surface — a
slice 8 decision, not a tool to port.

## 7. The three names that are not a gap

### 7.1 `worktree_adopt`

v1 has no tool of that name: `worktree-adopt.ts` is the helper v1's `enter_worktree` calls when it is
given a `path` (`worktree-adopt.ts:75-119`). v2's `enter_worktree` already takes `path`, and its
description already promises adopt semantics — the branch, the upstream and what is uncommitted
(`plugins/crew/src/pod/enter-worktree.ts:16-32`). Nothing to add.

### 7.2 `agent_tokens`

`agent-tokens.ts` is eleven lines and contains no tool: two `InjectionToken`s for v1's container
(`AgentRegistrySourceToken`, `AgentTypesToken`). Sub-agent token accounting in v2 is the crew view's
and the spend view's business, already built.

### 7.3 `execution_location`

v1's tool moves a session between the host machine and a Docker container
(`execution-location.ts:37-46`). A v2 session has exactly one execution location — its cloud pod —
and slice 9's local pod is a different placement, not a switch inside a session. Not ported.

## 8. Order, packaging and the PR sequence

| PR  | Contents                                                                                                                                     | Proves                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | this spec, the roadmap row and the Current state bullet                                                                                      | the verdicts are written down before anything is built                                                                                                                           |
| 2   | `plugins/web`: `web_search`, `web_fetch`, `browser`, the package shape, registration, and the `PodControl.webSearch` read — **built**, #2116 | a page reads as markdown, a pattern narrows it, an image reports instead of saving, the operator's backend and key are honoured, and the baked Chrome answers two calls in a row |
| 3   | `task_write` in the host's core tools + the mirror hook                                                                                      | a checklist round-trips into the next prompt and the plan folds out of the log                                                                                                   |

The three web tools shipped as one package and one PR: they share the untrusted envelope and the
operator's configuration, and a package per tool would have been ceremony. `task_write` is
independent of them. Live checks follow slice 7's practice: a fresh session, never one created
during a deploy, recorded here with its session id.

**Live check (fill in as each PR merges):**
- [ ] `plugins/web` fetch + browser —
- [ ] `web_search` —
- [ ] `task_write` —

## 9. Test plan

- **Unit, no network:** `web_fetch` formats and patterns over fixture bodies (HTML → markdown, a pdf,
  a binary), the 25 MB and 120 000-character ceilings, redirect handling, the envelope; `web_search`
  backend selection, the `search.<backend>` name, a missing key's message; `browser` argv shape, the
  refused `--session`, truncation.
- **Fake daemon port:** `browser` and the file-format cases go through a `PluginPodContext.call`
  double, so the tool's contract is pinned without a sandbox.
- **Host:** `PodControl.webSearch` reads the project row over the user row, unseals the secret, and
  answers `undefined` for a keyless backend.
- **Plan tool:** a spec that the tool's output is v1's, the 40-task and 120-character limits, and the
  mirror hook producing the reminder for the next step.
- **Live:** §8.

## 10. Out of scope

- **`operator_input` / `operator_shell_input`** and the elicitation seam they would need (§5).
- **`cloud_config`** and any settings write path from a session (§6).
- **Saving binary fetches into the pod** — a bytes write op is a daemon change (§2.2).
- **A plan panel in web**, and the plan as a session-view field (§4.2).
- **`mcp-edit`, `skill_install`** — slice 7b owns them.
- **Fetching through a proxy or from inside the pod.** The tool runs in the host; a pod-local fetch
  needs a daemon op and has no use case yet.

## 11. Open questions for the operator

1. **`cloud_config` is dropped, so a session can no longer set a search key or a secret.** Settings
   writes the same rows and `plugins/web` reads them. Confirm that is acceptable, or name the one
   write you want from inside a session (§6).
2. **`operator_input` waits for a real need.** It comes back only with an elicitation seam and a web
   card (§5), which is slice 8 work. Confirm it stays out.
3. **Binary downloads are the model's job in v2** (`bash curl -o`) instead of being saved beside the
   session (§2.2).
