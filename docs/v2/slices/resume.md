# Slice spec: resume a stopped turn

> **Dennis's rules, 2026-11-23.** A clean stop resumes invisibly: the partial step is discarded and
> the turn runs again with nothing new in the model's context. A stop during a tool resumes with one
> nudge saying the operator chose to resume. A stop followed by a typed message is a normal prompt
> and ends resumability. `/resume` takes no free text. Fork is dropped and appears nowhere here.

Status: **built, 2026-11-23**, live check outstanding (Dennis approved it the same day). Anchors are
`path:line` at `251b18d54` (origin/main, 2026-11-23). Re-check an anchor before relying on it. §11.1
records how it was built and every place the code left this spec.

Prior art: [slash-commands.md](slash-commands.md) is the command contract this file spends, and
[rotate.md](rotate.md) is the most recent host command and the shape this file copies. Decision on
the host command path: [06-commands.md](06-commands.md). [tui.md](tui.md) §2.2 already carries the
row "Message, stop or resume a sub-agent — **No v2 route.** Slice 8" (`docs/v2/slices/tui.md:128`).

## 0. One line

A stop is undoable without the model ever learning it happened. Resume appends one `resume-marked`
event: it names the rows of the cut step that the model must not see, and it is itself the turn the
holder then runs. When a tool was in flight the same event carries one sentence instead of silence.

## 1. Product contract

Four situations, one rule each.

| The operator                           | What the model reads on the next request                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Stop, then Resume, nothing was running | Nothing about the stop. The cut step is gone from the context and the step runs again. |
| Stop during a tool, then Resume        | The interrupted tool result as today, plus one sentence: the operator chose to resume. |
| Stop, then type a message              | A normal prompt. No resume, no resume sentence. The message ends resumability.         |
| Stop and do nothing                    | Nothing. The session sleeps; no wake, notice, takeover or deploy restarts it.          |

**The use case.** Stop the turn, resize the pod, resume. The agent must never see the pause, so a
resize is not a change of task and costs no context.

**Invisible means invisible.** A clean resume appends no text the model reads: the model's message
list after the resume is the message list it had before the cut step. The transcript still shows the
cut reply and the `Stopped` line, because the operator stopped it and that fact is theirs.

**What stays settled.** A tool that was in flight is never silently repeated. Its result stays
recorded as interrupted, so the model may re-issue it after the rule-2 sentence, deliberately.
Calls of the cut step that never ran stay recorded as not run, and those are discarded with the step.

**What the operator keeps.** The `Stopped` line in the transcript, `/resume` as the command on every
surface, and `/sessions` as the TUI's session picker (`/resume` no longer opens it, §7).

## 2. Prior art: v1

v1 had two resume paths and the second one is this design.

**v1 classified the situation with one pure function.** `resumePlan(events)`
(`packages/core/src/events/resume-plan.ts:49-70`), in order: blocked on an outstanding approval, then
on a parked call, then `Continue` when a tool call is owed a result, then `Continue{nudge}` when the
last turn-taking event is not the assistant's reply, then `Nudge` when the last assistant row is
`interrupted`. `isResumable` is `Continue` or `Nudge` (`:86-87`). A stop leaves
`assistant-said{interrupted: true}` plus `tool-denied{interrupted: true}` for the calls of the cut
step (`packages/agent-v1/src/loop/step-drafts.ts:63-79`).

**v1's resume-in-place.** `nudgeDraftsFor` appends one `nudge` carrying `RESUME_NUDGE`
(`packages/core/src/events/resume-plan.ts:11-12`, `:75-79`): "You were interrupted mid-turn …
If a tool call was cut short, run it again." That text is true of a host crash and false of a stop,
which is why v2 keeps it for crashes only (§6.3). The TUI bound it to `ERunRemedy.Resume` →
`handleResume`, which re-reads the log, re-checks `isResumable(fresh)` and drives `{resume: true}`
(`apps/tui/src/composition/use-run-attention.ts:81`,
`apps/tui/src/composition/use-turn-driver.ts:96-107`), under the strip "The run stopped before
finishing / Resume continues from the last finished step; nothing is rerun."
(`packages/client/src/transcript/run-attention.ts:39-40`, built at `:88-99`).

**v1's smart path: discard the cut step, then run it again.** `handleResumeFresh` →
`resumeFresh(true)` → `discardInterrupted` (`apps/tui/src/composition/use-turn-driver.ts:109-154`).
`discardInterrupted` reads `resumePlan`, refuses unless it is `Nudge`, and rewinds to
`plan.interrupted.seq - 1`, which erases the cut reply and the calls that never ran; then the driver
runs a plain turn with no nudge at all, so **the model never learns about the stop**
(`apps/tui/src/composition/resume-turn.ts:28-55`, `EDiscard` at `:12-18`). The rewind is what makes
it invisible, and it is also v1's weakness: it is a history edit, it needs a confirmation when it
would kill shells, services or sub-agents (`use-turn-driver.ts:119-131`), and it erases the rows from
the transcript too. v1 also called it on open, to recover a thread that had been left mid-turn
(`apps/tui/src/composition/use-conversation-resume.ts:22-30`).

**Where v2 follows v1.**
- The classification is one pure function over the log, before any surface decides anything.
- A cut reply with nothing running is discarded and re-run, not nudged.
- A tool that was in flight stays interrupted and is never repeated automatically; the model is told
  to check before repeating it (`packages/agent/src/loop/dispatch-recovery.ts:16-26`).

**Where v2 differs.**
- The discard is not a rewind. v1 edited history; v2 appends a marker that the model's context
  honours and the transcript ignores, so there is no confirmation dialog, nothing is killed, and the
  operator keeps the `Stopped` line (§5).
- The nudge text is per cause, not one text for both. `RESUME_NUDGE` stays for a host crash; a stop
  gets silence or the one rule-2 sentence (§6.3).
- v1's two paths were reachable from two different buttons (`Resume` and, later, `/resume`). v2 has
  one command, and the command picks the path from the log.

## 3. What exists today in v2

