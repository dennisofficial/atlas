# Slice: /rotate on v2 — a context boundary inside one thread

> **Approved by Dennis 2026-11-23.** In place: one transcript, a rotation marker, the model's context starts at the rotation. Refused while a sub-agent runs. Auto-rotate is a setting (default 85 %, 0 = off). Settled by the main session: auto-rotate replaces the auto-compact row; auto-compact is deleted with v1, because the TUI becomes a v2 client, so no per-surface setting field is needed.

Status: **built 2026-11-23** (§11 lists what was built and where it differs). Draft 2 applied Dennis's answers of 2026-11-23 are applied: one transcript, a
rotation marker, the projection starts at the boundary, no new thread, refuse while a sub-agent
runs, auto-rotate as a setting. Anchors are `path:line` at `0d7082dc8` (origin/main,
2026-11-22). Re-check an anchor before you rely on it.

Related contract: `docs/v2/slices/slash-commands.md` (approved 2026-11-23). That file drops
`/rotate` in §4.6 with the reason "the loop watchdog and the rotation engine are gone (operator,
2026-11-18)". Dennis's answer of 2026-11-23 reverses that
decision for the command only: it exists, as a host command. Slice 5 of this file removes the
dropped line.

## 0. One line

`/rotate` writes a handoff brief and appends one `rotated` event to the thread. The transcript keeps
every row and shows a marker there. The model request is projected from that marker onward, so the
next turn starts from the brief alone. Auto-rotation at a context threshold is the safety net.

## 1. Product contract

**What the operator does.** Type `/rotate` in the composer, on any surface. One line of instructions
is optional: `/rotate ship the migration first`.

**What happens.**
1. The command runs between turns, as every host command does (`text-command.ts` planner →
   `CommandIntake.run`, `packages/host/src/holder/command-intake.ts:122-140`). It refuses while a
   sub-agent runs.
2. One model call reads the visible transcript and writes a handoff brief (goal, done, next, key
   files, open questions, plan, pointers, dead ends).
3. The holder appends one `rotated` event to the same thread. The event holds the brief.
4. The transcript keeps every row. A full-width divider sits at the event:
   `context rotated here`, the time, `at 86% of the window` when it was automatic. The brief is a
   collapsible card under the divider.
5. The next model request is projected from that event: the brief, then everything after it. The
   context meter resets.

**What stays the same.** The session, thread id, title, repo clone, worktree, branch, sandbox, model,
credentials, task list, subscriptions, running shells and services, and the context folder. Nothing
moves. Only the model's window changes.

**Refusals.** One sentence above the composer, from `input-refused`, exactly as `re-summarise` and
`rewind` refusals render today.
- `A sub-agent is still running; stop it first.`
- `There is nothing to rotate: this thread has no messages yet.`
- `This session has no model to rotate with.`
- `The handoff came back empty.`
- `The handoff could not be written: <detail>.`
- `A rotation is already in progress.` (only while the handler runs; the inbox already serialises)

**Auto-rotation.** After a settled turn leaves the context at or above the threshold, the holder
rotates without a prompt. The event carries the percent, so the divider says
`rotated automatically at 86% of the window`. A failed auto-rotation never touches the turn: the
turn is already finished, the refusal lands as `input-refused` on no inbox entry, and the meter stays
high until the operator acts.

**Contract in one sentence.** Rotation is a boundary inside a thread: the session keeps its world,
the model keeps only what the brief says.

## 2. Why one thread, and what that removes

A rotation used to mean "new thread, move the session to it". That made the thread pointer, the
client follow, the retired thread, the relocated process and the recovery paths. All of it goes.

The event log is the transcript and the projection input. A boundary inside the log needs one fact
(a `rotated` event) and one rule (the projection starts at the latest one). Everything else — the
transcript, the session view, spend, checkouts, pending inputs, subscriptions — already folds over
the thread's log and needs no change.

The cost is honest: the log of a long-lived thread keeps growing even after rotations. That is the
audit trail, and retention is a storage-policy question (architecture P5), not this slice.

## 3. How rotate differs from summarise

Summarise and rotate answer different questions. Summarise compresses history you still need.
Rotate stops the old history from reaching the model at all, and replaces it with instructions for
what comes next.

