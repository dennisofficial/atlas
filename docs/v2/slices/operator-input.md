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
  `{requestId, description, url?, submitting, error?, onSubmit, onCancel?}`, with a plain `Textarea`
  and no masked variant: nothing about an operator answer is a secret, and the value never reaches
  the model, the transcript or the database whatever the field looks like.
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

## 2. The record: one parked call, keyed by its call id

Pydantic AI, the Vercel AI SDK's UI parts and the OpenAI Agents SDK all keep a pending call and its
payload in **one record keyed by the tool call id**; pi-durable parks a call as a slot with no output
and wakes it on a signal. LangGraph splits them and has to match by position, and our own split — a
`V2OperatorRequest` row plus an `operator-input-asked`/`operator-input-settled` pair — wedged two
sessions (sections 08–09): the answer re-ran the tool, the row never settled, every later ask in that
session was refused. One record cannot drift, so the row, the TTL and the second event are gone.
1. **Open** — one core event, `tool-parked {callId, name, request?}`. `request` is opaque JSON owned
   by the tool's plugin; core reads only `callId` and `name`. The operator plugin writes
   `{kind: 'input', prompt}` or `{kind: 'shell', prompt, shellId}` (`operatorRequestSchema`,
   `plugins/operator/src/core/request.ts`).
2. **Close** — the ordinary `tool-result` for that `callId`. Its `output` carries the plugin's
   outcome `{outcome, path?, bytes?, reason?}` (`operatorOutcomeSchema`); its `modelText` or `error`
   is what the model reads.
3. **Identity** — the call id. No `requestId`, no DB row, no second event, no deadline: a request is
   open exactly when its parked call is open, so nothing can be orphaned and nothing needs cleanup.
4. **Several parked calls queue.** The fold emits one entry per open call in call order, and the card
   shows the earliest pending one; each answer closes its own call. There is no "one per session"
   rule.

**Reading it.** `openParkedCallsOf(events)` (`packages/core/src/events/parked-calls.ts`) returns the
open calls earliest-first under the same rules as `LoopState`: a `tool-called`, `tool-result` or
`tool-denied` for the id closes it, so a rewound call is not open.

**Legacy events.** `operator-input-asked` and `operator-input-settled` stay registered as
`legacyOperatorEvents` so old logs parse and the Mac and web do not show "could not be read";
nothing writes them and the fold ignores them, so they draw no card. A #2278-era `tool-parked`
carries no `request` and draws no card either.

### The tool contract

`operator_input { prompt }` and `operator_shell_input { prompt, shellId }` — the question, not a
destination. Neither `run` calls a port: each returns
`parkedOutcomeOf({ reason, request: { kind, prompt, shellId? } })`, and dispatch records
`tool-parked` with that request in place of a `tool-result`. The turn ends `ETurnStatus.Parked`:
`LoopState.parked` keeps the call, `crashedCallsOf` never interrupts it, `resumePlanOf` reads
`Blocked` with `TOOL_PARKED_WAITING`, the session derives `ESessionStatus.WaitingForOperator`
("Waiting for you"), and the holder's ordinary idle rule releases the pod. The descriptions say the
turn waits until the operator answers or cancels, with no deadline, and where the value goes.
`childDeny: ['operator_input', 'operator_shell_input']` keeps v1's rule that only the main session
asks.

Model text, mirroring v1's so a model behaves the same way:
- file: `the operator's value was written to <path> (N bytes, mode 0600). Read it from there and
  never paste it into a message.`
- shell: `the operator's value was typed into the stdin of shell <shellId> (N bytes). Read the shell's
  output to see what the CLI did with it.`
- cancelled/abandoned/failed: v1's sentence naming the reason, plus that no value arrived.

## 3. Where the value goes, and where it never goes

- The host writes the file with `writeFile` at `<sessionDir>/requests/<callId>`, `mode: 0o600`,
  after `mkdir`-ing `requests/`, and reports the absolute path it wrote. A call id that fails
  `/^[A-Za-z0-9_-]{1,128}$/` is written under its sha256 hex instead.
- For a shell it issues `shells.write` with `end: false` — the op `shell_input` uses — and reports
  the shell id.
- The value lives in one HTTP request body, the host's memory for the length of one await, and the
  sandbox file or shell stdin. It is not in Postgres, not in a `V2Event`, not in an inbox payload,
  not in a log line, not in the model's context.
- **Mechanism versus policy.** Core and the agent own parking, generically; the operator plugin owns
  what its request means and how an answer closes it. The wake path — an inbox kind plus the
  in-memory value handoff — stays operator-specific until a second tool parks.

## 4. Mechanics: the tool parks, the host answers the call