**The stop guard is right and stays.** `resumePlanOf(state)` is v1's plan over the loop state, and
its first line after the empty check is `if (state.stoppedSincePrompt) return { kind: EResume.Nothing }`
(`packages/core/src/record/loop-state.ts:229-244`). `stoppedSincePrompt` is set by the only writer
that knows the abort was a stop: `interruptedDrafts({ stopped: true })`
(`packages/agent/src/loop/step-drafts.ts:104-126`) called with
`stopped: abortSignal.reason === OPERATOR_STOP_REASON` (`packages/agent/src/loop/tracked-turn.ts:265-274`),
and the fold reads it at `packages/core/src/record/loop-state.ts:119-133`. That guard is what keeps a
stopped session from restarting by itself; this slice adds a second way in, it does not open the first.

**What a stop leaves in the log,** in order: `assistant-said{interrupted: true, stopped: true}` with
whatever text had streamed, one `tool-called` + `tool-denied{interrupted: true}` per call of the
abandoned step (`packages/agent/src/loop/step-drafts.ts:104-126`), `input-consumed{consumed: stop}`
(`packages/host/src/holder/held-wait.ts:10-41`), and `turn-ended{outcome: stopped, by: operator}`
(`packages/host/src/holder/turn-boundary.ts:15-25,60-63`; closed by
`packages/host/src/holder/held-actions.ts:138-147` when no turn ran). A tool that was dispatched when
the signal aborted settles as `tool-result{interrupted: true}` from the dispatch itself
(`packages/agent/src/tools/dispatch.ts:255-266`); a call whose process died settles on the next
takeover through `settleCrashedCalls` (`packages/agent/src/loop/dispatch-recovery.ts:28-46`, called at
`packages/host/src/holder/held-runner.ts:66-84`).

**The turn-entry plumbing exists end to end.** `TurnRunner.resume` appends the resume drafts and runs
a traced turn with `entry: Resume` (`packages/agent/src/loop/run-turn.ts:133-156`), through
`appendResumeDrafts` → `resumeDraftsOf(state)` (`packages/agent/src/loop/resume-turn.ts:13-34`). The
holder drives it as `HeldTurns.drive({resume: true})` (`packages/host/src/holder/held-turns.ts:100-125`).

**The holder already waits for a resumable thread and releases a stopped one.** `resumable` is
`isResumableOf(state) && !stopSettledPromptOf(events) && !repairHeld`
(`packages/host/src/holder/held-needs-holder.ts:76`), where `stopSettledPromptOf` is "a stop was
consumed after the last prompt" and counts `user-said` and `nudge` as prompts
(`packages/host/src/holder/held-inbox.ts:128-138`). `decideHeldAction` turns `resumable` into
`StartTurn` (`packages/core/src/execution/held-session-decision.ts:29-55`). `drainWantsHolder` returns
false for a stopped session with nothing pending, so the pod releases its holder and the session
sleeps.

**The context the model reads is assembled from loop events, in core.** `messagesFromEvents` walks the
thread's events once (`packages/core/src/assembly/rules/messages-from-events.ts:168-190`) and is fed
`visibleLoopEvents` (`packages/core/src/record/loop-events.ts:27`) through
`record.composedEvents` (`packages/host/src/holder/record/record-adapter.ts:119-121`). Visibility is a
pure fold over `history-rewound` and `history-summarised` (`packages/core/src/record/visibility.ts:18-45`).

**A stopped reply is already marked for the model, and it stays for rule 3.** A stopped
`assistant-said` contributes its spoken parts only, followed by one user notice "The operator stopped
your previous reply here." (`packages/core/src/assembly/rules/messages-from-events.ts:196-208`,
`packages/core/src/assembly/rules/operator-stop-block.ts:5-11`). That notice is right when the
operator types a message after the stop (rule 3) and is exactly the text rule 1 forbids after a
resume, so a discarded step must take its notice with it (§5).

**The crew slot has no resume.** `PodCrew` is spawn, say, stop, list, report
(`packages/plugin-sdk/src/crew.ts:23-35`). A child stopped by the model's `agent_stop` aborts with
reason `'agent_stop'` (`packages/host/src/holder/crew/child-run.ts:178-182`), so it ends
`interrupted`, and `childResumeAllowed` is false because `isResumableOf` sees `stoppedSincePrompt: false`
but no owed reply — the ending ended the turn (`packages/host/src/holder/crew/child-repair.ts:5-15`).
`continueTurn` drives `{restart: true}` once a turn has ended
(`packages/host/src/holder/crew/child-run.ts:170-176`), and `firstTurn` maps `restart` to a plain
`runTurn` (`packages/host/src/holder/crew/child-turns.ts:10-35`). There is no v2 route from any surface
to a stopped child (`docs/v2/slices/tui.md:128`).

**The surfaces today.** Web draws a stopped reply as a quiet `Stopped` marker under the message
(`apps/web/src/features/threads/transcript/stopped-line.tsx:6-16`) and offers no action. The TUI's v2
client binds `ERunRemedy.Resume` to `api.retry({sessionId})` (`apps/tui/src/app/use-run-attention.ts:68`),
which cannot fire after a v2 stop because a stop resolves to `EResume.Nothing`. Mobile has no stopped
line (`apps/mobile/src/thread/notice-fields.ts`).

## 4. The resume point, from the log alone

New pure module, `packages/core/src/record/resume-point.ts`. It folds the thread's visible events —
the same rows the transcript shows — and answers what an explicit resume would continue from. No
clock, no host, no inbox read.

```ts
export enum EResumePoint {
  Clean = 'clean',
  ToolInterrupted = 'tool-interrupted',
  NotResumable = 'not-resumable',
}

export type ResumeDiscard = { fromSeq: number; throughSeq: number }

export type ResumePoint =
  | { kind: EResumePoint.Clean; discard: ResumeDiscard | null }
  | { kind: EResumePoint.ToolInterrupted; callIds: readonly string[] }
  | { kind: EResumePoint.NotResumable; because: string }

export function resumePointOf(input: { events: readonly V2Event[] }): ResumePoint
```

Rules, in order. Each is a fact in the log, so two surfaces cannot disagree about whether a turn can
be resumed.
1. **A turn is open** (`openTurnOf(events) !== null`, `packages/core/src/record/turns.ts:59-66`) →
   `NotResumable('A turn is running; stop it first.')`. A resume would race it. This also refuses a
   turn the automatic drain has already started.
