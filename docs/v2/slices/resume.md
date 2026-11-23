# Slice spec: resume a stopped turn

> **Proposed 2026-11-23, awaiting Dennis's answers** to the three questions in §1. Everything below
> is decided and can be changed at one seam. Dennis's decision of 2026-11-23 is the reason the slice
> exists: stop a turn, then resume it, on the main thread and on a sub-agent, from any surface. Fork
> is dropped entirely and appears nowhere in this design.

Status: **proposed**. Anchors are `path:line` at `251b18d54` (origin/main, 2026-11-23). Re-check an
anchor before relying on it.

Prior art: [slash-commands.md](slash-commands.md) is the command contract this file spends, and
[rotate.md](rotate.md) is the most recent host command and the shape this file copies. Decision on
the host command path: [06-commands.md](06-commands.md). [tui.md](tui.md) §2.2 already carries the
row "Message, stop or resume a sub-agent — **No v2 route.** Slice 8" (`docs/v2/slices/tui.md:128`).

## 0. One line

A stopped turn is a turn the log can still describe: resume appends one `nudge` event to the same
thread, and the machinery that already resumes an interrupted turn after a host crash runs the next
step. One host command, `resume`, with an optional target sub-agent, that every surface calls.

## 1. Questions for Dennis

**Q1. What does the model read when you resume?**
Recommendation: a stop-specific nudge written by the host, plus your own words when you type them
(`/resume ship the migration first`). The v1 text is `RESUME_NUDGE` and it says "you were
interrupted mid-turn … if a tool call was cut short, run it again"
(`packages/core/src/events/resume-plan.ts:11-12`). That is true of a crash and false of a stop: you
pressed Stop because the step was going wrong, and a resume that tells the model to run the cut call
again undoes exactly what you stopped. Risk of the alternative: a resume after a stop repeats the
call you stopped.

**Q2. What happens to the tool call that was in flight when you stopped?**
Recommendation: it stays settled in the log as interrupted, with the sentence the log already
carries — "its effects are unknown — check before repeating it"
(`packages/agent/src/loop/dispatch-recovery.ts:16-26`) — and the nudge lets the model re-issue it
deliberately, or check first. Risk of the alternative (re-running it automatically): a resumed turn
silently repeats a write, a push or a migration that had already partly run. The calls of the cut
step that never left the process are already recorded as not run
(`packages/agent/src/loop/step-drafts.ts:104-126`), and those the model may re-issue freely.

**Q3. Does the stopped turn stay in the transcript after the resume?**
Recommendation: yes. The Stop line stays where it happened and the resumed turn appears under it as
a second turn, with its own steps. The log is the transcript, so nothing else is possible without a
history edit. Risk of the alternative (clearing or folding the Stop line into the new turn): the
transcript no longer shows that you stopped it, which is the one fact you would want when reading
back why a step looks the way it does.

## 2. Goal and exit criteria

**Goal.** Stopping a turn is reversible. After a stop the operator can resume the work — on the main
thread and on any sub-agent — from web, the TUI, Mac or mobile, and a resume that is not possible
says why in one sentence instead of failing a turn.

**Exit criteria.**
1. A turn stopped by the operator on the main thread is resumable once, from either surface, and the
   resumed turn continues the work: the model's first step after the resume names the task it was
   on, without the operator repeating it.
2. A sub-agent stopped mid-turn is resumable from its own pane, and its resumed turn continues that
   sub-agent's work, not the parent's.
3. A resume that cannot happen refuses with one sentence above the composer (web, Mac, mobile) or as
   a notice (TUI), and the log gains no `nudge`.
4. A resumed turn survives a host drain, a SIGKILL and a pod restart, and runs exactly once
   (`describeHandoff`, §8).
5. Automatic behaviour is unchanged: a stopped turn is still never resurrected by a wake, a notice,
   a takeover or a deploy. Only an explicit resume starts it.

## 3. What exists today

### 3.1 v1, the behaviour to match

**The decision is one pure function over the event log.** `resumePlan(events)`
(`packages/core/src/events/resume-plan.ts:49-70`), in order: blocked on an outstanding approval, then
blocked on a parked call, then `Continue` when a tool call is owed a result, then
`Continue{nudge}` when the last turn-taking event is not the assistant's reply, then `Nudge` when the
last assistant row is `interrupted`, else `Nothing`. `isResumable` is the plan being `Continue` or
`Nudge` (`:86-87`).

