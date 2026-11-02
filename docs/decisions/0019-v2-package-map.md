# 0019. v2 package map: foundations in `packages/`, plugins and commands in their own roots

Proposed 2026-11-02; accepted when the operator merges the PR that adds it. Amends D5 of [0018](0018-v2-pod-first-architecture.md); replaces the package
list in [docs/v2/architecture.md §7](../v2/architecture.md#7-package-shape).

## Context

0018 fixed the tiers and named five platform packages (`core`, `protocol`, `runtime`, `control`,
`client`) plus feature packages. Two gaps remained. First, the loop that every agent runs (main,
sub-agent, teammate) had no home of its own; it sat inside `runtime` next to pod concerns (leases,
replication). Second, native features and native commands had no place: today the plugin
foundation and the GitHub plugin share `packages/harness/src/plugins` (6.1k lines, 4.7k of them
GitHub), and command logic is split across `packages/core/src/commands` (627 lines),
`apps/web/src/features/threads/commands` (711) and `apps/tui/src/composition/commands` (318), each
surface carrying its own dispatch.

Bun runs TypeScript raw, so a package costs no build step. The maintainer prefers a few large,
cohesive foundation packages, with each feature's code kept in one place where an agent can find it.

## Decision

**Foundations live in `packages/`. Plugins live in a top-level `plugins/`, and native commands in a
top-level `commands/`.**

| Package              | Owns                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`               | Pure shared vocabulary: ids, the event envelope, assembly, and the record rules (log, inbox, lease, history folds). Feature-specific events leave core for their plugin                           |
| `protocol`           | Wire schemas only (today's `wire` without the sandbox provisioning I/O or the ticket HMAC implementation)                                                                                         |
| `agent`              | The loop: turn runner, retries, intake, tool dispatch, model port. Every agent is this loop. It knows nothing about pods, leases or replication                                                   |
| `pod`                | Hosts agents in a pod: holds the lease, keeps the local record cache, replicates, consumes the inbox. This is 0018's `runtime`, renamed so it is not confused with `agent`                        |
| `control`            | The control-plane library, plus storage adapters (Postgres now, SQLite at D2)                                                                                                                     |
| `client`             | The client SDK and headless React hooks shared by web, TUI (OpenTUI is React) and Mac                                                                                                             |
| `plugin-sdk`         | The plugin contract (slots: events, views, commands, settings, tools, hooks, prompts, pod, control, client), the type-level registries, the loader. Native and repo plugins use the same contract |
| `commands`           | The command contract and machinery: spec, argument parsing, registry, dispatch to the pod, the shared command menu and its headless hooks                                                         |
| `settings`           | The settings schema and resolution (pure), plus per-tier subpaths. Plugins contribute keys                                                                                                        |
| `ui`, `db`, `models` | Unchanged                                                                                                                                                                                         |

**`plugins/<name>/`**: one workspace package per native plugin (github, subscriptions, shells,
services, crew, memory, previews, ...). Each has tier subpaths: `/core` (events and pure folds),
`/pod`, `/control`, `/client`. Plugins never import each other; apps compose.

**`commands/`**: one workspace package holding every native session command (new, rename, rewind,
compact, model, help, ...), one folder per command, with files by tier: `spec.ts`, `pod.ts` (the
handler, run in the pod from an inbox command), `client.ts` (headless state and hooks), `web.tsx`
and `tui.tsx` (rendering). Mac renders the web build, so there are two renderers, not three. A
command that belongs to a feature (`/shells`, `/mcp`, `/skills`) lives in that plugin and uses the
same `commands` contract, so it renders and dispatches identically.

**Every command is an inbox command handled in the pod**, so a command works the same on every
client. Only the rendering is per-surface.

## Why

- `agent` separate from `pod` makes "any agent is one loop" true in the dependency graph: the loop
  can be tested and reused without a lease, a pod or a network.
- Splitting the foundation (`plugin-sdk`, `commands`) from implementations (`plugins/`,
  `commands/`) keeps the contract small and stable while features grow, and puts each feature's
  logic, events, handlers and rendering in one folder.
- Commands get their own root because they need rendering and management on two surfaces, which a
  plugin slot alone does not give them. Feature-owned commands stay with their feature so a
  feature has a single home.

## Consequences

- `plugin-sdk` must first solve the hard problem: `EventBody` is a closed union switched
  exhaustively ([core-contract](../core-contract.md), "A row that will not decode"). Moving feature
  events into plugins needs a type-level event registry, like the port registry
  (`packages/core/src/ports/registry.ts`), so exhaustiveness still holds. No plugin moves before
  that registry exists.
- The root `package.json` workspaces gain `plugins/*` and `commands`.
- Extracting `agent` from `harness` is its own slice; v1 imports the extracted package, so there is
  one copy of the loop.
- Tier boundaries inside `commands` and each plugin are enforced by subpath exports plus a
  restricted-import lint rule. Where the compiler can enforce a boundary, it does.