2. **An approval is outstanding** → `NotResumable(APPROVAL_WAITING)`; **a call is parked** →
   `NotResumable(TOOL_PARKED_WAITING)`. The v1 sentences, unchanged
   (`packages/core/src/events/resume-plan.ts:16-20`).
3. **No visible `turn-ended`** → `NotResumable('There is no stopped turn to resume.')`. A rewind or a
   summary that covers the stop lands here, because those rows leave the visible log.
4. **The last `turn-ended` is `completed`** → `NotResumable('The last turn finished; send a message to
   continue.')`.
5. **… is `failed`** → `NotResumable('The last turn failed; retry it.')`. A failure is retry's
   question, not resume's (§8).
6. **A `user-said` follows that ending** → `NotResumable('A message follows the stop; the turn
   continues from it.')`. The ordinary prompt path owns the turn, and it needs no resume.
7. **A `resume-marked` follows that ending** → `NotResumable('This turn has already been resumed.')`.
   The exactly-once rule, read off the log instead of a boolean.
8. **The ending is `stopped` or `interrupted`**, and nothing above refused:
   a. a `tool-result{interrupted: true}` or an unsettled `tool-called` since the last `turn-started`
   → `ToolInterrupted` with those call ids, in log order. A tool was in flight.
   b. else an `assistant-said{interrupted: true}` since the last `turn-started` → `Clean` with
   `discard` = that row through the last `tool-called`/`tool-denied` row of the same step. The
   step was cut while the model was speaking.
   c. else → `Clean` with `discard: null`. The stop landed between steps, or before a part arrived.
9. Otherwise → `NotResumable('There is no stopped turn to resume.')`.

`resumableOf(point)` is `point.kind !== EResumePoint.NotResumable`. Every surface uses it, and every
refusal sentence comes from core, so no surface writes its own copy.

### 4.1 The decision table

Each row is one `resumePointOf` case and one spec in `packages/core`. The core spec asserts these rows
in this order.

| #   | Situation                                            | The log                                                                                      | `resumePointOf`                                                     | After the resume the model reads                         |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Stop while streaming text, no tool calls in the step | `assistant-said{interrupted, stopped}` with parts, `turn-ended{stopped, operator}`           | `Clean`, discard = that row                                         | Nothing about the stop; the step runs again              |
| 2   | Stop while thinking, nothing had arrived yet         | `turn-ended{stopped, operator}` with no step rows                                            | `Clean`, discard `null`                                             | Nothing about the stop                                   |
| 3   | Stop between steps                                   | as row 2                                                                                     | `Clean`, discard `null`                                             | Nothing about the stop                                   |
| 4   | Stop during one tool                                 | `tool-result{interrupted: true}` for the call                                                | `ToolInterrupted`, that id                                          | The interrupted result, then the one sentence            |
| 5   | Stop during parallel tools, some finished            | the finished results, plus `tool-result{interrupted: true}` for the rest                     | `ToolInterrupted`, the interrupted ids only                         | The finished results, the interrupted ones, one sentence |
| 6   | Stop during a sub-agent's tool                       | the parent's `agent_*` call settles `interrupted`; the child's own thread keeps its own rows | parent `ToolInterrupted`; the child's thread decides by its own log | parent: one sentence; the child: its own case            |
| 7   | Stop, then a message                                 | `user-said` after the ending                                                                 | `NotResumable('A message follows the stop…')`                       | A normal prompt                                          |
| 8   | Stop, then rewind past it                            | `history-rewound` hides the stop; no visible ending                                          | `NotResumable('There is no stopped turn…')`                         | unchanged                                                |
| 9   | Stop, then summarise over it                         | `history-summarised` hides the stop                                                          | `NotResumable`, as row 8                                            | unchanged                                                |
| 10  | Stop, then rotate                                    | `rotated` after the stop; the stop row stays visible                                         | as rows 1–6                                                         | the brief, then the discarded step is still absent       |
| 11  | A completed turn                                     | `turn-ended{completed}`                                                                      | `NotResumable('The last turn finished…')`                           | unchanged                                                |
| 12  | A failed run                                         | `turn-ended{failed}`                                                                         | `NotResumable('The last turn failed; retry it.')`                   | unchanged                                                |
| 13  | Resuming twice                                       | `resume-marked` after the ending                                                             | `NotResumable('This turn has already been resumed.')`               | unchanged                                                |
| 14  | Resume while a turn runs                             | open `turn-started`                                                                          | `NotResumable('A turn is running; stop it first.')`                 | unchanged                                                |

A `/rotate` after a stop does not end resumability, deliberately (row 10). Rotation cuts the model's
window, not the thread's state (`packages/core/src/record/rotation.ts`), and the marker lands after
the boundary, so the model reads the brief and then continues with the discarded step still discarded.

## 5. Discarding the cut step on an append-only log

**The log never loses an event.** Append is the only write (`packages/control/src/append-ops.ts:135`
steps visibility on append; there is no delete). So the discard cannot be a removal, and it must not
be a rewind either: a rewind would also hide the rows from the operator, which is the one thing rule 1
keeps.

**The host appends one marker, and context assembly honours it.** `resume-marked` carries the ranges
it hides. `messagesFromEvents` reads every marker in the thread before its walk and skips any event
whose seq is inside a range (`packages/core/src/assembly/rules/messages-from-events.ts:189-190` is the
one place to add the skip). Three consequences, all wanted:
- The cut `assistant-said` and its operator-stop notice disappear together, because the notice is
  emitted in the same iteration as the row (`:196-208`).
- The `tool-called`/`tool-denied` rows of the cut step disappear with it, so no call is left orphaned
  in the message list.
- Every other consumer still sees the rows: `record.composedEvents` returns them, `loopStateOf` folds
  them, the transcript client folds its own window without knowing the marker
  (`packages/client/src/stream/session-window.ts:132-142`). The model's message list is the only view
  that changes.

**Why not the existing visibility fold.** `stepVisibility` (`packages/core/src/record/visibility.ts:18-45`)
is shared by the model and every transcript. A span added there would hide the step from the operator
too, which is a rewind by another name. Keeping the marker in the assembly rule is what lets the two
views disagree on purpose.

**Durability.** `resume-marked` is `false` in `EVENT_DURABILITY`
(`packages/core/src/record/durability.ts`), like `history-rewound`: a rewind or a summary that covers
it takes the discard with it, which is right, because the operator rewound past the whole episode.