**A v1 stop is resumable.** v1's abandoned step writes `assistant-said{interrupted: true}` and
`tool-denied{interrupted: true}` for the calls of the cut step, and no stop marker
(`packages/agent-v1/src/loop/step-drafts.ts:63-79`). `carriesInterruption` therefore sees it
(`packages/core/src/events/resume-plan.ts:35-40`), the plan is `Nudge`, and the v1 client draws a
remedy strip: title "The run stopped before finishing", detail "Resume continues from the last
finished step; nothing is rerun." (`packages/client/src/transcript/run-attention.ts:34-40`, built at
`:88-99`).

**What resume does.** Nothing is replayed and nothing is rewound. `nudgeDraftsFor` appends one
`nudge` event carrying `RESUME_NUDGE` with `lifetimeSteps: 1` (`:14,75-78`), and the turn runs again
in the `resume` entry. Call ids the log has not settled are dispatched again by the loop; a partial
assistant message stays in the log as it was and the nudge tells the model not to repeat it.

**The TUI's leg.** `handleResume` re-reads the log, re-checks `isResumable(fresh)` and drives the
turn with `{resume: true}` (`apps/tui/src/composition/use-turn-driver.ts:96-107`); the strip action
is bound to it (`apps/tui/src/composition/use-run-attention.ts:81`).

### 3.2 v2 today

**The same plan exists, and one case is deliberately excluded.** `resumePlanOf(state)`
(`packages/core/src/record/loop-state.ts:229-244`) is `resumePlan` over the loop state, and its first
line after the empty check is the operator stop:

```ts
// An operator's stop ends the turn for good: nothing about it resumes on its own, here or
// after a later take-over, until the operator prompts again.
if (state.stoppedSincePrompt) return { kind: EResume.Nothing }
```

`stoppedSincePrompt` is set by the only writer that knows the abort was a stop:
`interruptedDrafts({ stopped: true })` (`packages/agent/src/loop/step-drafts.ts:104-126`) is called
with `stopped: abortSignal.reason === OPERATOR_STOP_REASON` (`packages/agent/src/loop/tracked-turn.ts:265-274`),
and the fold reads it at `packages/core/src/record/loop-state.ts:119-133`. That guard is right and
stays: it is what keeps a stopped session from restarting by itself.

**The turn-entry plumbing exists end to end.** `TurnRunner.resume` appends the resume drafts and then
runs a traced turn with `entry: Resume` (`packages/agent/src/loop/run-turn.ts:143-156`), through
`appendResumeDrafts` → `resumeDraftsOf(state)` (`packages/agent/src/loop/resume-turn.ts:13-34`).
The holder drives it as `HeldTurns.drive({resume: true})` (`packages/host/src/holder/held-turns.ts:100-125`)
and writes `turn-started{cause: 'resume'}` (`:171-186`) and `turn-ended{outcome, by}` (`:188-215`).
A stop lands as `{outcome: stopped, by: operator}` (`packages/host/src/holder/turn-boundary.ts:16-22`).

**The holder already waits for a resumable thread and already releases a stopped one.**
`resumable` in the drain snapshot is `isResumableOf(state) && !stopSettledPromptOf(events) && !repairHeld`
(`packages/host/src/holder/held-needs-holder.ts:76`), where `stopSettledPromptOf` is "a stop was
consumed after the last prompt" and counts `user-said` and `nudge` as prompts
(`packages/host/src/holder/held-inbox.ts:128-138`). `decideHeldAction` turns `resumable` into
`StartTurn` (`packages/core/src/execution/held-session-decision.ts:29-55`), and
`HeldActions.startTurn` passes it as `resume` (`packages/host/src/holder/held-actions.ts:159-199`).
`drainWantsHolder` returns false for a stopped session with nothing pending (`:67-88`), so the pod
releases its holder and the session sleeps.

**What a stop leaves in the log.** In order: `assistant-said{interrupted: true, stopped: true}` with
whatever text had streamed, one `tool-called` + `tool-denied{interrupted: true, reason: 'the developer
interrupted the turn before this tool ran'}` per call of the abandoned step
(`packages/agent/src/loop/step-drafts.ts:104-126`), `input-consumed{consumed: stop}`
(`packages/host/src/holder/held-wait.ts:10-41`), and `turn-ended{outcome: stopped, by: operator}`
(`packages/host/src/holder/held-actions.ts:138-147` closes it when no turn was running; `HeldTurns`
closes it otherwise). A call that had been dispatched and never settled gets
`tool-result{interrupted: true, error}` on the next takeover, through `settleCrashedCalls`
(`packages/agent/src/loop/dispatch-recovery.ts:28-46`, called from
`packages/host/src/holder/held-runner.ts:66-84`).