|                             | `/summarise` (exists)                                                                                                                                                     | `/rotate` (this slice)                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Event                       | `history-summarised{fromSeq, throughSeq, anchor, summary}` (`packages/core/src/record/event.ts:70-77`)                                                                    | `rotated{handoff, instructions?, auto?}` (`packages/core/src/events/body.ts:230-235`)                  |
| Transcript                  | the range is hidden; one compaction row stands in it (`packages/core/src/record/visibility.ts:36-45`, `packages/client/src/stream/transcript-events.ts:16-21`)            | nothing is hidden; every row stays; one divider is added                                               |
| What the next request holds | the summary spliced where the range was, plus every message after it (`packages/core/src/assembly/rules/compacted-history.ts:96-118` via the watermark)                   | the brief, then the events after the boundary; nothing before it                                       |
| Shape of the text           | a summary of what happened, in the sections the summariser reads: request, progress, knowledge, failures, open work, live state (`commands/src/summarise/prompt.ts:1-31`) | a brief for a fresh start: goal, done, next step, key files, open questions, plan, pointers, dead ends |
| Target rule                 | must end just before one of the operator's messages, must not split a tool call (`packages/core/src/record/summary-target.ts:52-88`)                                      | no target: the boundary is "now"                                                                       |
| Rewind                      | a rewind to before the summary brings the range back                                                                                                                      | a rewind to before the boundary removes the marker and the projection returns to the whole log         |
| Direction                   | keeps working in the same context, smaller                                                                                                                                | throws the context away; nothing is carried except what the brief states                               |

**The reuse is the mechanism, not the text.** Rotate copies two things from summarise:
1. **The event carries its own rendering, and one pure fold reads it.** Compacted history reaches the
   model through `compactionWatermarks()` and one assembly rule. Rotation reaches it through
   `latestRotationOf()` and one assembly rule (§5.3), and the transcript through the ordinary event
   switch.
2. **The meter resets by an edit event.** `stepMeter` already returns the initial state when it meets
   an edit (`packages/core/src/record/views/meter-state.ts:37-45`). Rotation joins that set, so the
   ring empties and the window stays, with no new UI.

**It does not copy the summary.** The brief is not derived from the history by compression. It is
written for a model that will never see the history, so it says what to do and what not to retry,
and it names paths instead of quoting content. A summary would pass the old conversation forward;
that is the failure rotation exists to avoid.

## 4. The v1 failure modes, and what this design removes

| #   | Failure mode                                                                                                                                                                  | Status on this design                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A second identity for the same work.** v1 rotated by handing the session to a successor thread, then reversed to rotating in place, and left both vocabularies in the tree. | **Gone.** One event, one rule, one renderer per surface. There is no successor to name, so there is no second vocabulary to forget.                                  |
| 2   | **Nothing durable marked a rotation in progress.** A crash left either the untouched log or a landed watermark, and the plan relied on memory.                                | **Gone.** The append is the whole operation and it goes through the ordinary hash-chained, epoch-checked path. There is no multi-step state machine to strand.       |
| 3   | **Wedged sessions after a failed rotation.** The admission latch and the parked checkpoint could leave a session that could not be driven.                                    | **Gone.** Rotation never replaces a process, never touches admission, and never moves a lease. It appends, like a turn does.                                         |
| 4   | **The client lost the new context.** Every surface had to learn to follow a new thread id.                                                                                    | **Gone.** The client follows the session's one thread. The log only grows, so the subscription and the transcript stay valid across the boundary.                    |
| 5   | **The boundary was invisible or lied.** The old thread could not be read after a rotation, and only the TUI drew the divider.                                                 | **Reduced, not gone.** The fact is in the log, so no surface can disagree about _what_ happened. Each surface still needs its own row component (§5.8).              |
| 6   | **Two write paths to the same window.** The pod compacted and the API wrote its own compaction rows.                                                                          | **Gone.** One writer: the holder appends. The manual path and the automatic path call the same function (§5.5, §5.7).                                                |
| 7   | **The context gauge was wrong after the rotation.** The TUI read the gauge from whichever thread reported usage.                                                              | **Reduced, not gone.** One fold now (`stepMeter`), so the only risk is forgetting the `rotated` case there. One core test covers it (§6).                            |
| 8   | **The rotation outran the architecture it needed.** Auto-compaction fired in the TUI and never in serve.                                                                      | **Stays a live risk in a new form.** The automatic trigger must sit on the host, where the turn ends, not in a surface. §5.7 puts it there, and has no surface copy. |

Two lessons that still shape the design:
- v1's carry-over prompt is good prior art: it names its headings and it ends with "you will wake
  with ONLY this brief" (`packages/harness/src/rotation/carry-over-summary.ts:14-60`). Copy the
  framing, not the file. v1 files are prior art and are never imported.
- v1 hid the prefix behind `history-compacted`, so the old turns were reachable only by rewinding.
  That is a history edit, not history. Here the rows stay and only the model's window cuts.

## 5. Design

Everything runs on the agent host. The control plane holds the log. Nothing lives in memory across a
restart.

### 5.1 The command

New native command, beside summarise and rewind (`commands/src/index.ts:13-18`).

```ts
// commands/src/rotate/spec.ts
export const REFUSAL_ROTATE_CHILDREN = 'A sub-agent is still running; stop it first.'

export const rotateArgs = z.strictObject({ instructions: z.string().max(2000).optional() })

export const rotate = defineCommand({
  spec: {
    name: 'rotate',
    summary: 'Start a fresh context in this thread from a handoff brief',
    group: ECommandGroup.Context,
    argumentHint: '[instructions]',
    args: rotateArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: (argumentText) => {
      const instructions = argumentText.trim()
      return { ok: true, args: instructions === '' ? {} : { instructions } }
    },
  },
})
```