**What the marker is not.** It is not a history edit: the transcript is unchanged, no rewind refuses,
nothing is killed. It is not a token: the ranges are seq numbers computed once by the command and
frozen in the log, so a later reader cannot recompute them differently.

## 6. What resume writes

### 6.1 The event

```ts
// packages/core/src/record/event.ts (RecordBody)
| {
    type: 'resume-marked'
    point: EResumePoint.Clean | EResumePoint.ToolInterrupted
    discards: readonly ResumeDiscard[]
    callIds: readonly string[]
    inboxId?: number | undefined
  }
```

One event covers both rules. It is turn-taking: add it to `isTurnTaking` and `isTurnTakingType`
(`packages/core/src/agents/kind.ts:13-60`), so `lastTurnType` is the marker and `awaitsReplyOf` is
true (`packages/core/src/record/loop-state.ts:205-208`). It is a prompt: add it to `promptPatch` beside
`nudge` (`packages/core/src/record/loop-state.ts:119-133`), clearing `cutShortSincePrompt` and
`stoppedSincePrompt`. And it is a prompt for the stop gate: add it to `stopSettledPromptOf`
(`packages/host/src/holder/held-inbox.ts:128-138`), or the holder keeps treating the thread as
stop-settled and never starts the turn.

That is the whole trigger. After the append, `isResumableOf(state)` is true, `decideHeldAction` returns
`StartTurn` (`packages/core/src/execution/held-session-decision.ts:29-55`), and `HeldTurns` drives
`{resume: true}` → `TurnRunner.resume` → `turn-started{cause: 'resume'}`. `resumeDraftsOf` then sees
`Continue{nudge: false}`, appends nothing, and the turn is resumed once however many times the decision
runs.

**Exactly once.** Three facts, no new boolean: the marker is the command's outcome event, so
`COMMAND_OUTCOMES.resume = ['resume-marked']` makes the existing replay re-run a consumed-but-unfinished
resume once and never twice (`packages/core/src/record/command-entries.ts:15-19`,
`packages/host/src/holder/recover-unfinished-commands.ts:18-31`); a second `/resume` refuses through
rule 7; and a host that dies after the append leaves the marker in the log, so the next holder's
ordinary decision pass runs the turn. This removes the `nudgedSincePrompt` field the first draft
needed.

### 6.2 The handler

```ts
// commands/src/resume/pod.ts
export async function resumeNow(args: {
  point: ResumePoint
  inboxId?: number | undefined
  append(drafts: readonly EventDraft[]): Promise<void>
}): Promise<CommandResult>
```

1. The caller re-reads the events at the moment of the command and passes the point; the handler never
   trusts a cached plan.
2. `NotResumable` → `{ kind: 'refused', reason: because }`. No marker.
3. Otherwise append one draft: `resumeMarkedDraft({ point, inboxId })`.
4. Return `{ kind: 'done' }`. The handler does not start the turn: the holder's next decision pass
   does, and a command that starts a turn would need its own crash story.

### 6.3 What the model reads, per cause

Two texts, and only one of them is new.

What is appended to the model's messages, by cause:
- `Clean`: nothing. No nudge, no notice, no marker text.
- `ToolInterrupted`: one user block, `RESUME_AFTER_INTERRUPTED_TOOL`.

```ts
// packages/core/src/events/resume-plan.ts, beside RESUME_NUDGE
export const RESUME_AFTER_INTERRUPTED_TOOL =
  'The operator chose to resume this turn after interrupting it. A tool call was cut off while it ran, so its result above says it was interrupted.'
```

`RESUME_NUDGE` (`packages/core/src/events/resume-plan.ts:11-12`) is untouched and stays the automatic
path's text for a host crash, where "run it again" is true. The interrupted call's own result already
says "its effects are unknown — check before repeating it"
(`packages/agent/src/loop/dispatch-recovery.ts:16-26`), so the sentence does not repeat that advice.

The model never reads the marker as a message; it is the reason the walk skips the ranges, and, when a
tool was cut, the reason one sentence is inserted at its seq.

### 6.4 What is repaired, and what is not

| Thing                                                | What resume does                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cut step's text and its calls that never ran     | Discarded from the model's context by the marker (§5). Still in the transcript.                                                                                                                                                       |
| A tool dispatched and left unsettled                 | Settled first as `tool-result{interrupted: true}` by `settleCrashedCalls`, which the takeover path already calls (`packages/host/src/holder/held-runner.ts:66-84`). It stays visible to the model, and is never re-run by the resume. |
| A completed tool result of the same parallel batch   | Kept. The model sees it.                                                                                                                                                                                                              |
| The context window                                   | Untouched. A resume is not a rotation; `/rotate` is the boundary and stays a separate command.                                                                                                                                        |
| Tool output on disk, shells, services, sub-agents    | Untouched. Nothing was interrupted by the stop of one turn.                                                                                                                                                                           |
| A sub-agent that was running when the parent stopped | Untouched. The stop ends the parent's turn; the child keeps running and reports into a thread whose turn ended.                                                                                                                       |

## 7. The command

### 7.1 One declaration, every surface

In the shape `slash-commands.md` §4.1 fixed and `rotate` proved.

```ts
// commands/src/resume/spec.ts
export const REFUSAL_RESUME_TEXT = 'Resume takes no text. Use /resume, or /resume --agent <id>.'

export const resumeArgs = z.strictObject({
  agentId: z.string().min(1).optional(),
})

export const resume = defineCommand({
  spec: {
    name: 'resume',
    summary: 'Resume a turn that was stopped before it finished',
    group: ECommandGroup.Session,
    argumentHint: '[--agent <id>]',
    args: resumeArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: resumeFromText,
  },
})
```

`fromText` reads `--agent <id>` as the target and refuses anything else that looks like text or an
unknown flag with `REFUSAL_RESUME_TEXT`: the words an operator types after a stop are a message, not a
resume instruction (rule 3), and a resume that carried words would be two features in one command.

Wire: `sessions.command { sessionId, name: 'resume', args }` → `postCommand`
(`apps/api/src/api/platform/control/command-registry.ts:35-66`) → one inbox entry of kind
`command:resume`, the same path `/rotate` takes. No new mutation, no new client action, no surface
table entry: `resume` is in no `hides` and no `picks` list (`packages/commands/src/surface.ts:22-33`),
so every surface lists it.