**Stop and retry, as they are.** `sessions.stop` posts `INBOX_KIND_STOP`
(`apps/api/src/api/platform/control/sessions.service.ts:557-560`); `sessions.retry` posts
`INBOX_KIND_RETRY` with an optional `agentId` that must be a thread of the same session
(`:528-556`). A retry for a child reaches `CrewRoom.retry` → `ChildRun.continueTurn({retry: true})`
(`packages/host/src/holder/crew/crew-room.ts:108-113`,
`packages/host/src/holder/crew/child-run.ts:170-176`), which is a resume of that child's turn. A
retry for the main thread is consumed quietly (`packages/host/src/holder/intake-entries.ts:47-52`)
and only feeds `retryPending`, which `decideHeldAction` turns into `Prepare` for a failed workspace
(`packages/core/src/execution/held-session-decision.ts:24-27`). It does not re-run a turn whose last
step finished: `resumePlanOf` returns `Nothing` there. The first slice below states what retry
therefore means and refuses the overlap.

**The crew slot has no resume.** `PodCrew` is spawn, say, stop, list, report
(`packages/plugin-sdk/src/crew.ts:23-35`). A child's stop comes from the model's `agent_stop`
(`plugins/crew/src/pod/stop-tool.ts`) or from a session ending, and its abort reason is
`'agent_stop'`, not `OPERATOR_STOP_REASON` (`packages/host/src/holder/crew/child-run.ts:178-182`), so
a child stop is recorded as `interrupted`, not as `stopped`, and `resumePlanOf` already calls it a
`Nudge`. There is no v2 route from a surface to any of it (`docs/v2/slices/tui.md:128`).

**The surfaces today.** Web (v2) draws a stopped reply as a quiet `Stopped` marker under the message
(`apps/web/src/features/threads/transcript/stopped-line.tsx:6-16`, rendered at
`apps/web/src/features/threads/transcript/transcript-turn.tsx:203`), and offers no action. Its only
attention card is for `run-failed` (`apps/web/src/features/sessions/data/session-run-attention.ts:25-51`).
The TUI's v2 client maps its raw v2 events into the shared transcript fold
(`apps/tui/src/app/use-session-transcript.ts:35-36,91`) and binds `ERunRemedy.Resume` to
`api.retry({sessionId})` (`apps/tui/src/app/use-run-attention.ts:67-71,79`). Because a v2 stop
resolves to `EResume.Nothing`, that binding cannot fire after a stop at all. Mobile has no stopped
line (`apps/mobile/src/thread/notice-fields.ts:20-35`).

## 4. The definition of resumable, from the log alone

New pure module, `packages/core/src/record/resume-point.ts`. It reads the thread's visible events —
the same Events `loopStateOf` folds — and answers one of four things. No clock, no host, no inbox
read.

```ts
export enum EResumePoint {
  Stopped = 'stopped',
  Interrupted = 'interrupted',
  Blocked = 'blocked',
  Nothing = 'nothing',
}

export type ResumePoint =
  | { kind: EResumePoint.Stopped; turnId: string; partialText: boolean }
  | { kind: EResumePoint.Interrupted; partialText: boolean }
  | { kind: EResumePoint.Blocked; reason: string }
  | { kind: EResumePoint.Nothing }

export function resumePointOf(input: { events: readonly V2Event[] }): ResumePoint
```

Rules, in order. Each is a fact in the log, so two surfaces can never disagree about whether a turn
can be resumed:
1. **No events** → `Nothing`.
2. **A turn is open** (`openTurnOf(events) !== null`, `packages/core/src/record/turns.ts:59-66`) →
   `Blocked('a turn is running; stop it first')`. A resume would race the running turn. The holder
   drains commands when no turn runs (`packages/host/src/holder/command-intake-glue.ts`), so this
   only fires for a stale client that pressed Resume as the next turn started.
3. **An approval is outstanding** → `Blocked(APPROVAL_WAITING)`; **a call is parked** →
   `Blocked(TOOL_PARKED_WAITING)`. The same two sentences v1 uses
   (`packages/core/src/events/resume-plan.ts:16-20`). There is nothing to resume past them: the turn
   is waiting on something outside itself.
4. **The last `turn-ended` is `failed`** → `Blocked('the last turn failed; retry it')`. A failure is
   retry's question, not resume's (§6.3).
5. **The last `turn-ended` is `stopped` by the operator, and no prompt has landed since** →
   `Stopped`. "Since" means no `user-said` or `nudge` after that `turn-ended` seq. A prompt means the
   ordinary path owns the turn, and it starts it without any resume.
6. **The last `turn-ended` is `interrupted`** (by the host: a drain, a SIGKILL, a takeover) →
   `Interrupted`. This is the case the automatic drain already handles; resume offers it explicitly
   and adds nothing. It is here so that one function answers the question for every surface, and so
   that a session whose holder has not woken yet can be resumed by hand.
7. **Otherwise** → `Nothing`. A `completed` turn is finished work; continuing it is a new message.

