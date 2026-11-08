# Slice 6 spec: `plugin-sdk` and `commands`

Status: **done 2026-11-08** (PRs #2002, #2003, #2005, #2006, #2007, #2008; results and the live
check in §10). Anchors were `path:line` at `7005a2a8b`; re-check before relying on one.

## Goal

A capability is declared once and each surface presents it in its own idiom — web uses affordances
on the thing it acts on, the TUI uses slash commands — and a plugin's events are typed without
editing `core`. Slice 6 builds the two foundations the rest of v2 needs, the plugin contract and the
command contract, and ships the first three capabilities on v2: rewind, summarise and rename, which
v1 has and v2 does not.

**Exit criterion** (roadmap row 6, made concrete by the operator's answers):
1. Each capability in `commands/` is declared once — one spec, one argument schema, one inbox kind —
   and no surface reimplements it: web reaches rewind and summarise from the message they act on and
   rename from the session row's pencil, while the TUI reaches all three from a slash command. The
   TUI has no v2 session surface until slice 9, so its leg is proven by a renderer test in this slice
   and wired for real there (§9 A2).
2. A plugin's event is exhaustively typed without editing `core`: a fixture plugin that uses every
   slot merges a body into the event registry, the composed decoder parses it, and every exhaustive
   switch either has a case or fails typecheck (§9 A3).
3. On a real v2 session from the web: rewind from the message action, summarise from the message
   action, rename from the sidebar pencil. Spend holds across the rewind while the context meter
   drops (slice 4's decision, never seen live), and a rewind past a summary brings the messages back.
   A command the pod refuses appends `input-refused{inboxId, reason}` and the web shows the reason.

## 1. What exists today

**v1 command machinery (pure, split by surface).** `ECommand` and `COMMAND_CATALOGUE`
(`packages/core/src/commands/catalogue.ts:4`, `:45`), the surface-facing
`surfaceCommands({ handlers })` (`packages/core/src/commands/surface.ts:21`), text resolution
`resolveSubmission` (`packages/core/src/commands/resolve.ts:37`), argument hints and groups
(`packages/core/src/commands/spec.ts:12`). Each surface dispatches for itself
(`apps/web/src/features/threads/commands/dispatch.ts:27`,
`apps/tui/src/composition/commands/dispatch.ts:39`) and each renders its own menu; the web composer
already accepts the specs as a prop (`apps/web/src/features/threads/thread-composer.tsx:22,37`).

**v2 has no command path at all.** The v2 session view passes `rewind={null}` and `summarise={null}`
(`apps/web/src/features/sessions/session-view.tsx:140-141`), the v2 composer gets no `commandSpecs`,
and `sessions.post` carries only text, media and uploads (`packages/protocol/src/api.ts:21`).

**The sidebar row already has the shape for a pencil.** `RowAction` is the icon button with a
tooltip that v2 rows use for archive (`apps/web/src/features/shell/shell-row-action.tsx:7`, used at
`apps/web/src/features/shell/shell-thread-row-body.tsx:103-115`); a rename action is one more of
those, and the row it edits is a `v2RowOf` value (`apps/web/src/features/shell/v2-rows.ts:32`).

**The inbox is the precedent for a v2 command.** `INBOX_KIND_RETRY`
(`packages/core/src/record/inbox.ts:2`) is posted by `sessions.retry`
(`apps/api/src/api/platform/control/sessions.service.ts:285-287`), consumed by the holder
(`packages/host/src/holder/inbox-intake.ts:37-40`) and closed with `input-consumed{consumed:'discarded'}`
(`:72-84`). An unrecognised kind is consumed with a warning today (`:64-70`) — silently, which is what
a command must stop doing.

**Rewind and summarise exist as record events.** `history-rewound{toSeq}` and
`history-summarised{fromSeq, throughSeq, anchor, summary}` (`packages/core/src/record/event.ts:39-47`),
already handled by visibility (`packages/core/src/record/visibility.ts:19-40`) and linked to the
view's rebuild path by `needsRebuild` (`packages/core/src/record/views/session-view.ts:60`). The
summarise design, settled 2026-11-03, is [summarise-at-message.md](summarise-at-message.md). Nothing
of it is built.

**There is no `input-refused`.** `RecordBody` is the closed union at
`packages/core/src/record/event.ts:39`; its schema is `recordBodySchema` (`:88-114`), its type table
`RECORD_TYPE_TABLE` (`:116-127`), and the decoder that picks between them `bodySchemaFor` (`:136-141`).

**The event union is closed and switched exhaustively.** `EventBody`
(`packages/core/src/events/body.ts:122`), `eventBodySchema` as a static `z.discriminatedUnion`
(`packages/core/src/events/schema.ts:63`), `V2Body` (`packages/core/src/record/event.ts:57`), and
`v2EventSchema` (`:143`) imported as a value by `packages/control/src/parse-append.ts:24`,
`packages/control/src/stored-event.ts:55`, `packages/client/src/stream/session-window.ts:57` and
`apps/web/src/features/sessions/data/indexed-db-session-cache.ts:30`. Exhaustive switches over it:
`packages/client/src/stream/transcript-events.ts:30` and
`packages/host/src/holder/record/record-bookkeeping.ts:33`.

**Title is a control-plane row, not a log event.** `titleUntitledSession`
(`packages/control/src/control-plane.ts:82`) → `titleUntitledIn` (`packages/control/src/session-ops.ts:52-69`)
writes `setSessionTitleIfUntitled` (`packages/control/src/port.ts:126`), and the sidebar reads
`ControlSessionRow.title` (`packages/control/src/port.ts:10`). Nothing can rename a titled session on
v2 today.

**The registry precedent.** Ports register at the type level by declaration merging and
`composeHarness` requires the full manifest, so a missing binding breaks typecheck
(`packages/core/src/ports/registry.ts:42-63`).

**The queued path.** `statusOutputOf` already carries the inbox's pending messages as `queued`
(`packages/control/src/session-view-read.ts:140-149`) through `queuedOf`
(`packages/control/src/queued-messages.ts:17`). A command's pending state and its refusal ride the
same way.

## 2. `packages/plugin-sdk`

Two halves. Both are needed before slice 7 can move a feature out of `core`.

**The type-level event registry.** The interface lives in `core`
(`packages/core/src/events/plugin-registry.ts`), not in `plugin-sdk`, because `plugin-sdk` depends on
`core` and not the other way round — the same placement as `PortRegistryEntries`
(`packages/core/src/ports/registry.ts:42`), which `harness` extends by declaration merging.
`plugin-sdk` re-exports it as the contract-facing type.

```ts
export interface PluginEventBodies {
  readonly __none?: never
}
export type PluginEventBody = NonNullable<
  PluginEventBodies[keyof Omit<PluginEventBodies, '__none'>]
>
```

A plugin merges its own bodies:

```ts
declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'pull-request-checks-changed': PullRequestChecksChanged
  }
}
```

`V2Body` (`packages/core/src/record/event.ts:57`) becomes `EventBody | RecordBody | PluginEventBody`.
Every exhaustive switch keeps compiling or stops compiling for the right reason: `transcript-events.ts:30`
and `record-bookkeeping.ts:33` must gain a case for each new body. `RECORD_ONLY_TYPES` (`:129`) stays
core-only; a plugin body is not a record-only type.

**The runtime decoder.** `createEventBodySchema({ pluginBodies })` composes core's discriminated union
with the registered plugin schemas, and `createV2EventSchema({ pluginBodies })` wraps it exactly as
`v2EventSchema` does today (`event.ts:143-154`). No module-level mutable registry: each composition
root (`apps/api`, `apps/agent-host`, `apps/web`) builds its decoder from the plugins it registers and
passes it in — `ControlPlane` (`packages/control/src/control-plane.ts`), the host's record
(`packages/host/src/holder/record/record-adapter.ts` and its cache/commit siblings) and the client
follower (`packages/client/src/stream/session-window.ts:57`) take it as an optional argument that
defaults to the core-only schema, so v1 call sites are unchanged. A body the decoder does not know is
still one unreadable row, never a failed read (core-contract, "A row that will not decode").

**The plugin contract (architecture P8).** `src/plugin.ts`:

```ts
export type PluginSlots<Name extends string> = {
  events: readonly EventBodySchema[]   // zod schemas, empty when the plugin adds none
  views: readonly ViewFold[]           // pure folds contributing to the session view
  commands: readonly CommandSpec[]     // inbox commands it accepts
  pod: PodSlot                         // tools, hooks, inbox handlers
  control: ControlSlot                 // CP handlers: observations, side effects
  client: ClientSlot                   // headless state and hooks
  transport: 'none' | 'stream'
}
export const definePlugin = <N extends string>(plugin: { name: N } & PluginSlots<N>) => …
export const composePlugins = (plugins) => ComposedPlugins   // eventBodies, commands, views, pod, control, client
```

Every slot is present in the value (`CONTRIBUTES_NOTHING`-style empty constants where a plugin has
none), so `composePlugins` cannot miss one; that is the typecheck-time guarantee P8 asks for. Native
commands from `commands/` are the first real consumer of the `commands` slot, so the contract is
exercised by production code, not only by a fixture.

**Proving exit criterion 2.** A fixture plugin package lives in the slice's specs (a body, a fold, a
command and an inbox handler), composes through `composePlugins`, and its event round-trips through
`createV2EventSchema`. The fixture is deleted when slice 7 moves the first real plugin.

## 3. `packages/commands`

| File          | Holds                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.ts`     | `CommandSpec` — name, summary, group, `args: z.ZodType`, `timing`: one per capability, the only place its inbox kind and argument shape live |
| `registry.ts` | `defineCommand`, `composeCommands`, `commandOf`: the table the API validates against, the holder dispatches through and the TUI lists        |
| `pod.ts`      | `CommandHandler` and `CommandContext`: `{ args, sessionId, append(drafts), visibleEvents(), model?, log }`                                   |
| `control.ts`  | `ControlCommandHandler`, for the one command whose work is a control-plane write (rename)                                                    |

**As built, the context grew twice.** `visibleEvents()` arrived when rewind needed the log and the
context had no plane; `model` when summarise needed one, threaded from `runtime.model`
(`packages/host/src/holder/held-runner.ts:171`) through the holder to the intake. `append` takes
`EventDraft | RecordBody`, so a handler appends its own record event. There is no `hooks.ts`: each
web action is a small data module beside its surface (`session-rewind.ts`, `session-summarise.ts`,
`rename-session.ts`).

**`handledIn`.** `CommandSpec.handledIn: 'pod' | 'control'` marks the difference. A `control` command
never enters `byInboxKind`, so a holder can never pick one up; `sessions.command` runs it inline and
answers `{}`.

**No text layer yet.** Parsing text into arguments (`/rename my thing`) and building a slash menu are
what a surface that takes text needs, and only the TUI does. They land with the TUI at slice 9 beside
its first consumer; web posts structured arguments from the affordance the operator clicked, so it
never needs them. The contract is what stops that from being duplicated: one spec, one argument
schema, one inbox kind, validated once on the server.

**Wire: `sessions.command`.** One mutation, `{ sessionId, name, args }`. It resolves `name` in the
composed registry, validates `args` with that command's schema, and posts an inbox entry of kind
`` `command:${name}` `` whose payload is the args JSON — `sessions.retry`'s shape
(`sessions.service.ts:285-287`), with ownership checked as `requireOwnedSession` does
(`:289-297`). An unknown name or invalid args is a `BAD_REQUEST` and posts nothing. A client can only
run a command the server knows. The output is `{ inboxId?: number }`: present for a pod command,
absent for a control command.

**Intake: the holder runs commands between turns.** `InboxIntake` (`inbox-intake.ts:28`) takes the
composed command table and dispatches in `prepare()` (`:31-62`):
- A `command:<name>` entry with a handler: append `input-consumed{inboxId}`, run the handler, append
  its drafts, or append `input-refused{inboxId, reason}` when it refuses. Nothing wakes a turn.
- A `command:<name>` entry with no handler: today's `input-consumed{discarded}` plus the warning, so
  an older holder meeting a newer client's command loses it visibly in the log rather than silently.
- Settled only: while a turn runs, `prepare()` is not draining the inbox, so a command posted mid-turn
  waits behind the turn exactly as a message does. The client does not need its own timing guard; it
  still refuses optimistically (`SETTLED_WHILE_WORKING`, `apps/web/src/features/threads/commands/dispatch.ts:20`)
  so a keystroke never lies.

**`input-refused` in `core`.** `{ type: 'input-refused'; inboxId: number; reason: string }` joins
`RecordBody` (`event.ts:39`), `recordBodySchema` (`:88`) and `RECORD_TYPE_TABLE` (`:116`). A refusal
is not a transcript row: `transcript-events.ts:30` maps it to `null`, beside `input-consumed`.

**Pending commands ride the status output, and the fold is untouched.** `SessionStatusOutput` gains
`commands: SessionCommandRow[]` (`{ inboxId, name, postedAt }`) beside `queued`, filled in
`statusOutputOf` (`packages/control/src/session-view-read.ts:140`) from the same inbox page and
filtered on the `command:` prefix. `SESSION_VIEW_VERSION` stays 3: a refusal is read from the
`input-refused` event the client already holds in its window, so nothing is materialized for it.

## 4. Native commands (`commands/` root)

One workspace package holding a folder per command, with `spec.ts`, `pod.ts` (or `control.ts`),
`client.ts`, `web.tsx` and `tui.tsx` as architecture §7 lays out. Root `package.json` workspaces gain
`"commands"`.

### `commands/rewind`

Picks one of your own messages, confirms, posts `{ toSeq }`.
- Guard (`spec.ts`, pure): the session is settled; `toSeq` is a visible `user-said` of the main
  thread; the message is not already the head.
- Pod: append `history-rewound{ toSeq, draft }`, where `draft` is that message's text, so a client
  that opens later can refill its composer — the rewound message is hidden, so it is not in any
  visible tail. Copies v1's behaviour of putting the message back in the composer
  (`apps/web/src/features/threads/data/use-rewind.ts:69`).
- Schema change: `history-rewound` gains `draft: string` (`event.ts:40`, `:89`). A `history-rewound`
  without it is still valid (older rows), so the field is optional and the composer only refills when
  it is present.
- `toSeq` means two things: the command's `{ toSeq }` is the picked message's own seq, while the
  record's `history-rewound.toSeq` is that minus one, because visibility hides from `toSeq + 1`
  (`packages/core/src/record/visibility.ts:20-29`).
- Web: the per-message action the transcript already renders (`TranscriptRewind`,
  `apps/web/src/features/threads/transcript/transcript-turn.tsx:35-38`) fed from v2 events. No
  `/rewind` in the composer (§9 A1).
- Cuts: v1 also kills shells, services and running sub-agents in the cut range. v2 has none of those
  until slice 7, so the guard refuses only a running turn; slice 7 adds the cuts.

### `commands/summarise`

The design in [summarise-at-message.md](summarise-at-message.md), unchanged except where v2 has no
counterpart yet.
- Payload `{ throughSeq }`, prefix only, where `throughSeq` is the event immediately before a visible
  user message. The guards are a v2 sibling, `packages/core/src/record/summary-target.ts`, not a
  generalisation of v1's `compactionTarget`: v1 reads `history-compacted`, and the loop's view turns
  `history-summarised` into exactly that, so the sibling reads the loop's view. `fromSeq` is the first
  visible event's seq, not 1 — a holder log carries record-only events before the first message.
- Pod: `input-consumed`, guard, summarise the range with the session's admitted model, append
  `history-summarised{ fromSeq, throughSeq, anchor: 'prefix', summary }`. The summariser prompt is
  **copied** from v1 into `pod.ts` (v2 shares no logic with v1, 0001/0021-ish rule: v1 code is prior
  art, never imported).
- Refusals append `input-refused` with one of "That message cannot be summarised", "There is nothing
  to summarise", "That range is already summarised", "That range splits a tool call", "This session
  has no model to summarise with", "The summary came back empty". A visible earlier summary inside the
  range is folded into the new one rather than refused. A range holding a running sub-agent is **not**
  refused yet: nothing on v2 spawns one, and slice 7 adds that guard.
- Crash mid-summary: a consumed entry with neither outcome after it should be re-run by the next
  holder — the summariser has no side effects. **Not built or tested yet** (§8).
- Rewind undoes a summary: already true of `visibility.ts:19-28`, so the confirm copy drops v1's "can
  no longer be rewound to" and says a rewind to before the summary brings the messages back.
- Web: the `SummariseDialog` + per-message action v1 already ships (`TranscriptSummarise`,
  `thread-transcript.tsx:92`). No `/summarise` in the composer (§9 A1).

### `commands/rename`

Payload `{ name }` → the session's title becomes `name`.
- **No log event (operator, 2026-11-07: nothing in the transcript needs to show a rename).** The
  title is a CP row (`port.ts:126`, `session-ops.ts:52`), so `rename` is the one native command whose
  handler runs in the control plane, not the pod: the API consumes the inbox entry, writes the title,
  announces, and appends nothing. The sidebar and header follow from the announced session row, the
  same push a rename makes today. If a later slice makes the title a fold, the handler moves to the
  pod unchanged.
- A `setSessionTitle` op is added to `ControlTx` and the memory/Postgres adapters beside
  `setSessionTitleIfUntitled`, because rename must overwrite a title the auto-namer already set. It
  also clears `titledFromInboxId`, so taking back the message that auto-named a session no longer
  blanks a name the operator chose.
- Web: a pencil `RowAction` on the session row, shown on hover beside archive
  (`shell-thread-row-body.tsx:103`), opening a small input; the session header's title is the same
  action. No `/rename` in the composer (§9 A1).

## 5. Web wiring

The web presents capabilities on the thing they act on, not as slash commands (§9 A1).
- Rewind and summarise are per-message actions on the transcript (`TranscriptRewind`,
  `TranscriptSummarise`), built by `data/session-rewind.ts` and `data/session-summarise.ts` from the
  snapshot's visible events; each posts through `sessions.command`.
- Summarise mounts the shipped dialog with a v2 `copyOf`, so the copy says a rewind to before the
  summary brings the messages back. Its pending state is derived from the log (a later
  `history-summarised`, or `input-refused` for that inbox id), not from the inbox.
- Rename is a pencil `RowAction` on the session row's hover cluster (v2 rows only) and beside the
  session header's title, opening a popover input; Enter saves, Escape closes.
- A refusal shows its reason inline above the composer, next to rewind's.
- The composer refills from `history-rewound.draft`, and from the picked text the moment the rewind
  lands (the picked event leaves the window).
- The composer's slash menu stays as it is: no command specs are passed to it, so typing `/` keeps
  sending text until a later slice decides which commands deserve a menu on web.

## 6. As built

| PR    | Title                                                                     | What it landed                                                            |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| #2002 | `refactor(commands): the command contract, registry and sessions.command` | `packages/commands`, the mutation, the API's registry and refusal         |
| #2003 | `refactor(plugin-sdk): the plugin contract and the event registry`        | registry in `core`, `createV2EventSchema`, `packages/plugin-sdk`, fixture |
| #2005 | `refactor(host): run inbox commands between turns`                        | intake, `input-refused`, `EInputConsumed.Command`, pending rows           |
| #2006 | `feat(commands/rewind): rewind to a message on v2`                        | root `commands/` package, `history-rewound.draft`, the message action     |
| #2007 | `feat(commands/rename): rename a v2 session from the sidebar`             | `handledIn`, `setSessionTitle`, the pencil                                |
| #2008 | `feat(commands/summarise): summarise up to a message on v2`               | `summary-target.ts`, the summariser, the message action                   |
| this  | `docs(v2): slice 6 done`                                                  | §10, the roadmap, the follow-ups                                          |

The first two merge in either order; #2005 needs #2002; #2006–#2008 need #2005. #2006, #2007 and
#2008 were built by separate agents in parallel worktrees and conflicted only in
`commands/src/index.ts`, which registers each command and both handler maps.

## 7. Test plan

| Layer                                   | What                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure                                    | Argument parsing per command and its refusal strings; `dispatch` text → command/send/refused; registry collisions; the rewind and summarise guards over plain event arrays (TDD, plain data)                                                                                        |
| Plugin registry                         | The fixture plugin's body decodes through `createV2EventSchema`; a plugin with a missing slot fails typecheck; `composePlugins` output is frozen; core's schema alone still rejects the fixture body                                                                                |
| Control conformance (memory + Postgres) | `sessions.command` posts `command:<name>` with validated args; an unknown name or bad args is refused and posts nothing; `input-refused` folds into the view's command rows; the pending row clears when the outcome appends; a rewind leaves `spend` unchanged and drops the meter |
| Host                                    | The holder runs a command between turns and not during one; a message posted while a command runs is consumed after; killing the holder after `input-consumed` re-runs the summary once; an unknown `command:` kind is consumed as discarded with a warning                         |
| Web                                     | The message action posts rewind and summarise; the composer refills from `draft`; the sidebar pencil renames and the row shows the new title; a refusal shows its reason; a pending command shows until its outcome                                                                 |
| Live (prod v2 session)                  | Rewind the last turn: spend row unchanged, meter lower. Summarise a range: one summary row, the range hidden, the messages return on a rewind past it. Rename. One refused summarise shows its reason                                                                               |

## 8. Out of scope

- Fork-from-here; auto-compaction; GC of hidden rows (P5 storage policy).
- Command text parsing, the slash menu and per-surface dispatch: the TUI's, at slice 9 (§3).
- `/model`, `/compact`, `/rotate`, `/cd`, `/new`, `/help` and the rest of the v1 catalogue. `/skills`,
  `/mcp` and `/shells` belong to slice 7's plugins.
- Moving real feature events out of `core`: slice 6 builds and proves the registry, slice 7 moves them.
- The TUI's v2 session surface (slice 9) — see §9 Q2.
- Commands that act on a running turn (interrupt, queued-edit). Stop already exists as its own inbox
  kind and is untouched.
- The TUI renderers and slash commands: with no v2 session surface before slice 9 there is nothing to
  wire them to, so the shared part is the declaration and the registry.
- Re-running a summarise whose holder died after `input-consumed`, and the running-agent guard
  (slice 7).
- The host's record adapter and the session-view read path still decode with core's schema, so a
  plugin event can be appended and read directly but not through the view's catch-up; slice 7 threads
  it when the first real plugin regains events.
- The plugin registry's type-level guarantee is per package: a plugin's body is typed without editing
  `core`, while core's own switches keep a defined fallthrough for bodies they do not know (the client
  ignores one it has no plugin for).

## 9. Operator answers (2026-11-07)

1. **Which commands ship, and how they appear.** Not every command on every surface: web has UI for
   these, so it does not need `/rewind`, `/summarise` or `/rename` as commands. Web gets rewind and
   summarise as the message actions and rename as a pencil on the session row's hover, with a
   tooltip. The TUI gets them as slash commands once it reaches v2. One declaration serves both
   presentations.
2. **The TUI leg.** The TUI is a backup surface now. Build the contract surface-agnostic and prove
   it with a TUI renderer test; the real wiring lands with slice 9.
3. **The plugin proof.** A fixture plugin that executes every capability of the plugin abstraction
   (event, view, command, pod handler, control handler, client state, transport slot).
4. **Rename.** No log event, because nothing in the transcript needs to show a rename. The title stays
   the CP row; rename is the one CP-handled command and appends nothing; the sidebar follows the
   announced session row.

## 10. Results (2026-11-08)

**What shipped.** `plugin-sdk` with a type-level event registry and a slot-complete contract, proven by
a fixture plugin; `packages/commands` with `handledIn` and one `sessions.command` mutation; the holder's
command intake with `input-refused`; three capabilities on v2 web — rewind, summarise, rename.

**Live check.** LIVE_CHECK_PLACEHOLDER

**Corrections the build made to this spec.** The view does not carry commands (the status output does,
`SESSION_VIEW_VERSION` stays 3); `CommandContext` gained `visibleEvents()` and `model`; a control command
is excluded from `byInboxKind`; rewind's `toSeq` is the picked message and the record's is one less;
summarise's guards are a v2 sibling over the loop view; the generated tRPC router is committed (CI fails
on drift), so a wire change commits it.

**Follow-ups.** Re-run a summarise after a holder crash; the running-agent guard (slice 7); the TUI
renderers (slice 9); the host record adapter and the session-view path on the plugin schema (slice 7).