**`/resume` means one thing.** v1 keeps `/resume` as a TUI-local entry that opens the session picker
(`docs/v2/slices/tui.md:160`), and `slash-commands.md:424` lists `/resume` among the dropped v1
commands. A TUI-local entry is matched before the text is posted, so on the TUI both would answer
`/resume` and nothing in the contract would pick between them. The picker therefore moves to
`/sessions` in the TUI slice, and this file records the decision: in Atlas, `/resume` resumes the
stopped turn, on every surface.

### 7.2 How resume differs from retry

|           | retry (`sessions.retry`)                                                                                | resume (`sessions.command{name:'resume'}`)                         |
| --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Asks      | do this turn again, from its start                                                                      | continue this turn from where it stopped                           |
| Trigger   | a `run-failed` failure card, a failed workspace prepare                                                 | a stop nobody has continued, or a turn the host interrupted        |
| Event     | `INBOX_KIND_RETRY` (`packages/core/src/record/inbox.ts:4`)                                              | `resume-marked`                                                    |
| Sub-agent | `CrewRoom.retry` → `continueTurn({retry: true})` (`packages/host/src/holder/crew/crew-room.ts:108-113`) | `PodCrew.resume` → the marker, then `continueTurn({resume: true})` |
| Wording   | the failure's own remedy label                                                                          | `Resume`                                                           |

Slice 1 makes the boundary honest in code: `resumePointOf` refuses a `failed` ending with a sentence
that names retry. The gap that remains, and that this slice does not close: **after a failed
main-thread turn, `sessions.retry` reaches the workspace prepare and nothing else**, because
`resumePlanOf` returns `Nothing` for a finished step and `decideHeldAction` only uses `retryPending`
for a failed workspace (`packages/core/src/execution/held-session-decision.ts:24-27`). Whether retry
must re-run a failed turn is its own defect with its own live check; it is out of scope here so that
resume is not built on a path that only looks like it works.

## 8. Sub-agents

The slot gains one method, and nothing else about a sub-agent changes.

```ts
// packages/plugin-sdk/src/crew.ts:23-35
resume(args: { agentId: string }): Promise<EResumeOutcome>

// packages/core/src/agents/resume.ts — one enum both packages can name
export enum EResumeOutcome {
  Resumed = 'resumed',
  NotResumable = 'not-resumable',
  UnknownAgent = 'unknown-agent',
  Running = 'running',
}
```

`CrewRoom.resume` finds the run, computes `resumePointOf` over the child's own visible events, appends
the child's marker to the child's thread, and then calls `ChildRun.continueTurn({ resume: true })`
(`packages/host/src/holder/crew/crew-room.ts:108-113` is the neighbour to copy). That needs the child
lifecycle to keep the cause: `continueTurn` currently drives `{restart: true}` once a turn has ended
(`packages/host/src/holder/crew/child-run.ts:170-176`), and `firstTurn` maps `restart` to a plain
`runTurn`, which appends nothing (`packages/host/src/holder/crew/child-turns.ts:10-35`). The resume arm
must pass `{resume: true}` in both cases — the `DriveArgs` union already has the arm — so the child's
turn is started with `turn-started{cause: 'resume'}` on the child's own thread.

A child's own log decides, through the same `resumePointOf`: a child stopped by `agent_stop` ends
`interrupted` with an interrupted reply and no tool in flight, so it is a `Clean` resume, and the child
says nothing about the stop either. `childResumeAllowed`
(`packages/host/src/holder/crew/child-repair.ts:5-15`) then passes, because the marker cleared
`stoppedSincePrompt` and made `isResumableOf` true.

`CommandContext` (`packages/commands/src/pod.ts:3-12`) gains the two fields the handler needs:

```ts
crew?: { resume(args: { agentId: string }): Promise<EResumeOutcome> } | undefined
mainThreadId?: string | undefined
```

`mainThreadId` is how a handler tells "this thread" from a child: a command posted for the session
carries no thread, and a resume whose `agentId` is the session's main thread is a main-thread resume.
`InboxIntake` already knows both (`packages/host/src/holder/inbox-intake.ts:60-96`), and the crew is in
scope where the context is built (`packages/host/src/holder/command-intake.ts:224-240`).

## 9. The surfaces

### 9.1 Web

The affordance lives where the stopped turn already renders: the `Stopped` marker under the cut reply
(`apps/web/src/features/threads/transcript/stopped-line.tsx:6-16`). It becomes one row: the label, the
time, and a `Resume` button. Not the failure card: `sessionAttentionOf` reads `run-failed` only, and a
stop is not a failure.
- The transcript item gains `resume: ResumePoint | null`, computed once from `resumePointOf` in the
  fold that already builds the items, so the marker and the button cannot disagree.
- The button posts `sessions.command({ name: 'resume', args: {} })` through the same client call the
  command menu uses, shows `Resuming…`, disables itself while the entry is pending, and disappears
  once the fold says `NotResumable`. A refusal renders from the log through `RefusalRows`.
- The sub-agent pane's header gains the same `Resume` action for a stopped child, posting
  `{ name: 'resume', args: { agentId } }`. This is the first v2 surface action for a sub-agent.
- Mobile gets nothing: it has no stopped line to hang the action on. When it gets one, it reads the
  same `resumePointOf` and posts the same command.

### 9.2 The TUI

The v2 TUI already holds both the mapped transcript events and the raw v2 events, so its leg is small
and needs no new fold: `resumePointOf({ events: rawEvents })` decides, `handleResume` stops calling
`api.retry` and posts the command (`apps/tui/src/app/use-run-attention.ts:68` becomes a resume call;
`SessionApi` gains `command`, beside `retry` at `apps/tui/src/app/session-api.ts:76`), and the
`/resume` entry joins the composer menu from the shared catalogue. The session picker moves to
`/sessions` (§7.1).

The v1 TUI (`apps/tui/src/composition`) is untouched: it is deleted with v1, and it already resumes.

### 9.3 One label, one sentence

`Resume` is the label on every surface. Refusal sentences come from `resumePointOf`; no surface writes
its own copy.

## 10. Durability: the handoff fault scenario