`partialText` is `lastAssistant?.interrupted === true`, so the surface can say "the reply was cut
off" instead of "the turn stopped" when there is text to keep.

### 4.1 What makes a stopped turn stop being resumable

| Event after the stop                       | Why                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user-said` or `nudge`                     | A prompt is owed a reply, so the ordinary turn path runs and the resume has nothing to add. The check is a seq comparison, not a new field.                                                                                          |
| `history-rewound` past the stopped turn    | The record cache drops hidden loop events on a history edit (`packages/host/src/holder/record/record-cache.ts:189-230`), so the stop is no longer in the folded state. Rewinding to before the stop is how the operator discards it. |
| `history-summarised` over the stopped turn | The summarised range is hidden (`packages/core/src/record/visibility.ts:36-45`), so the stop and the interrupted reply leave the state. The summary replaced them, which is what the operator asked for.                             |
| Any later turn that ends `completed`       | The work happened. The latest ending decides, and it says finished.                                                                                                                                                                  |
| A `run-failed` after the stop              | The resume started a turn and that turn failed. The failure card owns the next step, and rule 4 refuses.                                                                                                                             |

A `/rotate` after the stop does **not** end resumability, deliberately. Rotation cuts the model's
window, not the thread's state (`packages/core/src/record/rotation.ts`), and the resume's `nudge`
lands after the boundary, so the model reads the brief and then the continuation instruction. The
same holds for a rotation's own refusal rules: rotation refuses while a sub-agent runs, and a stopped
turn runs nothing.

## 5. What resume does

**It appends one `nudge` event to the same thread, and the turn follows from the log.** Not "continue
the same run": the run ended, and the holder that ran it may be gone. Not "start a new turn with
repaired context": nothing needs repairing except that the last step was cut off.

The single event is what makes the rest of the machinery work unchanged:
- `nudge` is turn-taking (`packages/core/src/agents/kind.ts:13-36`), so after it
  `lastTurnType` is `nudge` and `awaitsReplyOf` is true (`packages/core/src/record/loop-state.ts:205-208`).
- It also clears `stoppedSincePrompt` and `cutShortSincePrompt` (`:119-133`), and it counts as a
  prompt for `stopSettledPromptOf` (`packages/host/src/holder/held-inbox.ts:128-138`).
- So `isResumableOf(state)` becomes true and `decideHeldAction` returns `StartTurn` on the very next
  pass (`packages/core/src/execution/held-session-decision.ts:29-32`), which drives
  `HeldTurns.drive({resume: true})` → `TurnRunner.resume` → `turn-started{cause: 'resume'}`.
- `resumeDraftsOf` then sees `Continue{nudge: false}` and appends no second nudge, so the turn is
  resumed once however many times the decision runs.

That last point is the exactly-once rule, and it needs one addition to the state so that a second
`/resume` refuses instead of piling a second nudge onto the same tail: a `nudgedSincePrompt` boolean,
set by `nudge` and cleared by `user-said` (`:119-133`). `resumeDraftsOf` returns nothing when it is
set, and `resumePointOf` returns `Nothing` in that case too — the resume is already in flight.

### 5.1 What the model reads

Two texts, one per cause, in `packages/core/src/events/resume-plan.ts` beside `RESUME_NUDGE`:

```ts
export const RESUME_AFTER_STOP =
  'The operator stopped this turn before it finished. Continue the work from where it stopped: do not repeat what you already said and do not re-run a step that completed. Tool calls the stop cancelled are recorded as interrupted and did not run; issue again only the ones the work still needs. Do not ask whether to continue — the operator asked for this.'

export const RESUME_INSTRUCTION_PREFIX = 'The operator added this while resuming: '
```

`RESUME_NUDGE` stays for the `Interrupted` cause: there the turn really was cut off by the host, and
"run it again" is right. The operator's own words, when `/resume <text>` carries them, are appended to
the same nudge as one more sentence, framed as the operator's, not as a message. That keeps the
resume to one event and keeps the operator's instruction out of the transcript as if they had sent it
as a message.

### 5.2 What is repaired, and what is not

| Thing                                                | What resume does                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A call dispatched with no recorded result            | Settled first as `tool-result{interrupted: true, error}` by `settleCrashedCalls`, which the host already exports and the takeover path already calls (`packages/host/src/holder/held-runner.ts:66-84`). Q2. |
| Calls of the abandoned step that never ran           | Left as `tool-denied{interrupted: true}`. The model may re-issue them; nothing re-runs by itself.                                                                                                           |
| A partial assistant message                          | Left exactly as it is in the log and in the transcript. It is what the model said before the stop.                                                                                                          |
| Streamed text that never reached a step              | Dropped by the stop itself, before the resume: `interruptedDrafts` records the parts that had arrived.                                                                                                      |
| Tool output on disk, shells, services, sub-agents    | Untouched. Nothing about them was interrupted by the stop of one turn.                                                                                                                                      |
| The context window                                   | Untouched. A resume is not a rotation; `/rotate` is the boundary and stays a separate command.                                                                                                              |
| A sub-agent that was running when the parent stopped | Untouched. The stop ends the parent's turn; the child keeps running and reports into a thread whose turn ended.                                                                                             |

## 6. The operation

### 6.1 A host command, `resume`

One declaration, served to every surface, in the shape `slash-commands.md` §4.1 fixed and `rotate`
proved.

```ts
// commands/src/resume/spec.ts
export const REFUSAL_RESUME_TARGET = 'Use /resume, or /resume --agent <id>.'