**Contract placement.** This is the whole of the slash-commands contract that `/rotate` needs:
- **Kind: host.** `runsIn: ECommandRunsIn.Host` (`packages/commands/src/spec.ts:12-16`), so
  `composeCommands` puts it in `byInboxKind` and the holder runs it
  (`packages/commands/src/registry.ts:42-52`).
- **Surface profile: every surface.** `SURFACE_PROFILES`
  (`packages/commands/src/surface.ts:22-33`) lists only what a surface _hides_. `rotate` appears in
  no `hides` list and in no `picks` list, so `catalogueForSurface` returns it for `web`, `mac`,
  `mobile` and `tui`. It has no message-action equivalent, so nothing justifies hiding it.
- **No picker.** `picks` stays empty for it on every surface: the boundary is always "now".
- **No argument grammar to parse.** `fromText` puts the whole argument text into `instructions`, so
  a typed `/rotate` and a picked `/rotate` mean the same thing.
- **A hidden name still runs.** Unchanged: the host parses `/rotate` against the registry.

The web, Mac and mobile menus get it from `sessions.commands`
(`apps/api/src/api/platform/control/command-registry.ts` + `sessions.router.ts`), which already
serves every native command. No new mutation, no new client action, no new surface table entry.

Wire: `sessions.command { sessionId, name: 'rotate', args }` → `postCommand`. It posts an inbox entry
with the session and no thread id, which is the property that matters: the entry is consumed by the
thread that is live at the time.

### 5.2 The event

One change to an event body that exists and has no producer today.

```ts
// packages/core/src/events/body.ts:230-235 — replace the v1 shape
| {
    type: 'rotated'
    handoff: string
    instructions?: string | undefined
    auto?: { percent: number } | undefined
  }
```

Mirror it in the schema (`packages/core/src/events/schema.ts:229-233`):

```ts
z.object({
  type: z.literal('rotated'),
  handoff: z.string().min(1),
  instructions: z.string().optional(),
  auto: z.object({ percent: z.number().int().min(0).max(100) }).optional(),
})
```

Why change the body instead of adding one:
- **No producer exists.** `git grep "type: 'rotated'"` finds the union member, the schema literal and
  fixtures only. v1's rotation engine was deleted (#1236), so nothing appends this event. The only
  consumers are the renderers (§5.8) and their fixtures.
- **`predecessor` and `handoffPath` are wrong for the new model.** There is no predecessor thread,
  and the brief is not a file: a file would be a second truth (out of scope, §9).
- **One name, one meaning.** A new `thread-rotated` body beside a dead `rotated` body is exactly
  failure mode #1.

The event is a core event type, not a record-only body. That is deliberate: it is part of the
thread's own history, the transcript must render it, and the model request must be cut at it.
`COMPACTION_DISPOSITION.rotated` is `Keep`, so a later summary never hides the boundary. As drafted
it was `Drop`, which hides the event under a summary span. The live check found that (§11).

### 5.3 The projection

New pure module, `packages/core/src/record/rotation.ts`:

```ts
import type { Event, EventOfType } from '../events/envelope'

export const NO_ROTATION = 0

export function latestRotationOf(events: readonly Event[]): EventOfType<'rotated'> | undefined {
  return events.findLast((event) => event.type === 'rotated')
}

export function rotationStartSeq(events: readonly Event[]): number {
  return latestRotationOf(events)?.seq ?? NO_ROTATION
}

/** The log the model request is built from: the boundary, then everything after it. */
export function projectedEvents(events: readonly Event[]): readonly Event[] {
  const from = rotationStartSeq(events)
  return from === NO_ROTATION ? events : events.filter((event) => event.seq >= from)
}
```

One call site: `SessionRecord.read` (`packages/host/src/holder/record/record-adapter.ts:122-124`).

```ts
async read(_args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }> {
  return { events: projectedEvents(this.cache.visibleLoopEvents()) }
}
```

Rules that keep this honest:
- **Only `read()` cuts.** `read()` is the `ModelContextPort` method the assembly uses
  (`packages/agent/src/loop/tracked-turn.ts:186-201`). `ownEvents` and `composedEvents`
  (`record-adapter.ts:105-111`) keep the whole log, because the loop state, the dedupe of parked
  calls and the loop guard are turn mechanics, not context. `loopState()` already folds the whole
  log.
- **The cut is over visible events.** `visibleLoopEvents()` already drops record-only bodies and
  rewound ranges, so a rewind to a seq before the boundary removes the `rotated` event from the
  projection and the whole log returns. That matches the v2 rule that a rewind past a summary undoes
  the summary (`docs/v2/slices/summarise-at-message.md`).
- **No new port and no new module in the agent.** The agent loop already asks the record for the
  events of the next step.

### 5.4 The brief in the request

