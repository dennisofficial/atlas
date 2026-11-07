# Slice 6 spec: `plugin-sdk` and `commands`

Status: **draft, 2026-11-07 — awaiting the operator's answers in §9 before building starts.** A spec;
nothing here is built. Anchors are `path:line` at `7005a2a8b`; re-check before relying on one.

## Goal

A command is declared once and works on every surface, and a plugin's events are typed without
editing `core`. Slice 6 builds the two foundations the rest of v2 needs — the plugin contract and the
command contract — and ships the first native commands on v2: rewind, summarise and rename, which v1
has and v2 does not.

**Exit criterion** (roadmap row 6, made concrete):
1. A command defined once in `commands/` is reachable from web and from the TUI, from one
   declaration. (The TUI's live leg depends on §9 Q2; the TUI has no v2 session until slice 9.)
2. A plugin's event is exhaustively typed without editing `core`: a plugin package merges a body into
   the event registry, the composed decoder parses it, and every exhaustive switch either has a case
   or fails typecheck.
3. On a real v2 session from the web: rewind to one of your own messages, summarise up to one, rename
   the session. Spend holds across a rewind while the context meter drops (slice 4's decision, never
   seen live). A command the pod refuses appends `input-refused{inboxId, reason}` and the web shows
   the reason.

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

**The type-level event registry.** `src/event-registry.ts`:

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
declare module '@dltech/atlas-plugin-sdk' {
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

| File           | Holds                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.ts`      | `CommandSpec` — the v1 shape (`packages/core/src/commands/spec.ts:12`) plus `args: z.ZodType`, `timing` (settled or immediate; only settled ships in this slice) and `summary`/`argumentHint` |
| `arguments.ts` | argument text → validated args, one refusal string per failure (`/rename my thing` → `{ name: 'my thing' }`)                                                                                  |
| `registry.ts`  | `defineCommand`, `composeCommands`, `commandOf`, `menuOf(registry)` → the `readonly SurfaceCommand[]` the composer already consumes (`thread-composer.tsx:37`)                                |
| `dispatch.ts`  | pure: raw composer text + registry → `{kind:'command', name, args}` \| `{kind:'send', text}` \| `{kind:'refused', reason}`, reusing `resolveSubmission` for the text half                     |
| `hooks.ts`     | headless React: `useSessionCommands(session)` → the menu, the pending set and the last refusal from the session view; `useRunCommand()` posts through `sessions.command`                      |
| `pod.ts`       | `CommandHandler = (ctx) => Promise<{ drafts: readonly EventDraft[] } \| { refused: string }>` and the `CommandContext` (args, session, record, model, log)                                    |
| `client.ts`    | the shared pending/refused line as headless state (rendering is each surface's)                                                                                                               |

**Wire: `sessions.command`.** One mutation, `{ sessionId, name, args }`. It resolves `name` in the
composed registry, validates `args` with that command's schema, and posts an inbox entry of kind
`` `command:${name}` `` whose payload is the args JSON — `sessions.retry`'s shape
(`sessions.service.ts:285-287`), with ownership checked as `requireOwnedSession` does
(`:289-297`). An unknown name or invalid args is a `BAD_REQUEST` and posts nothing. A client can only
run a command the server knows.

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

**The view carries commands.** `SessionViewValue` gains `commands: readonly SessionCommandRow[]`
(`{ inboxId, name, state: 'pending' | 'refused', reason? }`), built where `queuedOf` is built
(`packages/control/src/session-view-read.ts:140`) from the same inbox page plus the refusals in the
visible tail. **Bump `SESSION_VIEW_VERSION`** (`packages/core/src/record/views/session-view.ts`) —
materialized rows refold lazily through `usableState` (`packages/control/src/session-view-ops.ts:22-27`)
— because the folded value's shape changed.

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
- Web: the per-message action the transcript already renders for v1 (`TranscriptRewind`,
  `apps/web/src/features/threads/transcript/transcript-turn.tsx:35-38`) fed from v2 events.
- Cuts: v1 also kills shells, services and running sub-agents in the cut range. v2 has none of those
  until slice 7, so the guard refuses only a running turn; slice 7 adds the cuts.

### `commands/summarise`

The design in [summarise-at-message.md](summarise-at-message.md), unchanged except where v2 has no
counterpart yet.
- Payload `{ throughSeq }`, prefix only. Core guard: generalise v1's `compactionTarget`
  (`packages/core/src/compaction/compaction-target.ts:43`) to take the floor as a parameter and add a
  v2 floor over `history-summarised` + the visible events; v1 keeps passing `compactedThrough`.
- Pod: `input-consumed`, guard, summarise the range with the session's admitted model, append
  `history-summarised{ fromSeq, throughSeq, anchor: 'prefix', summary }`. The summariser prompt is
  **copied** from v1 into `pod.ts` (v2 shares no logic with v1, 0001/0021-ish rule: v1 code is prior
  art, never imported).
- Refusals append `input-refused`: the range splits a tool call, saves nothing, sits under an existing
  summary, or holds a running sub-agent ("stop the agent first" — slice 7 decides whether summarise
  stops them instead).
- Crash mid-summary: a consumed entry with neither outcome after it is re-run by the next holder; the
  summariser has no side effects, so re-running is safe and needs no `OnceLedger` row.
- Rewind undoes a summary: already true of `visibility.ts:19-28`, so the confirm copy drops v1's "can
  no longer be rewound to" and says a rewind to before the summary brings the messages back.
- Web: the `SummariseDialog` + per-message action v1 already ships (`TranscriptSummarise`,
  `thread-transcript.tsx:92`).

### `commands/rename`

Payload `{ name }` → the session's title becomes `name`.
- The title is a CP row with no log event (`port.ts:126`, `session-ops.ts:52`), so `rename` is the one
  native command whose handler runs in the control plane, not the pod: the API consumes the inbox
  entry, writes the title, announces, and appends nothing. This is stated here rather than inventing a
  `title-set` event; if a later slice makes the title a fold, the handler moves to the pod unchanged.
- A `setSessionTitle` op is added to `ControlTx` and the memory/Postgres adapters beside
  `setSessionTitleIfUntitled`, because rename must overwrite a title the auto-namer already set.
- Web: `/rename <name>` from the composer and the session header's title affordance.

## 5. Web wiring

- The v2 session view supplies `commandSpecs={menuOf(registry)}` to `ThreadComposer`
  (`thread-composer.tsx:22,37`) — typing `/` opens the same menu v1 shows.
- It supplies `rewind` and `summarise` to `ThreadTranscript` (`thread-transcript.tsx:87-92`), built
  from `snapshot.events` and the view's `commands`.
- A command pending shows as a row where the queued dock shows messages (`QueuedDock`); a refusal
  shows its reason in the same place, with the reason text from the command's own refusal strings.
- The composer refills from `history-rewound.draft` when it is present.

## 6. PR breakdown

1. `feat(plugin-sdk): plugin contract and the type-level event registry` — §2, the fixture plugin, and
   the decoder threaded through control, host and client.
2. `feat(commands): the command contract, registry and dispatch` — §3's pure files plus
   `sessions.command`, with the API refusing unknown names and bad args.
3. `feat(host): run inbox commands between turns` — intake dispatch, `input-refused` in `core`, the
   view's command rows, `SESSION_VIEW_VERSION` bump.
4. `feat(commands/rewind): rewind to a message on v2` — command, `history-rewound.draft`, web action.
5. `feat(commands/summarise): summarise up to a message on v2` — guards, pod handler, web action.
6. `feat(commands/rename): rename a v2 session` — CP-side handler, `setSessionTitle`, `/rename`.
7. `docs(v2): slice 6 done` — roadmap row and Current state, the live check below written into this
   spec, and the §9 answers.

Each PR is reviewable in one sitting and lands in order. 1 and 2 are independent; 3 needs 2; 4–6 need
3.

## 7. Test plan

| Layer                                   | What                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure                                    | Argument parsing per command and its refusal strings; `dispatch` text → command/send/refused; registry collisions; the rewind and summarise guards over plain event arrays (TDD, plain data)                                                                                        |
| Plugin registry                         | The fixture plugin's body decodes through `createV2EventSchema`; a plugin with a missing slot fails typecheck; `composePlugins` output is frozen; core's schema alone still rejects the fixture body                                                                                |
| Control conformance (memory + Postgres) | `sessions.command` posts `command:<name>` with validated args; an unknown name or bad args is refused and posts nothing; `input-refused` folds into the view's command rows; the pending row clears when the outcome appends; a rewind leaves `spend` unchanged and drops the meter |
| Host                                    | The holder runs a command between turns and not during one; a message posted while a command runs is consumed after; killing the holder after `input-consumed` re-runs the summary once; an unknown `command:` kind is consumed as discarded with a warning                         |
| Web                                     | The menu lists the composed specs; rewind posts and the composer refills from `draft`; a refusal shows its reason; a pending command shows until its outcome                                                                                                                        |
| Live (prod v2 session)                  | Rewind the last turn: spend row unchanged, meter lower. Summarise a range: one summary row, the range hidden, the messages return on a rewind past it. Rename. One refused summarise shows its reason                                                                               |

## 8. Out of scope

- Fork-from-here; auto-compaction; GC of hidden rows (P5 storage policy).
- `/model`, `/compact`, `/rotate`, `/cd`, `/new`, `/help` and the rest of the v1 catalogue. `/skills`,
  `/mcp` and `/shells` belong to slice 7's plugins.
- Moving real feature events out of `core`: slice 6 builds and proves the registry, slice 7 moves them.
- The TUI's v2 session surface (slice 9) — see §9 Q2.
- Commands that act on a running turn (interrupt, queued-edit). Stop already exists as its own inbox
  kind and is untouched.

## 9. Questions for the operator (2026-11-07)

Recommendations first; the operator answers each in one line.
1. **Which commands ship in slice 6?** Recommended: rewind, summarise, rename — the three verbs v1
   sessions have that v2 sessions cannot do at all, and the two slice 4 left as `null`.
2. **The TUI leg of "runs from web and TUI".** The TUI does not speak v2 until slice 9, so this
   cannot be shown live now. Recommended: build the contract surface-agnostic, prove "defined once"
   with one command rendered by both a web renderer and a TUI renderer in component tests and the
   real path on web; the roadmap row records that the TUI is wired at slice 9. Alternative: drop the
   TUI from slice 6's exit and prove web only.
3. **How the plugin-events criterion is proven.** Recommended: a fixture plugin in slice 6's specs
   (event, fold, command) composed through the real registry; the first real plugin moves in slice 7.
   Alternative: move one small real feature's events into `plugins/` now.
4. **Renaming writes the control plane, not the log.** Recommended: `rename` is the one command whose
   handler is CP-side (title is a CP row today) and appends nothing; if the title ever becomes a fold
   the handler moves to the pod. Alternative: add a `title-set` log event now and make the title a
   fold — more surface change than the slice needs.
