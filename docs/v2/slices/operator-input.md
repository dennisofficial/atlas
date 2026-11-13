# Slice spec: operator input from the transcript

Status: **building, 2026-11-12.** Direction approved by the operator (2026-11-11 handoff). Anchors are
`path:line` at `8eb91a861`; re-check before relying on one. Prior slices:
[07c-native-tools.md](07c-native-tools.md) §5 names this seam and declines to smuggle it in;
[07d-mcp-sign-in.md](07d-mcp-sign-in.md) §10 is the card this one copies.

## Goal

A v2 session can ask the operator for a value it cannot know — a login code, a token — and get it
without the value ever entering the transcript, the model's context or the database.

**Exit criteria**
1. In a live v2 session, `operator_input` shows a card in the transcript with the question; the
   operator types a value, submits, and the tool returns the path the value was written to, so the
   next `bash` call can read it. The tool result, the card and every `V2Event` carry no value.
2. `operator_shell_input` takes the same route and types the value into a shell the session already
   started (`shell` then `operator_shell_input` then `shell_output` shows what the CLI did).
3. Only the operator can answer: a session, a sub-agent or another user's token cannot. A cancelled
   request ends the tool call with a reason the model can act on, and an unanswered one expires on
   its deadline without leaving a card that looks live.
4. The value lands at `$ATLAS_SESSION_DIR/requests/<id>` (`0600`) and nowhere else: not in the DB,
   not in the event log, not in the tool result, not in the session view.
5. v1 is unchanged; the capability-parity spec loses its two `EXCEPTIONS` entries.

## 1. What exists today

- **v1 asks by naming a destination, not by asking a question.** `operator_input` takes
  `{description, path, url?, appendNewline?}` (`packages/harness/src/tools/builtin/operator-input.ts:15-20`),
  `operator_shell_input` takes `{description, shellId, url?, appendNewline?}`
  (`operator-shell-input.ts:13-18`); both are `EToolEffect.Write`. The operator pastes at an
  `OperatorInputPort` request the harness holds in memory
  (`packages/harness/src/operator-input/port.ts:20-30`), a surface answers it over a channel request
  (`EClientRequest.ProvideOperatorInput`, `packages/wire/src/channel-wire.ts:135`), and
  `InProcessOperatorInput.answer` spools the bytes to the file or the shell's stdin
  (`operator-input/registry.ts:138-201`). Model text: `The operator's pasted value was delivered to
  ${path} (${bytes} bytes). …`
- **v1's events already fold to a line.** `operator-input-requested` / `operator-input-resolved`
  (`packages/core/src/events/body.ts:207-219`) become an `EEntryKind.OperatorInput` notice
  (`packages/client/src/transcript/notice-entries.ts:171-201`) and the web renders that as a quiet
  title (`apps/web/src/features/threads/data/transcript-notices.ts:89-93`). The v1 _card_ is drawn
  from a channel signal instead (`apps/web/src/features/threads/composer-footer.tsx:12-54`), so a v1
  session in web shows the card above the composer, not in the transcript. That card is the one both
  surfaces use: `apps/web/src/features/threads/operator-input-card.tsx` is presentational over
  `{requestId, description, url?, secret?, submitting, error?, onSubmit, onCancel?}`.
- **v2 has neither half.** `PodControl` has no way to ask a human
  (`packages/plugin-sdk/src/slots.ts:63-79`: `exposePort`, `memory`, `webSearch`, `mcp`), no inbox
  kind, event or card models a question, and the parity spec excepts the two tools with "the v2 cloud
  loop has no live operator surface mid-tool"
  (`apps/agent-host/src/agent-tools/__tests__/capability-parity.spec.ts:40-42`).
- **A turn can wait inside a tool call.** Dispatch has no timeout, only the turn's `AbortSignal`
  (`packages/agent/src/tools/dispatch.ts:268-277`), and the turn is driven fire-and-forget
  (`packages/host/src/holder/held-runner.ts:43`, `held-turns.ts:25-52`) while the holder returns to
  `Wait`, so an awaiting tool parks the session without blocking the host. A tool result reaches the
  model only by being appended and re-read (`tracked-turn.ts:76-147`, `settle-pending.ts:102`).