The `rotated` event is a loop event, but it is not a message. One new assembly rule renders it,
as a sibling of the compaction rule, and `defaultRules` registers it right after
`messagesFromEvents()` (`packages/core/src/assembly/pipeline.ts:36-47`).

```ts
// packages/core/src/assembly/rules/rotated-handoff.ts
const HANDOFF_PREFACE =
  'This thread was rotated. You wake with only this brief of the work before it.'

export function rotatedHandoff(): Rule {
  return defineRule({
    name: 'rotatedHandoff',
    apply: (input, ctx) => {
      const point = latestRotationOf(ctx.events)
      if (point === undefined) return input
      const kept = input.messages.filter((entry) => entry.origin.seq >= point.seq)
      return {
        system: input.system,
        messages: [
          {
            message: {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: systemContext({ slot: 'rotation', key: 'handoff', content: point.handoff }),
                },
              ],
            },
            origin: { eventId: point.id, seq: point.seq },
          },
          ...kept,
        ],
      }
    },
  })
}
```

- `systemContext` is the same envelope the compaction rule uses
  (`packages/core/src/assembly/rules/compacted-history.ts:10-22`,
  `packages/core/src/context/envelope.ts`), so the brief is framed as context, not as something the
  operator said.
- The message is `role: 'user'` and it opens the request, which `opensOnUserTurn` requires.
- The `filter` is a guard, not a second cut: `read()` already returns the projection. It holds when
  a caller such as a spec hands the rule the whole log.
- The `instructions` line is inside the brief: the prompt puts it at the top of `Next` (§5.6).

### 5.5 The command handler

**One model call, in the pod handler.** Not a final agent step: a second wake, a second turn and a
tool set the work does not need.

```ts
// commands/src/rotate/pod.ts
export const ROTATE_TIMEOUT_MS = 120_000

export async function rotateNow(args: {
  model: ModelPort | undefined
  visibleEvents(): readonly Event[]
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  instructions?: string | undefined
  auto?: { percent: number } | undefined
  log?: ((message: string) => void) | undefined
}): Promise<CommandResult>
```

Steps:
1. `visibleEvents()`. Require at least one `user-said`. Otherwise refuse with
   "There is nothing to rotate: this thread has no messages yet."
2. `model === undefined` → refuse "This session has no model to rotate with."
3. Build the transcript with the core helper the summariser already uses for a range
   (`transcriptOfRange`, `commands/src/summarise/pod.ts:76`), from the seq after the previous
   `rotated` (or from the first event) through the head. The brief must describe the work since the
   last boundary, not the whole log again.
4. One call: `model.step({ assembled: { system: [{text: ROTATE_INSTRUCTION}], messages: [...] },
   tools: [], signal: AbortSignal.timeout(ROTATE_TIMEOUT_MS) })`, the shape of
   `summaryFrom` (`commands/src/summarise/pod.ts:18-38`).
5. Empty reply → refuse "The handoff came back empty." A thrown error → refuse
   "The handoff could not be written: <detail>".
6. `append([{ type: 'rotated', handoff, ...(instructions === undefined ? {} : { instructions }),
   ...(auto === undefined ? {} : { auto }) }])`. Return `{ kind: 'done' }`.

The handler wrapper is thin:

```ts
export const rotateHandler: CommandHandler<unknown> = async (context) => {
  if (context.runningChildren() > 0) return { kind: 'refused', reason: REFUSAL_ROTATE_CHILDREN }
  const parsed = rotateArgs.safeParse(context.args)
  if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
  return rotateNow({
    model: context.model,
    visibleEvents: context.visibleEvents,
    append: context.append,
    instructions: parsed.data.instructions,
    log: context.log,
  })
}
```

**The context field.** `CommandContext` (`packages/commands/src/pod.ts:3-12`) gains
`runningChildren(): number`. The holder supplies it: `CommandIntakeArgs`
(`packages/host/src/holder/command-intake.ts:49-66`) gains `childrenRunning?: () => number`, the
context object (`command-intake.ts:224-240`) passes `runningChildren: () => this.args.childrenRunning?.() ?? 0`,
and `InboxIntake` passes `childrenRunning` from its own args
(`packages/host/src/holder/inbox-intake.ts:60-96`). `HeldSession` already has the count and gives it
to `HeldActions` the same way: `childrenRunning: () => this.crew?.runningCount() ?? 0`
(`packages/host/src/holder/held-session.ts:105`). A command entry is drained when no turn runs
(`command-intake-glue.ts:80`), so the only live writers are children.