`apps/api/src/agent/__tests__/faults/handoff-resume.fault.spec.ts`, in the shape of
`handoff-rotate.fault.spec.ts`: `describeHandoff` with a scripted session that answers one turn, is
stopped, then resumed, asserted against the control plane's rows and the assembled request.

```
1. A turn answers; the operator posts `stop`; the host consumes it and appends
   turn-ended{stopped, operator} after the cut reply. The pod releases.
2. The operator posts command:resume. The next host claims it, appends exactly one resume-marked,
   and starts turn-started{cause: resume}.
3. The assembled request for that turn contains no row of the cut step and no operator-stop notice.
4. Fault: the host is drained mid-turn, SIGKILLed, and the pod restarts.
5. Assert: exactly one resume-marked on the thread; exactly one turn-started with cause resume for
   that window; the resumed turn ends completed; the reply the model produced once is in the log once.
```

The scenario is what proves §6.1's exactly-once rule, because it kills the host between the marker and
the turn end, the only window where a second resume could be appended. A second assertion covers the
replay path: a host killed after `input-consumed{consumed: command}` and before the marker re-runs the
handler once, through `COMMAND_OUTCOMES.resume`.

## 11. Slices

Five slices, one PR each, each leaving `main` working. 1 is pure. 2 needs 1. 3 needs 1. 4 needs 1 and 3.
5 is docs.

**Slice 1 — `core`: the resume point and the discard (pure).**
Files: new `packages/core/src/record/resume-point.ts` + `__tests__/resume-point.spec.ts`; new
`packages/core/src/agents/resume.ts` (`EResumeOutcome`); `packages/core/src/record/event.ts` (the
`resume-marked` body + schema), `packages/core/src/record/durability.ts` (`resume-marked: false`),
`packages/core/src/agents/kind.ts` (turn-taking), `packages/core/src/record/loop-state.ts`
(`promptPatch`), `packages/core/src/events/resume-plan.ts` (`RESUME_AFTER_INTERRUPTED_TOOL`),
`packages/core/src/assembly/rules/messages-from-events.ts` (the skip and the one sentence),
`packages/core/src/index.ts` (exports).
Proof: `bun test` in `packages/core`. The spec covers every rule of §4 and every row of §4.1, plus
"automatic `isResumableOf` stays false for a stopped turn" and "a clean resume adds no user message".

**Slice 2 — `commands/resume`: the command.**
Files: `commands/src/resume/{spec.ts,pod.ts}`, `commands/src/resume/__tests__/`, `commands/src/index.ts`
(add to `nativeCommands`, `nativeCommandHandlers`), `packages/commands/src/pod.ts` (the two context
fields), `packages/core/src/record/command-entries.ts` (`resume: ['resume-marked']`),
`docs/v2/slices/slash-commands.md` §4.6 (the table row, and remove `/resume` from the dropped list).
Proof: `bun test` in `commands` and `packages/commands`.

**Slice 3 — `host`: the turn follows the marker (needs 1).**
Files: `packages/host/src/holder/{command-intake.ts,inbox-intake.ts}` (pass `crew` and `mainThreadId`),
`packages/host/src/holder/held-inbox.ts` (the marker counts as a prompt), the crew resume arm in
`packages/host/src/holder/crew/{crew-room.ts,child-run.ts,child-turns.ts}`,
`packages/plugin-sdk/src/crew.ts`, and `apps/api/src/agent/compose.ts` if the crew port is built there.
Proof: `bun test` in `packages/host`; the fault scenario of §10.

**Slice 4 — the surfaces (needs 1 and 3).**
Files: `apps/web/src/features/threads/transcript/{stopped-line.tsx,transcript-turn.tsx}`,
`apps/web/src/features/sessions/data/{session-transcript.ts,session-commands.ts}`,
`apps/web/src/features/sessions/agents/session-agent-panel.tsx`, their specs; the TUI's
`apps/tui/src/app/{use-run-attention.ts,session-api.ts}` and the transcript row.
Proof: `bun test` in `apps/web`; TUI typecheck and its twin test over the fake client.

**Slice 5 — docs.** This file's as-built list (§11.1), `docs/v2/roadmap.md` Current state,
`docs/v2/slices/tui.md:128` (the row now names the route) and `:160` (`/resume` becomes `/sessions`).

Integration owner: this thread, for slices 1–4.

### 11.1 As built