- **A pod tool emits events and reaches the sandbox through daemon ops.**
  `PluginPodContext.append` (`packages/host/src/holder/plugin-pod.ts:72-73`) writes drafts; `ctx.call`
  invokes a daemon op (`:78-84`). `writeFile` already takes a `mode`
  (`packages/protocol/src/ops/files.ts:23-30`, applied at `apps/daemon/src/ops/files/index.ts:82-86`),
  and `shells.write` reaches a shell from any turn (`apps/daemon/src/ops/shells/index.ts:176-201`) —
  it is what `plugins/shells`' `shell_input` already does (`plugins/shells/src/pod/input-tool.ts:49-55`).
- **The web already posts to the agent host with the stream's bearer.**
  `apps/web/src/features/settings/data/shared/mcp-signin-request.ts:27-41` →
  `POST ${hostOrigin()}/mcp-oauth/begin`, handled by
  `apps/agent-host/src/mcp-oauth/begin-route.ts:52-120` (CORS, bearer → `{userId}`, ownership, one
  JSON answer), mounted in `apps/agent-host/src/stream/stream-server.ts:80-95`.
- **The session dir is a known constant.** `sessionPathsOf` builds it and `ATLAS_SESSION_DIR_ENV`
  names it (`apps/agent-host/src/runtime/session-paths.ts:14-46`).

## 2. The shape: a row, an event pair, a plugin, one route

1. **A row, `v2.V2OperatorRequest`** (`packages/db/src/prisma/schema/v2/operator-request.prisma`) —
   `id`, `sessionId`, `threadId`, `kind` (`input | shell`), `prompt`, `secret`, `shellId?`, `status`
   (`pending | answered | cancelled | abandoned | failed`), `createdAt`, `resolvedAt?`. There is no
   deadline column and no value column, and none may be added.
2. **Two events** in `plugins/operator/src/core/request.ts`:
   `operator-input-asked {requestId, kind, prompt, secret, shellId?, expiresAt?, sessionId}` and
   `operator-input-settled {requestId, outcome, path?, bytes?, reason?, sessionId}`. Distinct names
   from v1's `operator-input-requested/-resolved`, whose payloads and fold already exist. Neither
   carries the value.
3. **A plugin `plugins/operator`** — the two pod tools and the client fold that turns the pair into
   one `EEntryKind.OperatorRequest` row.
4. **One route, `POST /operator-requests/answer`** on the agent host — `{requestId, value}` or
   `{requestId, cancel: true}` with the stream's bearer. It is the only writer of a value, and it
   holds no value at rest.

### The tool contract

`operator_input { prompt, secret? }` and `operator_shell_input { prompt, secret?, shellId }` — the
question, not a destination: v2 picks the path, so nothing the model writes can choose to overwrite a
file, and `appendNewline`/FIFO plumbing disappears (the value lands in a file; the model decides how
to hand it on). Both ask through one port (`packages/plugin-sdk/src/slots.ts`, `PodControl.operator`):

```ts
export type PodOperatorAsk =
  | { kind: 'input'; prompt: string; secret: boolean }
  | { kind: 'shell'; prompt: string; secret: boolean; shellId: string }

export type PodOperatorOpened = { ok: true; requestId: string } | { ok: false; reason: string }

export type PodOperatorInput = {
  ask(args: { ask: PodOperatorAsk; signal: AbortSignal }): Promise<PodOperatorOpened>
}
```

`EMPTY_OPERATOR_INPUT` answers `{ok: false, reason: 'this session cannot ask the operator for
input'}`, so every pod fake keeps compiling. A successful `ask` opens the request and the tool
returns the parked outcome (`parkedOutcomeOf`), so the turn ends with no result. **The value is never
part of the answer**: the host delivers it when it arrives, so neither the tool's arguments, its
parked reason, nor the `tool-parked` event can contain it. `childDeny: ['operator_input', 'operator_shell_input']` on the plugin's pod slot keeps
v1's rule that only the main session asks (`PodSlot.childDeny`, `packages/plugin-sdk/src/slots.ts:100`).