**Ask** is dispatch. The tool returns the parked outcome, `packages/agent/src/tools/dispatch.ts`
records `tool-parked {callId, name, request}`, and the turn ends. No host code runs, no row is
written, and no deadline exists.

**Answer** (`apps/agent-host/src/operator-input/route.ts`, mounted beside `mcpOauthBegin`):
1. `POST /operator-requests/answer` with the stream's bearer. The body is exactly
   `{sessionId, callId, value}` or `{sessionId, callId, cancel: true}`, with the value capped at
   64 KiB.
2. The registry authorises from the session, not a row: `store.sessionOwner(sessionId)` must be the
   bearer's user, so a missing session and someone else's session are both `404`. Answers `200 {}`,
   `401 bearer`, `404 session`, `400 body`, `409` with the wake or delivery reason.
3. It stashes `{value}` or `{cancel: true}` in an in-memory **answer handoff** keyed by
   `{sessionId, callId}`, posts an inbox entry of kind `operator-answer` with payload `{callId}` only
   (`postInboxEntryIn`, `packages/control/src/postgres/postgres-post.ts`), and awaits delivery for up
   to 120 s. The entry rings a held session and makes an unheld one claimable, so the pod wakes.
4. `InboxIntake.prepare` (`packages/host/src/holder/inbox-intake.ts`) takes the value from the
   handoff (`operatorAnswers.handle`, `packages/host/src/holder/operator-answer.ts`), reads the open
   parked call with that callId and a parsable request, and delivers: `mkdir` + `writeFile` at
   `<sessionDir>/requests/<callId>` with `mode: 0o600`, or `shells.write` with `end: false`. It
   appends exactly one `tool-result` via `parkedResultDraft` — the delivered `output` and the
   path/shell sentence, or a cancelled/failed `output` and an error — resolves the handoff and wakes
   the turn, so the next turn hands the result to the model.
5. A file delivery failure appends nothing, leaves the call open and answers the operator the
   reason, so the card stays and they retry. A shell whose process is gone (`ECallFailure.NotFound`)
   closes the call `failed` with an error naming the shell. Cancel closes it `cancelled`.
6. A missing handoff — the waiter timed out, or another host claimed the entry — consumes the entry,
   leaves the call open and wakes nothing. An answer for a call that is no longer open resolves
   `the request is no longer open` and starts no turn.

**Restart and sleep.** The open call lives only in the event log, so a redeployed or slept agent host
finds it on the next claim: the parked call is still open and the plan is `Blocked`. Nothing is
settled on restart. A `shells.write` request cannot survive the pod sleeping — the shell is gone — so
it settles `failed` when the operator answers.

**A message or a stop while parked** closes **every** open parked operator call, legacy ones
included, with an error result ("the operator sent a message instead of answering", "the session was
stopped while the request was open"), then appends the `user-said` or performs the stop, so the
conversation stays valid and no card is stuck.

**A parked call is never re-run.** The turn loop picks the call to settle from `settleablePendingOf`
(`packages/core/src/record/loop-state.ts`), which leaves out everything in `LoopState.parked`, so a
turn that starts while a call is parked runs the intake and nothing else: if the intake closed the
call the model is called with its result, and if it did not the turn ends `Parked` again without
calling the model (`packages/agent/src/loop/tracked-turn.ts`).

**Multi-instance agent hosts** are out of scope: the answer handoff is process memory, so one agent
host instance is assumed (true today).

**Card** (`apps/web`): one component for v1 and v2, `threads/operator-input-card.tsx` — `Atlas needs
you`, the question, v1's plain `Textarea` (no masked variant: an operator answer is not a secret),
the privacy footer and Send, with an inline error and a Cancel button only when the caller passes
them.

v2 docks the same card above the composer: `sessions/data/use-operator-request.ts` picks the earliest
pending request entry and passes its session id, and `sessions/operator-request-dock.tsx` feeds its
prompt to `description` and the answer calls to `onSubmit` / `onCancel` with the result driving
`submitting` and `error`. The value is in the POST body only.

**Fold** (`plugins/operator/src/client/request-entry.ts`): one entry per `tool-parked` whose `name`
is `operator_input` or `operator_shell_input` and whose `request` parses, keyed by `callId` with the
entry's `callId` set to it. Its state is `pending` until a `tool-result` with the same callId arrives,
then comes from that result's `output`: delivered / cancelled / abandoned / failed; an error with no
parsable `output` is `failed`. A legacy pair and a request-less parked call draw no card.


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
- **Web**: `threads/__tests__/operator-input-card.spec.tsx` (always the plain textarea and never a
  masked field, inline error, Cancel only when offered, locked while submitting);
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
