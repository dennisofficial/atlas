# Handoff: Atlas v2 after slice 7b (MCP and skills)

Written 2026-11-10 at the end of the slice 7b build. Read [`../README.md`](../README.md), then the
[roadmap](../roadmap.md) Current state, then the spec [`../slices/07b-mcp-skills.md`](../slices/07b-mcp-skills.md).
The spec is the plan of record; this document only carries what to do next and what cost time.

## Where things stand

Slice 7b is **built and merged**, not yet live-checked:

| PR    | What                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #2111 | the spec, the roadmap rows, three stale doc corrections                                                                                                                                                                                                                                        |
| #2112 | a plugin's tool set is re-read on every step (`ComposedPodRegistry` takes a supplier; duplicates throw at claim, drop later)                                                                                                                                                                   |
| #2118 | `plugins/mcp` `/core` + `/pod` — config from cloud rows and the clone's json, stdio over the daemon's `mcp.*`, http from the host, `mcp__<server>__<tool>` bridge tools; the daemon now buffers a server's stderr and publishes `mcp.dropped` so an oversized final line cannot hang a request |
| #2121 | `task_write` — the tool every v2 prompt had advertised since slice 3 (it lived in `07c`, not here)                                                                                                                                                                                             |
| #2122 | the `mcp` view, the per-server instructions hook, the `mcp` command, registration                                                                                                                                                                                                              |
| #2119 | `plugins/skills` `/core` + `/pod` — sources, the listing, `skill` load with a `path` form for bundled files                                                                                                                                                                                    |
| #2137 | skills CRUD — `skill_install` / `skill_edit` / `skill_delete`, cloud (revision-checked, written by the host) and repo (through the daemon)                                                                                                                                                     |
| #2138 | MCP wiring — `PluginPodContext.workspaceDirectory`, a session-aware config port, `public.McpServer` rows unsealed with the host's cipher                                                                                                                                                       |

Slice 7c (spec `../slices/07c-native-tools.md`, `plugins/web`, `task_write`) merged in parallel from its
own session and is also waiting on a live check.

## What is left in 7b

### 1. Register `plugins/skills` — the only code left

The package is merged and **not registered**, so a live session has no `skill` tool, no listing and no
writer. `skillsPodOf` (`plugins/skills/src/pod/index.ts`) takes an optional cloud source, an optional
writer and an optional context window; the composition root supplies them.
- Add the entry to `apps/agent-host/src/registered-plugins.ts` beside `mcp` — an import block and one
  `definePlugin`, `transport: 'none'`. The API and web lists never build a `PluginPodContext`; they keep
  `EMPTY_POD`.
- Bind the cloud source and writer from the modules that already exist:
  `apps/agent-host/src/config/skill-body.ts` (`skillBodyOf`, `skillFrontmattersOf`, `skillTextOf`, each
  carrying the revision and hash the writer needs) and `apps/agent-host/src/config/skill-writes.ts` (the
  revision-checked writer, built-in names injected). Follow `mcpServerPort()` in
  `apps/agent-host/src/config/mcp-servers.ts` for the lazy binding — the registration list is a module
  constant while the `Db` lives in Nest DI.
- Prove it with a spec that the registered pod offers the four tools and renders the listing, not merely
  that the modules exist.

### 2. Run the live checks — the slice's actual exit criterion

Nothing in 7b has run in a cloud session. The criteria are in the spec's Goal §1–§3; the access recipe
(minting a temporary `AuthSession`, the GET-vs-POST tRPC verbs, the agent host's `/healthz`, the Render
service and its deploy probe) is the project memory `v2-live-check-production-access`. Do not copy ids,
tokens or connection strings into docs.

Run the stale-instance probe first: post _"list every tool you have, one per line, change nothing"_ to a
fresh session and compare with what the merge should register. A session created before the deploy that
carries the commit lists every plugin's tools except the new one's — open a new session rather than
debugging the plugin (this trap has bitten twice).

Then, in one session: the listing shows a repo skill, a cloud skill and a built-in; `skill` loads each;
`skill_install` → next-turn listing → a stale `skill_edit` refused with the current revision and hash →
`skill_delete`. In another (or the same): a cloud `McpServer` row the operator already owns, or a repo
`.mcp.json` committed to the clone, connects; its tools appear as `mcp__<server>__<tool>`; a call
returns a real result; its `instructions` arrive as an `mcp-instructions` context block; killing the
server flips the roster to `failed` and its tools disappear on the next step. A cloud row cannot be
fabricated by hand — its `sealedSpec` needs the host cipher.

### 3. Close the docs

Record the session ids and what each check showed in the spec's §8, set roadmap row 7b to Done, write a
Current state bullet, and leave 7c at In progress until its own live check runs.

## One known flake, not part of this slice

`packages/host/__tests__/remote-calls-real.spec.ts` → _"fails an in-flight exec as interrupted on
restart, and reruns a read-only op"_ fails intermittently — twice on 2026-11-09/10, green on rerun and
green locally ten times out of ten. It sleeps a fixed 100 ms
(`packages/host/src/testing/remote-calls-lifecycle.ts`, around line 97) before restarting the daemon, so
whether the `stat` is in flight, answered or still queued decides the result. `gh run rerun <run>
--failed` unblocks a PR. The fix is to stop racing — wait for an observable dispatch (the rig's
`runCount`, or a sentinel the exec itself writes) instead of a wall-clock sleep — and it deserves its own
small PR.

## What cost time, so it does not again

- **`bun run typecheck` is not a typecheck.** It reports clean from a stale `.tsbuildinfo` and CI's cold
  `tsc --noEmit` then rejects the branch. Run `bunx tsc --noEmit --incremental false` in every touched
  package; it cost three CI cycles in this slice (project memory
  `package-typecheck-is-incremental-and-hides-errors`).
- **`biome ci .` formats Markdown**, so a docs-only PR can fail `check`. Run
  `bunx @biomejs/biome@2.6.2 check --write <files>` before pushing.
- **Parallel PRs collide in two places**: `bun.lock` (take main's and re-run `bun install`) and
  `apps/agent-host/src/registered-plugins.ts` (keep both entries, never drop one).
- **v2 shares no logic with v1.** `scripts/check-package-split.ts` enforces it, and v2 code cannot import
  `@dltech/atlas-wire` either — copy the few lines it needs.

## What slice 8 inherits

The roadmap's hardening-and-daily-use work (the unread dot, credential availability, the slice 3 audit
leftovers: a Stop route, crash-loop quarantine, the fault-rig invariant), plus these verdicts to live
with, recorded in `../slices/07c-native-tools.md`:
- `cloud_config` never comes to v2 — a session can no longer set a secret or setting mid-session; that is
  Settings now.
- `operator_input` / `operator_shell_input` wait for an elicitation seam (`PodControl.elicit` + a web card
  - an inbox reply kind); a blocking tool call cannot work against an inbox read between steps.
- `ui-design`'s 565 page scans stay unreachable through `skill`: v1 never shipped them either (its
  compiled bundle is 204 KB of text), so a `path` naming a JPEG answers "binary, cannot be read as text".
  If images matter for that skill, the transport is an image part in the tool result.