Model text, mirroring v1's so a model behaves the same way:
- file: `the operator's value was written to <path> (N bytes, mode 0600). Read it from there and
  never paste it into a message.`
- shell: `the operator's value was typed into the stdin of shell <shellId> (N bytes). Read the shell's
  output to see what the CLI did with it.`
- cancelled/abandoned/expired/failed: v1's sentence naming the reason, plus that no value arrived.

## 3. Where the value goes, and where it never goes

- The host adapter writes the file with `writeFile` at `<sessionDir>/requests/<requestId>`,
  `mode: 0o600`, after `mkdir`-ing `requests/`, and reports the absolute path it wrote.
- For a shell it issues `shells.write` with `end: false` — the op `shell_input` uses — and reports
  the shell id.
- The value lives in one HTTP request body, the host's memory for the length of one await, and the
  sandbox file or shell stdin. It is not in Postgres, not in a `V2Event`, not in a log line, not in
  the model's context.
- **The row is history, the event is the transcript.** The row gives the control plane an id it can
  resolve and audit; the card still renders from the event pair, which is what surfaces compose.

## 4. Mechanics: the tool call parks, the host answers it

**Ask** (`packages/host/src/holder/operator-input.ts`, built from `plugin-pod.ts`):
1. `control.operator.ask({ask, signal})` → `requests.open({sessionId, threadId, ask})`
   (`OperatorRequestPort`, `packages/host/src/holder/operator-requests.ts`).
2. The registry (`apps/agent-host/src/operator-input/registry.ts`) refuses a session that already has
   a pending row, inserts the `pending` row and returns `{requestId}`. There is no deadline and no
   in-memory promise: nothing about the request expires and nothing keeps the pod awake.
3. The adapter appends `operator-input-asked` with that id and returns `{ok: true, requestId}`.
4. The tool returns `parkedOutcomeOf(...)`, dispatch records `tool-parked {callId, name}` in place of
   a `tool-result`, and the turn ends with `ETurnStatus.Parked`. `LoopState.parked` keeps the call in
   `pending`, `crashedCallsOf` never interrupts it, `resumePlanOf` reads `Blocked` with
   `TOOL_PARKED_WAITING`, and the session derives `ESessionStatus.WaitingForOperator` — "Waiting for
   you" — instead of `RunningTool`. The holder has no running turn, so its ordinary 30-minute idle
   rule releases the pod and the sandbox may stop. The stall guard is not involved: it only runs
   while a turn is running, and a parked turn has already ended.

**Answer** (`apps/agent-host/src/operator-input/route.ts`, mounted beside `mcpOauthBegin`):
1. `POST /operator-requests/answer`, CORS as `begin-route.ts:29-50`, bearer → `resolve(bearer)`.
2. The registry authorises from the row, not from memory: the request must be `pending` and its
   session owned by the caller. Answers `200 {}`, `401 bearer`, `403 request`, `404 request`
   (unknown or already settled), `400 body`, `409` with the wake or delivery reason.
3. It stashes `{value}` or `{cancel: true}` in an in-memory **answer handoff** keyed by `requestId`,
   posts an inbox entry of kind `operator-answer` with payload `{requestId}` only
   (`postInboxEntryIn`, `packages/control/src/postgres/postgres-post.ts`), and awaits delivery for up
   to 120 s. The entry rings a held session and makes an unheld one claimable, so the pod wakes.
4. `InboxIntake.prepare` (`packages/host/src/holder/inbox-intake.ts`) takes the value from the
   handoff (`operatorAnswers.handle`, `packages/host/src/holder/operator-answer.ts`) and delivers it:
   `mkdir` + `writeFile` at `<sessionDir>/requests/<requestId>` with `mode: 0o600`, or `shells.write`
   with `end: false`. On success it appends `operator-input-settled {delivered}` and the parked
   call's `tool-result` (the path/shell sentence), resolves the handoff and wakes the turn, so the
   next turn hands the result to the model.