**Durability.** There is one step worth recovering: the model call. The intake appends
`input-consumed` before it invokes the handler (`command-intake.ts:122-127`); if the holder dies
mid-call, the entry is a consumed command with no outcome, and the existing replay path re-runs it
(`packages/host/src/holder/recover-unfinished-commands.ts:16-57`, the #2015 path). The model call has
no side effects. A second rotation cannot land by accident: a re-run re-reads the log, and if a
`rotated` event already exists the handler would still append another one — so the guard in step 1
also refuses when the head seq equals the latest `rotated` seq, with "This thread has nothing since
the last rotation." That is the exactly-once rule, in one comparison.

### 5.6 The prompt

New file `commands/src/rotate/prompt.ts`, shaped like `CARRY_OVER_PROMPT` and rewritten for v2
vocabulary. Headings in this order:

```
Goal            — the task as the operator stated it, in their words.
Done            — what is finished, with the evidence (tests, commits, PRs, paths).
Next            — the single next step and what it needs.
                  An operator instruction, if given, is the first thing here.
Key files       — paths and symbols that cost tool calls to rediscover.
Open questions  — decisions waiting on the operator, and what each blocks.
Plan            — the current task list, as it stands.
Pointers        — ATLAS_CONTEXT_DIR, the plan file, any document the work depends on.
Do not retry    — dead ends and rejected approaches, with the reason.
```

Rules in the prompt: exact identifiers only, never invent, name credentials by where they live and
never reproduce them, and reply with the brief alone. The v1 framing line stays: the agent wakes with
only this brief, so anything it needs must be here.

The session's own model writes the brief, not `ESettingId.CompactionModel`. The model that continues
must be told what it needs in its own terms, and the compaction role exists for lossy compression.

### 5.7 Auto-rotation: the setting and the trigger

**The setting.** In the core settings registry, beside the auto-compaction row:

```ts
// packages/core/src/settings/registry.ts:47 — the id
AutoRotate = 'context.autoRotate',

// packages/core/src/settings/registry.ts:330-345 — the row, immediately after AutoCompact
{
  id: ESettingId.AutoRotate,
  page: ESettingPage.General,
  group: 'Context window',
  label: 'Rotate the context automatically at',
  description:
    'How full the context window may get before Atlas rotates the thread by itself: one model call writes a handoff brief, a marker goes into the transcript, and the next turn starts from the brief. It checks when a turn ends, so a turn is never interrupted. Set to zero to rotate only when you ask with /rotate. Rotation is the v2 safety net; a summary of the old turns is the manual /summarise.',
  environmentVariable: 'ATLAS_AUTO_ROTATE',
  kind: ESettingKind.Range,
  fallback: 85,
  minimum: 0,
  maximum: 100,
  step: 5,
  unit: '%',
},
```

**On/off plus the percent is one control.** Zero is off, which is the shape the neighbouring
auto-compaction row already teaches (`registry.ts:330-345`, and `AUTO_COMPACT_OFF` in
`packages/core/src/budget/auto-compact.ts:3`). A separate toggle beside a percent would let the two
disagree, and it would add a second row that means the same thing.

**The default is 85.** The handoff call reads the transcript inside the window it measures, so the
threshold must leave room for that call. At 95 the call most likely to fail is the one that rescues
the session. 85 leaves about a dozen turns of headroom at typical turn sizes and still fires long
before the hard limit.

**The decision is pure**, a sibling of the existing one:

```ts
// packages/core/src/budget/auto-rotate.ts
export const AUTO_ROTATE_OFF = 0

export enum EAutoRotate {
  Hold = 'hold',
  AtTurnEnd = 'at-turn-end',
}

export function autoRotateAfterTurn(args: {
  used: number | null
  window: number | null
  atPercent: number
}): EAutoRotate {
  const { used, window, atPercent } = args
  if (atPercent <= AUTO_ROTATE_OFF) return EAutoRotate.Hold
  if (used === null || window === null || window <= 0) return EAutoRotate.Hold
  return contextPressure({ used, window }).percent >= atPercent
    ? EAutoRotate.AtTurnEnd
    : EAutoRotate.Hold
}
```

**The trigger sits where the v2 turn ends**, on the host, once, for every surface:
- `HeldSession` already owns the turn-end hook: `this.turns.onTurnEnd = () => {…}`
  (`packages/host/src/holder/held-session.ts:65-68`), fired at the end of `HeldTurns.drive`
  (`packages/host/src/holder/held-turns.ts:100-107`).
- New module `packages/host/src/holder/rotation.ts`, class `HeldRotation`, with one method
  `maybeAutoRotate()`. It:
  1. reads the meter by folding the existing pure code over the record:
     `meterOf(record.eventCache().eventsAfter(0).reduce(stepMeter, initialMeterState))`
     (`packages/core/src/record/views/meter-state.ts:37-73`);
  2. calls `autoRotateAfterTurn({ used: meter?.used ?? null, window: meter?.window ?? null,
     atPercent })`;
  3. on `AtTurnEnd`, calls the same `rotateNow` the command calls, with
     `auto: { percent }` and `model` from the live runtime.
- The percent arrives per session: `AgentHostConfig` gains
  `rotation: { autoRotateAtPercent: number }`, filled in `ConfigReader.read` from the settings map
  (`apps/api/src/agent/config/config-reader.ts:67-105`, beside `quality: qualityConfigOf({settings})`
  at `:88`) with `readOf(settings)(ESettingId.AutoRotate)` and the registry fallback. The runtime
  factory (`apps/api/src/agent/runtime/session-runtime-factory.ts`) copies it onto the runtime as
  `rotation`, a new field on `SessionRuntime` (`packages/host/src/holder/ports.ts`, beside `skills`
  and `classifier`). `HeldSession` reads `this.runtime?.rotation.autoRotateAtPercent`.
- No hard stop at 100%. If the handoff keeps failing, the turn is already finished, the refusal is
  in the log, and the operator decides. A silent stop would be a new failure mode.

`context.autoCompact` stays in the registry for v1 (its TUI reads it,
`apps/tui/src/composition/settings-preferences.ts:54-58`). On v2 nothing reads it, and this slice
does not delete it.

### 5.8 The transcript row

The fact is one event, so each surface renders one row. No session-view field, no second read, no
special API.
- **Client fold** (shared): `packages/client/src/transcript/notice-entries.ts:142-156` becomes the
  new shape — `text` is `context rotated here`, plus `at 86% of the window` when `event.auto` is
  set; the entry carries `handoff` and `instructions` instead of `predecessor` and `handoffPath`.
  `RotatedEntry` follows (`packages/client/src/transcript/transcript-model.ts:224-231`).
- **Web**: `apps/web/src/features/threads/data/transcript-items.ts` maps entries to rows in
  `textItemOf` (`:126-196`); add `case EEntryKind.Rotated` → a new `ETranscriptKind.Rotation` row,
  and a component `apps/web/src/features/sessions/rotation-divider.tsx`: a full-width rule, the
  label and time, and the brief in a collapsible card, collapsed by default, opened by the button.
- **TUI**: `apps/tui/src/ui/components/rotated-divider.tsx` takes the handoff and the time instead
  of `predecessor`/`handoffPath`; `entry-view.tsx:322-330` passes them. The TUI lists `/rotate` when
  slice 9 adds its text layer; the row works before that.
- **Mobile**: no change — `apps/mobile/src/thread/notice-fields.ts:26-35` renders `entry.text` and
  an empty body, and the brief is not needed in the phone feed.
- **Above and below the rule**: nothing changes. Rows before the boundary stay where they are and
  stay scrollable. The composer binds to the thread, which is the same thread.

### 5.9 What carries over

| Thing                                                        | Carries?               | Why                                                                                                    |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Session, thread, title, project, sandbox, model, credentials | Yes                    | Untouched; rotate writes one event                                                                     |
| Repo clone, worktree, branch, uncommitted files              | Yes                    | Pod-owned and keyed by session                                                                         |
| Task list (plan)                                             | Yes, through the brief | The brief states it; the plan view still folds the whole log (`packages/core/src/plan/from-events.ts`) |
| Spend rows                                                   | Yes                    | Spend folds the whole log                                                                              |
| Subscriptions (PRs, CI)                                      | Yes                    | Session-scoped rows; their events land after the boundary and reach the model                          |
| Running shells, services                                     | Yes                    | Pod processes are keyed by session; their endings are new events, so the model sees them               |
| Sub-agents                                                   | Not while running      | Refused. Ended children are in the brief                                                               |
| Messages, tool calls, results, thinking before the boundary  | No                     | That is the point                                                                                      |
| Context meter reading                                        | No                     | Reset from the projection, window kept                                                                 |
| Failure message                                              | No                     | `failure` is derived from the visible tail; a new turn clears it                                       |
| Queued inbox entries                                         | Yes                    | Consumed by the same thread, after the boundary                                                        |
| Long tool output and blobs                                   | Stays on disk          | The brief names the path, never the bytes                                                              |

## 6. Slices

Five slices. 1 is pure. 2 needs 1. 3 needs 1 and 2. 4 needs 1 and applies to every surface. 5 is
docs.

**Slice 1 — `core`: the boundary, the projection, the meter, the setting (pure).**
Files: `packages/core/src/events/body.ts` (`rotated` shape), `packages/core/src/events/schema.ts`
(the literal), new `packages/core/src/record/rotation.ts`, new
`packages/core/src/assembly/rules/rotated-handoff.ts`, `packages/core/src/assembly/pipeline.ts`
(register the rule after `messagesFromEvents()`), `packages/core/src/record/views/meter-state.ts`
(`rotated` resets, in both `stepMeter` and `withEntry`), new
`packages/core/src/budget/auto-rotate.ts`, `packages/core/src/settings/registry.ts` (id and row),
plus the two fixtures that spell the old shape
(`packages/core/src/events/__tests__/schema.spec.ts:98-100,349`,
`packages/core/src/assembly/__tests__/envelope-coverage.spec.ts:118`).
Proof: `bun test` in `packages/core`.

**Slice 2 — `commands/rotate`: the command and the prompt.**
Files: `commands/src/rotate/{spec.ts,prompt.ts,pod.ts}`, `commands/src/rotate/__tests__/`,
`commands/src/index.ts` (add to `nativeCommands` and `nativeCommandHandlers`),
`packages/commands/src/pod.ts` (`runningChildren()` on `CommandContext`),
`packages/commands/src/__tests__/surface.spec.ts` (every surface lists `rotate`; no profile hides or
picks it), `docs/v2/slices/slash-commands.md` §4.2 table note and §4.6 dropped list.
Proof: `bun test` in `commands` and `packages/commands`.

**Slice 3 — `host` and the API: project, then rotate (needs 1, 2).**
Files: `packages/host/src/holder/record/record-adapter.ts` (`read` returns `projectedEvents`), new
`packages/host/src/holder/rotation.ts`, `packages/host/src/holder/held-session.ts` (construct it,
call `maybeAutoRotate()` from the existing turn-end hook), `packages/host/src/holder/inbox-intake.ts`
- `command-intake.ts` (`childrenRunning`), `packages/host/src/holder/ports.ts`
  (`SessionRuntime.rotation`), `apps/api/src/agent/config/{agent-host-config.ts,config-reader.ts}`,
  `apps/api/src/agent/runtime/session-runtime-factory.ts`.
  Proof: `bun test` in `packages/host`; `bun run typecheck` for `apps/api`.

**Slice 4 — the divider on every surface (needs 1).**
Files: `packages/client/src/transcript/{notice-entries.ts,transcript-model.ts}` and its fixture and
`__tests__/rotated-divider.spec.ts`; `apps/tui/src/ui/components/{rotated-divider.tsx,entry-view.tsx}`;
`apps/web/src/features/threads/data/transcript-items.ts` (+ `transcript-kind.ts`),
new `apps/web/src/features/sessions/rotation-divider.tsx`.
Proof: `bun test` in `packages/client` and `apps/web`; TUI typecheck.

**Slice 5 — docs.** `docs/v2/slices/rotate.md` with the as-built table, the `docs/v2/roadmap.md`
entry, and the removal of `/rotate` from the dropped list in
`docs/v2/slices/slash-commands.md:§4.6`.

Integration owner: this thread, for slices 1–4. Each slice is one PR that leaves `main` working.

## 7. Test plan

| Layer               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure (`core`)       | `rotated` decodes from raw, rejects an empty `handoff`, and accepts `auto` with a percent; `latestRotationOf` returns the last one; `projectedEvents` returns the whole log with no boundary, the boundary and its tail with one, and only the later tail with two; `rotatedHandoff` prepends the brief once and drops no message after the boundary; `meterOf` after a `rotated` returns `{ used: null, window }` and `rebuildMeter` agrees; `autoRotateAfterTurn` holds at 0, holds under the threshold, rotates at it, holds on a null reading and on a zero window |
| Commands            | the handler refuses with each sentence, including "A sub-agent is still running"; it appends no `rotated` and only a refusal on failure; on success it appends exactly one `rotated` with the brief; a second run with no new events refuses; the instruction reaches the prompt; the model receives the transcript since the previous boundary                                                                                                                                                                                                                        |
| `packages/commands` | `rotate` is `runsIn: 'host'`, is in `byInboxKind`, appears in `catalogueForSurface` for all four surfaces, and is neither hidden nor picked anywhere                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Host                | `read()` returns the projection and `composedEvents()` still returns the whole log; a turn after a rotation assembles from the boundary; a rewind past the boundary restores the whole log; `childrenRunning` reaches the context; auto-rotation fires at the threshold once, not below, and not when the setting is 0; a failed auto-rotation leaves the turn finished and one refusal in the log                                                                                                                                                                     |
| Client              | the `rotated` event becomes one `Rotated` entry with the brief and the auto copy, at its timeline position; the entry keeps the new fields                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Web                 | the divider renders with the rule, the time and the brief; the brief opens; the transcript above the divider still scrolls; the composer still posts to the same thread                                                                                                                                                                                                                                                                                                                                                                                                |
| TUI                 | the divider renders from the new fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Live                | §8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 8. Live check

One production v2 session on the atlas project, model `claude-opus-5-5`, on the build that carries
slice 4.
1. Send two messages that create a real task ("find why X fails, fix it, run the test"). Confirm the
   plan appears and the meter reads a number.
2. `POST /v1/trpc/sessions.command` with `{ sessionId, name: 'rotate', args: {} }`. Expect
   `{ inboxId }` and no refusal.
3. In the transcript: a divider at the boundary, the brief card, every earlier row still above it,
   the meter empty, spend rows unchanged. The thread id in the session row is the same.
4. Send one message. The reply shows the agent knows the task, the files and the plan without
   reading them again. The meter reads again. The plan panel still shows the list.
5. Start a sub-agent, and run `/rotate` while it works: the refusal appears above the composer and
   the log gains no `rotated` event.
6. Run `/summarise` after a rotation, on the new tail: it summarises only the post-boundary range,
   and the boundary divider stays where it is.
7. Set `context.autoRotate = 40` on a scratch session, run two turns: the second turn ends and the
   session rotates by itself; the divider reads `rotated automatically at N% of the window`.
8. Kill the host during a rotation (a staging build that stops between `input-consumed` and the
   append). Wake the session: the rotation completes once, the transcript holds exactly one
   divider, and PostHog shows one handoff model call for it.
9. Reload the page: the divider and the brief come back from the log, and the composer still posts
   to the same thread.

Record the results in `evidence/` with the request and response lines and one screenshot.

## 9. Out of scope

- Threads, forks and successors. There is no second thread to create, follow, retire or migrate.
- Migrating or deleting the v1 rotation, serve rotation, compaction requests or the API's
  `threads-history` compaction. v1 is deleted when v2 is stable.
- Truncating, archiving or deleting the log before a boundary. Retention is a storage-policy
  question (architecture P5); the log is the audit trail.
- Writing the brief to a file in the workspace. The event is the record; a file is a second truth.
- `/compact` as a manual command, and any change to the summariser.
- Rotating a sub-agent thread. Only the main thread rotates.
- Re-parenting live sub-agents or teammates across a boundary.
- Rotation of the pod, the sandbox or the workspace. v1's `EClientRequest.Rotate` was a context
  rotation; the pod rotate in `apps/api` is unrelated.
- Cross-session handoff (teammates, session links).
- A header control for rotate on web. The command is in the slash menu on every surface; a second
  affordance is a second path to the same call.

## 10. Question for Dennis (answered)

Settled 2026-11-23: auto-rotate replaces the auto-compact row in settings. `context.autoCompact`
is deleted with v1, because the TUI becomes a v2 client, so no per-surface setting field was added.
The original question follows.

One question. Everything else above is decided and can be changed at one seam.

**Q1. On v2, does the auto-rotate row replace the auto-compact row in settings?**
Recommendation: yes — show `context.autoRotate` on the v2 settings page and hide the
`context.autoCompact` row there, while both stay in the registry because v1's TUI reads the second
one. v2 has no compaction trigger at all (`packages/host` has no caller of `autoCompactAfterTurn`),
so today the row describes something the surface cannot do, which the settings rule forbids. The
risk of the alternative — showing both — is an operator who sets 90 there, 85 here, and cannot tell
which one acted. The mechanism question this raises: `ESettingDefinition` has `visibleWhen` for
conditional rows but no per-surface filter, so either a small `surfaces` field is added to the
setting definition or the web settings page filters by id. I recommend the `surfaces` field.

## 11. As built

| Slice     | PR    | Differences from the spec                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 core    | #2607 | The brief envelope opens with the "you wake with only this brief" preface. `context.autoRotate` is also in the cloud setting registry (`harness-settings.ts`). `COMMAND_OUTCOMES.rotate = ['rotated']`, so a consumed `/rotate` is replayed after a takeover.                                                                                                                                                            |
| 2 command | #2644 | The exactly-once guard ignores `rotated` and `history-compacted` after the boundary, so a replay with no new work refuses with "This thread has nothing since the last rotation."                                                                                                                                                                                                                                        |
| 4 divider | #2645 | The client entry carries `handoff` and `instructions`. The percent lives only in `text`. The web row is its own turn kind and takes its time from the row stamps. The web settings row `context.autoCompact` is now `context.autoRotate` (`apps/web/src/features/settings/fixtures/settings-fields.ts`).                                                                                                                 |
| 3 host    | #2650 | A failed auto-rotation is logged (`holder.rotation`) and not appended as `input-refused`, because that body needs an `inboxId`. `HeldTurns` awaits the turn-end hook before the next input drains. The fault scenario `handoff-rotate.fault.spec.ts` found that a draining host dropped a consumed command that owed an outcome. `HeldDrain` now asks for a holder in that case, for rotate, rewind and summarise alike. |
| fix       | #2668 | Found by the live check: `/summarise` after `/rotate` hid the `rotated` event and summarised across it. Now `rotated` is `Keep`, and `summaryTargetOf` and `summaryPointsOf` start after the latest boundary.                                                                                                                                                                                                            |

Live check on production, 2026-11-23, main `2fab56ad4` and then `eb0fb54a8`:
- Steps 1–5, 7 and 9 pass. A rotation landed at seq 57 with a correct brief. The next turn named the files and the plan with no tool call. A rotate during a sub-agent was refused with the sentence. The web divider and the brief survive a reload.
- Step 7 used a 5 % threshold, because the window is 1,000,000 tokens. It rotated at 10 %, and the divider reads `rotated automatically at 10% of the window`.
- Step 6 failed on `2fab56ad4`. After #2668 (`eb0fb54a8`) it passes: `history-summarised {fromSeq: 40, throughSeq: 49}` after a `rotated` at seq 37, and the divider stays visible.
- Step 8 is covered by the fault scenario (drain, SIGKILL, pod restart, exactly once), not run live.