Live check outstanding. Slices 2 and 3 landed together in #2730, because the command must not land
without the host that runs its marker: a `/resume` that appends a marker nothing acts on would be a
dead end.
- **Slice 1, `core` (#2728).** `resume-marked` is an `EventBody`
  (`packages/core/src/events/body.ts:275`), not a `RecordBody` as §6.1 wrote: a body the loop folds
  is how the marker reaches the loop. `resumeMarkedDraft` lives in core beside `resumePointOf`, so
  the crew and the command write the same marker and neither owns the shape
  (`commands/src/resume/pod.ts:14` re-exports it). A `ToolInterrupted` resume keeps the operator-stop
  notice, because its marker carries no discard range: only a `Clean` marker discards, and the stop
  notice sits with the row it would have hidden
  (`packages/core/src/assembly/rules/messages-from-events.ts:283`).
- **Slices 2 and 3, `commands/resume` and `host` (#2730).** `CommandContext` gained a third field,
  `logEvents()` (`packages/commands/src/pod.ts:17`): `visibleEvents()` is the loop's view and drops
  `turn-started` and `turn-ended`, which is exactly what `resumePointOf` needs to read, so the handler
  takes the raw thread. The fault scenario kills the host after the resume command is consumed and
  before the marker, not mid-turn
  (`apps/api/src/agent/__tests__/faults/handoff-resume.fault.spec.ts`): `EHostFault.CommandOutcomeHangs`
  holds the command open, which is the window where a second marker could be appended. A mid-turn kill
  proves nothing extra, because the marker is already durable by then.
- **Slice 4, the surfaces (#2737).** The TUI binds `ctrl+r resume` globally, on the working line and
  the stop block alike (`apps/tui/src/app/chat-screen-host.tsx:213`), rather than only on the stopped
  row: the stop row can scroll away and the working line is where the operator's eyes are. Web shows
  no second timestamp on the `Stopped` line
  (`apps/web/src/features/threads/transcript/stopped-line.tsx`), because the reply above it already
  carries the time. Mobile is excluded until it has a stopped line of its own.
- **Slice 5, docs (this PR).** This section, the roadmap row, and the TUI spec: the picker moved to
  `/sessions` (§7.1) and fork is gone from `tui.md`.

## 12. Test plan

| Layer               | What                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure (`core`)       | `resumePointOf` returns every row of §4.1: `Clean` with and without a discard range, `Clean` discarding the step's call rows, `ToolInterrupted` with only the interrupted ids of a mixed parallel batch, `NotResumable` for a message after the stop, a rewind, a summary, a completed turn, a failed turn, a second resume, an open turn, an approval and a parked call; `resumableOf` mirrors the union |
| Pure (`core`)       | The assembly skips a discarded range and the operator-stop notice with it; it keeps the notice when no marker covers the row (rule 3); a `ToolInterrupted` marker inserts exactly one `RESUME_AFTER_INTERRUPTED_TOOL` block; a marker hidden by a later rewind stops discarding                                                                                                                           |
| Pure (`core`)       | `isResumableOf` still returns false for a stopped state, so the automatic path is untouched                                                                                                                                                                                                                                                                                                               |
| Commands            | The handler appends exactly one `resume-marked` with the ranges and ids of the point; it refuses `NotResumable` with its sentence and appends nothing; a second run refuses; a replayed consumed entry with a marker present appends nothing                                                                                                                                                              |
| `packages/commands` | `resume` is `runsIn: 'host'`, is in `byInboxKind`, appears in `catalogueForSurface` for all four surfaces, is neither hidden nor picked anywhere; `/resume` parses to no args; `/resume --agent x` parses; `/resume ship it` and `/resume --nope` refuse                                                                                                                                                  |
| Host                | After the marker the drain decides `StartTurn` and writes `turn-started{cause: resume}`; a stopped session still releases its holder and is not woken by a wake, a notice or a takeover; a sub-agent's resume appends the marker on the child's thread                                                                                                                                                    |
| Crew                | `PodCrew.resume` returns `UnknownAgent` for an id this session does not have, `Running` while the child's turn runs, `NotResumable` for a completed child, and resumes a stopped child once, with `turn-started{cause: resume}` on the child                                                                                                                                                              |
| Fault               | §10                                                                                                                                                                                                                                                                                                                                                                                                       |
| Web                 | The stopped turn draws one `Stopped` row with `Resume`; the button posts the command once and shows the pending state; a refusal shows with a dismiss and survives a reload; the sub-agent pane shows `Resume` for a stopped child; the row is absent for a completed turn                                                                                                                                |
| TUI                 | The remedy posts the command instead of `retry`; the `Stopped` row offers the same action; `/resume` runs from the composer menu                                                                                                                                                                                                                                                                          |
| Live                | §13                                                                                                                                                                                                                                                                                                                                                                                                       |

## 13. Live check

One production v2 session and one sub-agent, on the build that carries slice 4.
1. Send "run the test suite, then explain the failure". While the reply streams, press Stop. The
   transcript shows the cut reply and `Stopped`.
2. Resume. The turn re-runs and the reply continues.
3. **Proof the model saw nothing.** Read the assembled request of the resumed turn (the `atlas-agent`
   trace, or the request body the model call logged): it holds no text of the cut reply, no
   "The operator stopped your previous reply here." notice and no resume sentence. Record the
   before/after message lists in `evidence/`.
4. Stop during a long tool instead, then Resume: the request holds the interrupted tool result and
   exactly one `RESUME_AFTER_INTERRUPTED_TOOL` block, and the tool is not re-run unless the model
   issues it again.
5. Stop, let the pod release its holder, then **resize the pod** (the operator's own action, the way
   they change the sandbox size), wait for it to come back, and Resume from a reloaded page: one
   `resume-marked`, one `turn-started{cause: resume}`, and step 3's assertion holds across the resize.
6. Stop again, then type and send a normal message instead. No `Resume` action is offered, and the
   model reads the stop notice plus the message.
7. `POST /v1/trpc/sessions.command` with `{ sessionId, name: 'resume', args: {} }` on a fresh stopped
   session: `{ inboxId }`, then one `turn-started{cause: 'resume'}` in the log.
8. Spawn a sub-agent, stop it from its pane, and resume it: its own transcript continues, its request
   holds no text of its cut reply, and the parent is told it ended and then reported again.
9. Stop a turn, then `/rotate`, then `Resume`: the next request holds the brief and still no cut reply.

Record the results in `evidence/` with the request and response lines and one screenshot.

## 14. Out of scope

- Fork, of any kind. It was dropped on 2026-11-23 and is not a design option here.
- Resume with words: `/resume <text>` is refused, and a message after a stop is a normal prompt.
- Re-running a failed turn. That is retry's question, and §7.2 names the gap without closing it.
- Resume of a turn stopped by a rewind, by a rotation or by a credential repair. Each already has its
  own path.
- Editing the stopped step — dropping its text, its calls or its tokens — from the transcript. The
  transcript keeps every row; only the model's context drops the cut step. One exception: a quick
  stop (§16) hides the whole turn, because nothing in it was the agent's work.
- A resume that changes the model, the provider or the context window.
- Stop or resume for a teammate from another session. A teammate is a session row and stops itself.
- Mobile, until it has a stopped line (§9.1).
- The v1 surfaces. v1 already resumes, and it is deleted when v2 is stable.

## 15. Decision: the discard is permanent

After a clean stop, the cut step stays out of every later request of the thread, not only the resumed
turn (Dennis, 2026-11-23). From the model's view nothing paused. Explaining pause and resume mechanics
to the model only adds noise and causes hallucination. The `resume-marked` event is a fact in the log,
so every later assembly skips the cut range with no extra state. The operator keeps the cut rows and
the `Stopped` line in the transcript.

## 16. Quick stop: the message goes back to the composer

> **Dennis, 2026-11-24.** Send a message and stop at once. If the agent was only thinking — no tool
> ran and no reply text showed — the turn is rewound and the message goes back into the composer,
> text and attachments, ready to edit. This is the v1 behaviour, re-derived for v2: no v1 code is
> left to port (`apps/tui/src/app` is the v2 TUI, and `deprecated/` has no stop restore).

### 16.1 Two windows, one rule

- **Window A. The stop lands before the message is drained.** The log holds
  `input-consumed{consumed: discarded}` for the message and no `user-said`
  (`packages/host/src/holder/held-wait.ts:10-40`). Nothing changes in the log: the client that sent
  the message puts it back.
- **Window B. The turn started, and the stop cut it while the model only thought.** The log holds
  `user-said`, `turn-started{cause: input}`, maybe `assistant-said{interrupted}` with no `text` part,
  and `turn-ended{stopped, operator}`. The host appends one `history-rewound{cause: quick-stop}` in the
  same append as `turn-ended`.

Window A is a client bug today: `stagedOutcomesOf` maps every `input-consumed` to `Posted`
(`packages/client/src/stream/outgoing-messages.ts:60-64`), so the staged text is dropped silently.

### 16.2 The decision, in core

New pure function beside `resumePointOf`, in `packages/core/src/record/quick-stop.ts`:

```ts
export type QuickStop = { toSeq: number; draft: string } | null
export function quickStopOf(input: { events: readonly V2Event[]; ending: TurnEnding }): QuickStop
```

It returns a rewind only when every rule holds. Each rule is a fact in the log:
1. The ending is `stopped` by `operator`.
2. The open turn's `turn-started` has `cause: input`. A resumed turn is never rewound.
3. The prompts of the turn are the `user-said` rows after the previous `turn-ended` (or the start of
   the thread) and before `turn-started`. There is at least one, and each is from the operator (`via`
   absent or `operator`). A message from an agent, a routine or a notice is never rewound.
4. After `turn-started`, the turn holds only quiet rows: `assistant-said` with no non-empty `text`
   part, and bookkeeping (`input-consumed`, `input-posted`, `retry-scheduled`, `model-fell-back`,
   `fact-recorded`, `context-changed`, `resource-loaded`). Any other row — a tool row, an
   `agent-spawned`, a `user-said` drained mid-turn, a text part — means the agent did work: no rewind.

`toSeq` is the seq before the first prompt. `draft` is the prompts' text, joined by a blank line.

### 16.3 What the host writes

`history-rewound` gains one optional field, `cause?: ERewindCause` (`operator` | `quick-stop`;
absent is `operator`, so `/rewind` rows do not change). The host computes `quickStopOf` where it
writes a stopped `turn-ended` (`HeldTurns.endTurn`, `packages/host/src/holder/held-turns.ts`, and
`closeOpenTurn`, `packages/host/src/holder/orphan-turn.ts`) and appends
`[turn-ended, history-rewound{toSeq, draft, cause: quick-stop}]` in **one** append. There is no window
between the two rows, so a host drain, a SIGKILL or a pod restart leaves either neither row or both;
no new `describeHandoff` scenario is needed. The existing visibility fold then does the rest
(`packages/core/src/record/visibility.ts:24-33`): the prompts and the cut turn leave the visible log,
and the model never reads them.

### 16.4 No conflict with Resume

After a quick stop the turn's `turn-started` is hidden, so its `turn-ended` is hidden too
(`visibleWithin`, `packages/core/src/record/visibility.ts:139-152`). `resumePointOf` then reads the
turn before it, or returns `There is no stopped turn to resume.` (rule 3 of §4). The `Stopped` line
and the `Resume` action disappear with the turn. A restore and a resume can never both show.

### 16.5 The client: only the sender restores

`clientId` is minted per message by the client that sent it, and it is durable on `user-said` and
`input-posted`. Each client keeps the set of `clientId`s it sent in this session for the life of the
page (web `staged-store`, the TUI send hook, the mobile session screen). One pure function in
`packages/client` decides both windows:
- Window A: `stagedOutcomesOf` maps `input-consumed{discarded}` to a new `EStagedOutcome.Discarded`.
  The restore path that today handles `Refused` puts the staged copy back (text and attachments), with
  no toast.
- Window B: `quickStopRestoresOf({ events, clientIds })` returns, for each
  `history-rewound{cause: quick-stop}`, the hidden operator `user-said` rows whose `clientId` this
  client sent: `{ eventId, text, attachments }`. The client merges them with `mergedDraftOf` and
  restores attachments with `restorePlanOf` (`packages/client/src/session/session-rewind.ts`), the
  same helpers `/rewind` uses. Each rewind event restores once (a handled set keyed by event id).

Another client of the same session sees the message leave the transcript, and its composer does not
change. After a reload the sent set is empty, so an old quick stop never restores twice.

### 16.6 Surfaces

- **Web**: `use-staged-messages.ts` handles `Discarded`; `session-view.tsx` feeds window B into
  `composer.setDraft` and `composer.attachments.restore`, as the rewind restore does.
- **TUI**: `staged-messages.ts` handles `Discarded`; window B uses `draft.setValue`,
  `tokens.restore` and `attachments.restore`, as `use-rewind.ts:206-228` does.
- **Mobile**: the `restored` token carries text and attachments (after #2833 adds held attachments),
  for both windows. JS only, so it ships as an OTA update.

### 16.7 Tests

| Layer         | What                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure (`core`) | `quickStopOf`: thinking-only stop → rewind to before the prompt; a stop with streamed text, a tool row, a sub-agent, a mid-turn message, a resumed turn, a completed turn, a non-operator prompt → `null`; two queued prompts → one rewind, joined draft. After the rewind `resumePointOf` is `NotResumable` and the assembly holds no prompt. |
| Host          | A stopped thinking-only turn appends `turn-ended` and `history-rewound{quick-stop}` in one append; a stop after a tool appends only `turn-ended`.                                                                                                                                                                                              |
| Client        | `stagedOutcomesOf` gives `Discarded`; `quickStopRestoresOf` returns only this client's messages and each rewind once.                                                                                                                                                                                                                          |
| Surfaces      | Web and TUI put text and attachments back for both windows; mobile for both windows.                                                                                                                                                                                                                                                           |

### 16.8 Live check

On production: send "think hard about the meaning of life, then answer in one word" and stop within
two seconds. The message leaves the transcript, it is in the composer with its attachment, no `Resume`
shows, and the log holds one `history-rewound{cause: quick-stop}`. Then send a message that runs a
tool and stop during the tool: the message stays, `Stopped` and `Resume` show, no rewind.