5. Cancel appends `cancelled` and a `tool-result` error. A file delivery failure leaves the request
   open and answers the operator the reason, so the card stays and they retry. A shell whose process
   is gone (`ECallFailure.NotFound`) settles `failed` and closes the call with an error naming it.
6. A missing handoff — the waiter timed out or another host claimed the entry — consumes the entry,
   leaves the request open and wakes nothing.

**Restart and sleep.** The open call lives only in the event log, so a redeployed or slept agent host
finds it on the next claim: the parked call is still open, the plan is `Blocked`, and the answer
route writes to the database row rather than to process memory. Nothing is settled on restart. A
`shells.write` request cannot survive the pod sleeping — the shell is gone — so it settles `failed`
when the operator answers.

**A message or a stop while parked** settles every open request `cancelled` and appends each parked
call's `tool-result` error ("the operator sent a message instead of answering", "the session was
stopped while the request was open"), so the conversation stays valid and no card is stuck at
`pending`.

**A parked call is never re-run.** The turn loop picks the call to settle from `settleablePendingOf`
(`packages/core/src/record/loop-state.ts`), which leaves out everything in `LoopState.parked`, so a
turn that starts while a call is parked runs the intake and nothing else: if the intake closed the
call the model is called with its result, and if it did not the turn ends `Parked` again without
calling the model (`packages/agent/src/loop/tracked-turn.ts`). Dispatch never sees the parked call,
so `operator_input` cannot ask a second time and `registry.open` cannot refuse itself.

**An orphaned request settles abandoned.** An operator request is open iff its parked call is open.
A request that was asked, never settled and whose parked call is no longer open — an old session that
re-ran the ask, a log rebuilt from a narrower view — is settled by `settleOperatorOrphans`
(`packages/host/src/holder/operator-orphans.ts`) at the start of `handle`, at the start of
`cancelOpen` (a message or a stop) and before `ask` opens a new request: it appends
`operator-input-settled {abandoned, reason}` and settles the row, so the card clears and the session
can ask again. While any parked call is still open no request is treated as an orphan, since the
pairing is by order, not by `callId`.

**Multi-instance agent hosts** are out of scope: the answer handoff is process memory, so one agent
host instance is assumed (true today).

**Card** (`apps/web`): one component for v1 and v2, `threads/operator-input-card.tsx` — `Atlas needs
  you`, the question, a `Textarea` (an `Input type="password"` when `secret`), the privacy footer and
Send, with an inline error and a Cancel button only when the caller passes them. v1 maps its channel
signal into it in `threads/data/use-operator-input.ts` and docks it from `composer-footer.tsx`,
unchanged in behaviour.

v2 docks the same card above the composer: `sessions/data/use-operator-request.ts` picks the pending
`ETranscriptKind.Request` row out of the transcript items (state `pending`), and
`sessions/operator-request-dock.tsx` feeds its prompt to `description`, its `secret` to the masked
field, and `answerOperatorRequest` / `cancelOperatorRequest` to `onSubmit` / `onCancel` with the
result driving `submitting` and `error`. A successful answer stays submitting — `Waiting for the
session to confirm.` — until the stream delivers `operator-input-settled` and the row stops being
pending. The value is in the POST body only: the transcript draws nothing for a pending request and
`transcript/transcript-request.tsx` keeps only the delivered / expired / cancelled / abandoned /
failed Trace rows.

**Fold** (`plugins/operator/src/client/request-entry.ts`): pair by `requestId`; an entry with no
`expiresAt` stays `pending` until it settles, and one whose `expiresAt` has passed with no settlement
reads as `expired` (old events keep that behaviour).

## 5. Test plan

- **Pod** (`plugins/operator/src/pod/__tests__`): both tools pass the schema's values to the port,
  return the path/shell sentence, turn a refusal into the reason sentence, and never echo the port's
  value (the double answers a marked string; the test asserts it is absent from `modelText`);
  `childDeny` hides both from a sub-agent.