export const resumeArgs = z.strictObject({
  agentId: z.string().min(1).optional(),
  instructions: z.string().max(2000).optional(),
})

export const resume = defineCommand({
  spec: {
    name: 'resume',
    summary: 'Resume a turn that was stopped before it finished',
    group: ECommandGroup.Session,
    argumentHint: '[instructions]',
    args: resumeArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: resumeFromText,
  },
})
```

`fromText` reads `--agent <id>` as the target and the rest as `instructions`; anything else that
starts with `--` refuses with `REFUSAL_RESUME_TARGET`.

Wire: `sessions.command { sessionId, name: 'resume', args }` → `postCommand`
(`apps/api/src/api/platform/control/command-registry.ts:35-66`) → one inbox entry of kind
`command:resume`, which is the same path `/rotate` takes and needs no new mutation, no new client
action and no surface table entry. `resume` appears in no `hides` and no `picks` list
(`packages/commands/src/surface.ts:22-33`), so every surface lists it; a hidden name would still run,
as the contract says.

**Name collision to settle in the same slice.** v1 keeps `/resume` as a TUI-local entry for the
session picker (`docs/v2/slices/tui.md:160`), and `slash-commands.md:424` lists `/resume` among the
dropped v1 commands. A TUI-local entry is matched before the text is posted, so on the TUI the picker
and this command would both answer `/resume`, and no part of the contract would pick between them:
the host never sees the typed line. The TUI's picker therefore moves to `/sessions` in the TUI slice,
and this file records the decision: in Atlas, `/resume` means resume the stopped turn, on every
surface.

### 6.2 The handler

```ts
// commands/src/resume/pod.ts
export async function resumeNow(args: {
  point: ResumePoint
  instructions?: string | undefined
  append(drafts: readonly EventDraft[]): Promise<void>
}): Promise<CommandResult>
```

1. Re-read the events at the moment of the command, never a cached plan. `point = resumePointOf({ events })`.
2. `Nothing` → `{ kind: 'refused', reason: 'There is no stopped turn to resume.' }`
3. `Blocked(reason)` → `{ kind: 'refused', reason }`.
4. Append one draft: `{ type: 'nudge', text: textOf({ point, instructions }), lifetimeSteps: 1 }`.
5. Return `{ kind: 'done' }`. The holder's next decision pass starts the turn (§5); the handler does
   not start it, and must not: a command that starts a turn would need its own crash story.

The handler wrapper is thin, like `rotateHandler`:

```ts
export const resumeHandler: CommandHandler<unknown> = async (context) => {
  const parsed = resumeArgs.safeParse(context.args)
  if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
  return resumeNow({ ...pointOf(context.visibleEvents()), append: context.append, instructions })
}
```

**The sub-agent target.** When `agentId` is present and it is not this thread, the handler asks the
crew instead of appending, through a new `CommandContext.crew` port (§6.4).

### 6.3 How resume differs from retry

|           | retry (`sessions.retry`)                                                                                | resume (`sessions.command{name:'resume'}`)                                         |
| --------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Asks      | do this turn again, from its start                                                                      | continue this turn, from where it stopped                                          |
| Trigger   | a `run-failed` failure card, a failed workspace prepare                                                 | a `turn-ended{stopped, operator}`, or an `interrupted` ending nobody has picked up |
| Event     | `INBOX_KIND_RETRY` (`packages/core/src/record/inbox.ts:4`)                                              | `nudge` (`packages/core/src/events/body.ts:185`)                                   |
| Sub-agent | `CrewRoom.retry` → `continueTurn({retry: true})` (`packages/host/src/holder/crew/crew-room.ts:108-113`) | `PodCrew.resume` → `continueTurn({resume: true})`                                  |
| Wording   | the failure's own remedy label                                                                          | `Resume`                                                                           |

Slice 1 makes the boundary honest in code: `resumePointOf` refuses a `failed` ending with a sentence
that names retry, and the resume command refuses a `Nothing` ending with a sentence that names
nothing. The gap that remains, and that this slice does not close: **after a failed main-thread turn,
`sessions.retry` reaches the workspace prepare and nothing else**, because `resumePlanOf` returns
`Nothing` for a finished step (`packages/core/src/record/loop-state.ts:229-244`) and
`decideHeldAction` only uses `retryPending` for a failed workspace
(`packages/core/src/execution/held-session-decision.ts:24-27`). The web failure card offers `Retry`
from `remediesOf` for every failure kind (`packages/core/src/events/run-failure.ts:117-147`). Whether
retry must re-run a failed turn is its own defect with its own live check; it is listed as out of
scope here so that resume is not built on a path that looks like it works.

### 6.4 The crew's resume

The slot gains one method, and nothing else about a sub-agent changes:

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

`CrewRoom.resume` finds the run and calls `ChildRun.continueTurn({ resume: true })`
(`packages/host/src/holder/crew/crew-room.ts:108-113` is the neighbour to copy). That needs one fix
in the child lifecycle: `continueTurn` today drives `{restart: true}` once the previous turn has
ended (`packages/host/src/holder/crew/child-run.ts:170-176`), and `child-turns.firstTurn` maps
`restart` to `runTurn`, which appends no nudge at all
(`packages/host/src/holder/crew/child-turns.ts:26-35`). The resume arm must pass `{resume: true}` in
both cases, so that `LoopTurnRunner.resume` appends the child's nudge and writes
`turn-started{cause: 'resume'}` on the child's own thread.

A child's own log decides, through the same `resumePointOf`, so a child stopped by `agent_stop` (an
`interrupted` ending) and a child stopped by the operator both resume with the same code.

### 6.5 The command context's two new fields

`CommandContext` (`packages/commands/src/pod.ts:3-12`) gains:

```ts
crew?: { resume(args: { agentId: string }): Promise<EResumeOutcome> } | undefined
mainThreadId?: string | undefined
```

`mainThreadId` is how a handler tells "this thread" from a child: a command posted for the session
carries no thread, and a resume with an `agentId` equal to the session's main thread is a main-thread
resume. `InboxIntake` already knows both (`packages/host/src/holder/inbox-intake.ts:60-96`) and the
crew is in scope where the context is built (`packages/host/src/holder/command-intake.ts:224-240`),
beside `runningChildren` (`:49-66`).

## 7. The surfaces

### 7.1 Web

The affordance lives where the stopped turn already renders: the `Stopped` marker under the cut-off
reply (`apps/web/src/features/threads/transcript/stopped-line.tsx:6-16`, used at
`apps/web/src/features/threads/transcript/transcript-turn.tsx:203`). It becomes one row: the label,
the time, and a `Resume` button. Not the failure card: `sessionAttentionOf` reads `run-failed` only
(`apps/web/src/features/sessions/data/session-run-attention.ts:25-51`), and a stop is not a failure.
- The item gains `resumable: ResumePoint | null`, computed once from `resumePointOf` over the
  session's events in the transcript fold that already builds the items (`sessionTranscriptOf`, used
  at `apps/web/src/features/sessions/agents/session-agent-panel.tsx:121`). One fold, so the marker
  and the button cannot disagree.
- The button posts `sessions.command({ name: 'resume', args: {} })` through the same client call the
  command menu uses (`apps/web/src/features/sessions/data/session-commands.ts`), shows `Resuming…`
  and disables itself while the entry is pending, and hides itself once the fold says `Nothing`. A
  refusal renders from the log through `RefusalRows`
  (`apps/web/src/features/sessions/refusal-rows.tsx`), as every refusal does.
- The sub-agent pane's header (`apps/web/src/features/sessions/agents/session-agent-panel.tsx:44-77`)
  gains the same `Resume` action for `identity.status === 'stopped'`, posting
  `{ name: 'resume', args: { agentId } }`. This is the first v2 surface action for a sub-agent
  (`docs/v2/slices/tui.md:128`).
- Mobile gets nothing: it has no stopped line to hang the action on (§3.2). When the phone gets one,
  it reads the same `resumePointOf` and posts the same command.

### 7.2 The TUI

The v2 TUI already holds both the mapped transcript events and the raw v2 events
(`apps/tui/src/app/use-session-transcript.ts:35-36`), so its leg is small and needs no new fold:
- `resumePointOf({ events: rawEvents })` decides, both for the composer-line remedy and for the
  `Stopped` row the transcript draws.
- `handleResume` stops calling `api.retry` and posts `sessions.command({ name: 'resume', args: {} })`
  (`apps/tui/src/app/use-run-attention.ts:67-71,79` becomes a resume call; `SessionApi` gains
  `command`, beside `retry` at `apps/tui/src/app/session-api.ts:76`).
- The `/resume` entry joins the composer menu from the shared catalogue, like every host command
  since the slash-commands slice, and the session picker moves to `/sessions` (§6.1).

The v1 TUI (`apps/tui/src/composition`) is untouched: it is deleted with v1, and it already resumes.

### 7.3 One label, one sentence

`Resume` is the label on every surface, and the refusal sentences come from `resumePointOf`
(`Blocked.reason`) or from the command (`Nothing`). No surface writes its own copy, for the reason
the commands spec gives: a surface that words a refusal differently is a second vocabulary.

## 8. Durability: the handoff fault scenario

`apps/api/src/agent/__tests__/faults/handoff-resume.fault.spec.ts`, in the shape of
`handoff-rotate.fault.spec.ts`: `describeHandoff` with a scripted session that answers one turn, is
stopped, then resumed, and asserts against the control plane's rows.

```
1. A turn answers; the operator posts `stop`; the host consumes it and appends
   turn-ended{stopped, operator}. The pod releases.