- **Fold** (`plugins/operator/src/client/__tests__`): asked alone is pending; asked + settled is
  delivered/cancelled/abandoned/expired/failed; a passed deadline with no settlement reads expired.
- **Registry** (`apps/agent-host/src/operator-input/__tests__`): `open` writes a `pending` row,
  `answer` resolves and marks it `answered` once, a second answer is `404`, expiry resolves and marks
  `expired`, `abandon('cancelled')` marks `cancelled`, `abandon('abandoned')` marks `abandoned`.
- **Adapter** (`packages/host/src/holder/__tests__`): asked then settled events in order, the file
  written at `<sessionDir>/requests/<id>` with `0600` and the value, `shells.write` for the shell
  kind, abort → `abandoned`, the operator's cancel → `cancelled`, expiry → `expired`, the stall clock
  held for the length of the wait, no event payload contains the value.
- **Route** (`apps/agent-host/src/operator-input/__tests__`): bearer, ownership, unknown id,
  `409` off-holder, cancel, and the body cap.
- **Status** (`packages/core/src/record/__tests__/session-status.spec.ts`): the asked/settled pair is
  record-only, so a request settling after a `run-failed` leaves the session failed instead of
  re-opening the turn.
- **Control/db**: migration applies; `packages/db/src/__tests__/v2-smoke.spec.ts` covers the row.
- **Web**: `threads/__tests__/operator-input-card.spec.tsx` (masked secret field, plain textarea for
  a non-secret answer, inline error, Cancel only when offered, locked while submitting);
  `sessions/__tests__/operator-request-dock.spec.tsx` (the pending row is found among the transcript
  rows, the post body is exactly `{requestId, value}` with the stream bearer, stays submitting until
  the request settles, cancel and Escape, a refusal reads as a sentence);
  `threads/__tests__/transcript-request.spec.tsx` (a pending request draws nothing, the settled rows
  keep their Trace line and never render the value).
- **Parity**: both `EXCEPTIONS` entries are deleted and the spec passes.

## 6. Out of scope

- v1 sessions, and the TUI/mobile surfaces.
- Multi-instance routing (§8).
- Per-tool approval prompts, or a free-form "ask the user" tool.
- Reading the value back out afterwards (`bash` does that).

## 7. Open questions

1. **Should the row exist at all?** The event pair suffices for the card and the wait is in-memory;
   the row is kept because the brief asks for it and an id the control plane owns is what a stale
   request can be swept by. Dropping it removes one migration and one store with no other change.
2. **Deadline** — settled: there is none. The request is an open event and nothing holds it, so the
   card can stay open across a redeploy and the pod sleeping. (v1's two-minute timeout,
   `packages/client/src/channel/request-timeout.ts:15-19`, only exists to free a held terminal.)

## 8. Multi-instance answer routing (deferred shape)

An answer must reach the host whose process holds the await. The lease names the holder
(`V2Lease.holderHostId`, `packages/db/src/prisma/schema/v2/lease.prisma:3-11`) and `V2Host` has no
address (`host.prisma:3-7`), so the shape is: `V2Host` gains `address`, the host registers its own
base URL at boot, and the route proxies one hop when it is not the receiving instance. Not built
while production runs one instance; it is a column and a fetch, not a redesign.

## 9. Live check

**Merged 2026-11-12** as `59bdcbb19` (#2266). Against production:
`api.byatlas.io/v1/health` answered `migrations: level` after the merge deploy, so the deployed
contract matches the migration graph and `v2."V2OperatorRequest"` exists in production.

**Not yet exercised live:** an operator answering a card and the model reading the file. Criterion 1
needs a human to type a value, so it is the operator's run: a fresh v2 session asks for a value with
`operator_input`, the card appears in the transcript, the value is submitted, and the tool result
names the path. Everything up to that point is covered by specs — the registry, adapter and route for
the host side, the fold and `operator-request-dock.spec.tsx` for the card — but no card has been
clicked in a browser yet. **2026-11-12:** the card moved out of the transcript onto v1's card docked
above the composer (the operator's call), and the answer body stopped carrying `sessionId`, which the
strict route schema refused as `400 body`.