2. The operator posts command:resume. The next host claims, consumes it, appends exactly one nudge,
   and starts turn-started{cause: resume}.
3. Fault: the host is drained mid-turn, SIGKILLed, and the pod restarts.
4. Assert: exactly one nudge on the thread; exactly one turn-started with cause resume for that
   window; the resumed turn ends completed; the reply the model produced once is in the log once.
```

The scenario is what proves the exactly-once rule of §5, because it kills the host between the nudge
and the turn end, which is the only window where a second resume could be appended. A second
assertion covers the replay path: a host killed after `input-consumed{consumed: command}` and before
the nudge re-runs the handler once (`COMMAND_OUTCOMES.resume = ['nudge']`,
`packages/core/src/record/command-entries.ts:15-19`, replay at
`packages/host/src/holder/recover-unfinished-commands.ts`).

## 9. Slices

Five slices, one PR each, each leaving `main` working. 1 is pure. 2 needs 1. 3 needs 1. 4 needs 1 and
3. 5 is docs.

**Slice 1 — `core`: the resume point (pure).**
Files: new `packages/core/src/record/resume-point.ts` + `__tests__/resume-point.spec.ts`;
`packages/core/src/record/loop-state.ts` (the `nudgedSincePrompt` field and its fold, `:17-49,119-133,246-249`);
`packages/core/src/events/resume-plan.ts` (`RESUME_AFTER_STOP`, `RESUME_INSTRUCTION_PREFIX`,
`explicitResumePlanOf`); new `packages/core/src/agents/resume.ts` (`EResumeOutcome`);
`packages/core/src/index.ts` (export them).
Proof: `bun test` in `packages/core`. The spec covers every rule in §4 and every row of §4.1, plus
"automatic `isResumableOf` stays false for a stopped turn".

**Slice 2 — `commands/resume`: the command and the prompt.**
Files: `commands/src/resume/{spec.ts,pod.ts}`, `commands/src/resume/__tests__/`, `commands/src/index.ts`
(add to `nativeCommands`, `nativeCommandHandlers`), `packages/commands/src/pod.ts` (the two context
fields), `packages/core/src/record/command-entries.ts` (`resume: ['nudge']`),
`docs/v2/slices/slash-commands.md` §4.6 (the table row) and §4.6's dropped list (remove `/resume` with
the reason: it now means resume the stopped turn).
Proof: `bun test` in `commands` and `packages/commands`.

**Slice 3 — `host`: the turn follows the nudge (needs 1).**
Files: `packages/host/src/holder/{command-intake.ts,inbox-intake.ts}` (pass `crew` and `mainThreadId`
into the context), `packages/host/src/holder/held-actions.ts` (nothing new is expected here; this
slice is the checklist that `StartTurn` follows a nudge, so the only work is the assertion and the
wiring), `packages/host/src/holder/crew/{crew-room.ts,child-run.ts,child-turns.ts}` (the resume arm),
`packages/plugin-sdk/src/crew.ts` (`resume`), `apps/api/src/agent/compose.ts` if the crew port is
built there.
Proof: `bun test` in `packages/host`; the fault scenario of §8.

**Slice 4 — the surfaces (needs 1 and 3).**
Files: `apps/web/src/features/threads/transcript/{stopped-line.tsx,transcript-turn.tsx}`,
`apps/web/src/features/sessions/data/{session-transcript.ts,session-commands.ts}`,
`apps/web/src/features/sessions/agents/session-agent-panel.tsx`, their specs; the TUI's
`apps/tui/src/app/{use-run-attention.ts,session-api.ts}` and the transcript row.
Proof: `bun test` in `apps/web`; TUI typecheck and its twin test over the fake client.

**Slice 5 — docs.** This file's as-built table, `docs/v2/roadmap.md` Current state,
`docs/v2/slices/tui.md:128` (the row now names the route) and `:160` (`/resume` becomes `/sessions`).

Integration owner: this thread, for slices 1–4.

## 10. Test plan

| Layer               | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure (`core`)       | `resumePointOf` returns `Nothing` on an empty log and on a `completed` turn; `Stopped` for `turn-ended{stopped, operator}` with nothing after it; `Nothing` once a `user-said` or `nudge` follows; `Nothing` once a `history-rewound` hides the stop; `Nothing` once a `history-summarised` covers it; `Blocked` with the approval, parked and failed sentences; `Interrupted` for a host ending; `partialText` true only when the last assistant row is interrupted; a `rotated` after the stop leaves `Stopped` |
| Pure (`core`)       | `explicitResumePlanOf` returns the stop nudge once and nothing when `nudgedSincePrompt`; `isResumableOf` still returns false for a stopped state (the automatic path is untouched)                                                                                                                                                                                                                                                                                                                                |
| Commands            | The handler appends exactly one `nudge`, with the stop text, and the instruction appended when given; it refuses `Nothing` with its sentence; it refuses `Blocked` with the plan's sentence; a second run with a nudge on the tail refuses; a replayed consumed entry with a nudge present appends nothing                                                                                                                                                                                                        |
| `packages/commands` | `resume` is `runsIn: 'host'`, is in `byInboxKind`, appears in `catalogueForSurface` for all four surfaces, and is neither hidden nor picked anywhere; `/resume --agent x` parses; `/resume --nope` refuses                                                                                                                                                                                                                                                                                                        |
| Host                | After the nudge the drain decides `StartTurn` and writes `turn-started{cause: resume}`; `settleCrashedCalls` runs before the nudge so no call is left dispatched; a stopped session still releases its holder and is not woken by a wake, a notice or a takeover; a sub-agent's resume drives its own thread and writes the nudge there                                                                                                                                                                           |
| Crew                | `PodCrew.resume` returns `UnknownAgent` for an id this session does not have, `Running` while the child's turn runs, `NotResumable` for a completed child, and resumes a stopped child once                                                                                                                                                                                                                                                                                                                       |
| Fault               | §8, including the SIGKILL window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Web                 | The stopped turn draws one `Stopped` row with `Resume`; the button posts the command once and shows the pending state; a refusal shows with a dismiss and survives a reload; the sub-agent pane shows `Resume` for a stopped child; the row is absent for a completed turn                                                                                                                                                                                                                                        |
| TUI                 | The remedy posts the command instead of `retry`; the `Stopped` row offers the same action; `/resume` runs from the composer menu                                                                                                                                                                                                                                                                                                                                                                                  |
| Live                | §11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 11. Live check

One production v2 session and one sub-agent, on the build that carries slice 4.
1. Send a message that starts a long step ("run the test suite, then explain the failure"). Press
   Stop while the tool runs. The transcript shows the cut-off reply and `Stopped`.
2. Press `Resume`. The reply continues, and its first step names the task and the test run without
   the operator repeating either.
3. Stop again, then type and send a normal message instead. No `Resume` action is offered.
4. `POST /v1/trpc/sessions.command` with `{ sessionId, name: 'resume', args: {} }` on a fresh stopped
   session: `{ inboxId }`, then one `turn-started{cause: 'resume'}` in the log.
5. Spawn a sub-agent, stop it from its pane, and resume it. Its own transcript continues; the parent
   is told it ended and then reported again.
6. Stop a turn, then `/rotate`, then `Resume`: the next request holds the brief and then the
   continuation, and the resumed turn still works.
7. Stop a turn and wait for the pod to release, then `Resume` from a reloaded page: one `nudge`, one
   turn, and the Stop line still where it was.

Record the results in `evidence/` with the request and response lines and one screenshot.

## 12. Out of scope

- Fork, of any kind. It was dropped on 2026-11-23 and is not a design option here.
- Re-running a failed turn. That is retry's question, and §6.3 names the gap without closing it.
- Resume of a turn stopped by a rewind, by a rotation or by a credential repair. Each already has its
  own path.
- Editing the stopped step before resuming — dropping its text, its calls or its tokens. A history
  edit belongs to rewind.
- A resume that changes the model, the provider or the context window.
- Stop or resume for a teammate from another session. A teammate is a session row and stops itself;
  cross-session control is a different feature.
- Mobile, until it has a stopped line (§7.1).
- The v1 surfaces. v1 already resumes, and it is deleted when v2 is stable.
