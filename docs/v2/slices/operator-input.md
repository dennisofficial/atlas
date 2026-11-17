# Slice spec: operator input from the transcript

Status: **built, 2026-11-12**, live check partial (#2267). Direction approved by the operator
(2026-11-11 handoff). Anchors are `path:line` at `8eb91a861`; re-check before relying on one. Prior
slices:
[07c-native-tools.md](07c-native-tools.md) §5 names this seam and declines to smuggle it in;
[07d-mcp-sign-in.md](07d-mcp-sign-in.md) §10 is the card this one copies.

## Goal

A v2 session can ask the operator for a value it cannot know — a login code, a token — and get it
without the value ever entering the transcript or the model's context.

**Exit criteria**
1. In a live v2 session, `operator_input` shows a card in the transcript with the question; the
   operator types a value, submits, and the tool returns the path the value was written to, so the
   next `bash` call can read it. The tool result, the card and every `V2Event` carry no value.
2. `operator_shell_input` takes the same route and types the value into a shell the session already
   started (`shell` then `operator_shell_input` then `shell_output` shows what the CLI did).
3. Only the operator can answer: a session, a sub-agent or another user's token cannot. A cancelled
   request ends the tool call with a reason the model can act on, and an unanswered one expires on
   its deadline without leaving a card that looks live.
4. The value lands at `$ATLAS_SESSION_DIR/requests/<id>` (`0600`) and nowhere else the model or a
   transcript reads: not in the event log, not in the tool result, not in the session view. The
   answer itself is stored in the inbox entry sealed with the agent host's secrets key, which is how
   any host can deliver it without Postgres ever holding the plaintext.
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
- **v2 asks by parking a tool call.** `operator_input` and `operator_shell_input` return a parked
  outcome carrying the question, dispatch writes `tool-parked {callId, name, request}`
  (`packages/agent/src/tools/dispatch.ts`), an `operator-answer` inbox entry wakes the pod, and the
  holder closes the call with the ordinary `tool-result`
  (`packages/host/src/holder/operator-answer.ts`). No row, no deadline and no second event exist:
  §2 has the record, §3 where the value goes, §4 the mechanics. The capability-parity `EXCEPTIONS`
  entries for the two tools are gone, so v2 registers them like any other tool.
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
- The value lives in one HTTP request body, the `operator-answer` inbox entry, and the sandbox file
  or shell stdin. In the entry it is ciphertext: the route seals it with the agent host's
  `SecretCipher` (AES-256-GCM under `SECRETS_ENCRYPTION_KEY`, the cipher that protects credentials),
  so a database dump does not hand over every code an operator typed, and the holder reopens it with
  the same key. There is still no `secret` flag and no masked input, because it is a login code the
  model already could not know and masking is about shoulders, not storage. It is not in a
  `V2Event`, not in a log line, not in the model's context.
- **Mechanism versus policy.** Core and the agent own parking, generically; the operator plugin owns
  what its request means and how an answer closes it. The wake path — one inbox kind whose payload
  carries the value — stays operator-specific until a second tool parks.

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
   `401 bearer`, `404 session`, `400 body`.
3. It seals the value with the agent host's `SecretCipher` and posts an inbox entry of kind
   `operator-answer` whose payload is `{callId, sealedValue}` or `{callId, cancel: true}`
   (`postInboxEntryIn`, `packages/control/src/postgres/postgres-post.ts`) — in one transaction, and
   returns `200` at once. Plaintext never reaches the row. Nothing in the route waits on a holder.
   The entry rings a held session and makes an unheld one claimable, so the pod wakes whenever it
   wakes.
4. `InboxIntake.prepare` (`packages/host/src/holder/inbox-intake.ts`) reads the sealed value or the
   cancel from the entry payload (`operatorAnswers.handle`,
   `packages/host/src/holder/operator-answer.ts`) — no state is shared with the route, so any host
   can serve it — reopens the value with the `openValue` its `operator` dep carries (the
   `SecretCipher`'s decrypt, wired in `apps/agent-host/src/compose.ts`, since `packages/host` may not
   import the app), reads the open parked call with that callId and a parsable request, and delivers:
   `mkdir` + `writeFile` at `<sessionDir>/requests/<callId>` with `mode: 0o600`, or `shells.write`
   with `end: false`. It appends exactly one `tool-result` via `parkedResultDraft` — the delivered
   `output` and the path/shell sentence, or a cancelled/failed `output` and an error — and wakes the
   turn, so the next turn hands the result to the model.
5. Any delivery failure, and a sealed value that will not decrypt (a rotated or foreign
   `SECRETS_ENCRYPTION_KEY`), closes the call `failed` with the reason in the error, so the model
   reads why nothing arrived and can ask again; the refusal sentence carries no value. A shell whose
   process is gone (`ECallFailure.NotFound`) names the shell. Cancel closes it `cancelled`.
6. A malformed payload, or an answer for a call that is no longer open, consumes the entry and wakes
   nothing: the call it names is already closed, so there is nothing to answer.

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

**Any instance, any time.** The answer is in the entry, so the instance that receives the POST and
the instance that holds the session need not be the same, and a host that restarts before the
intake runs loses nothing: the next claim reads the same payload. No host holds the answer in
memory and no request waits on delivery.

**Card** (`apps/web`): one component for v1 and v2, `threads/operator-input-card.tsx` — `Atlas needs
you`, the question, v1's plain `Textarea` (no masked variant: the value is sealed at rest and never
model-facing, so masking would only hide it from the operator),
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

- **Pod** (`plugins/operator/src/pod/__tests__/tools.spec.ts`): each tool parks with its request
  (`{kind: 'input', prompt}`, `{kind: 'shell', prompt, shellId}`), a call with no question is
  rejected, the descriptions say the wait has no deadline and where the value goes, and `childDeny`
  keeps both away from a sub-agent.
- **Fold** (`plugins/operator/src/client/__tests__/request-entry.spec.ts`): a parked call draws a
  pending entry keyed by its call id and carrying the shell id; the closing `tool-result`'s `output`
  decides delivered / cancelled / failed, and an error with no parsable `output` is failed; two
  parked calls queue and each closes on its own result; a legacy asked/settled pair, a request-less
  parked call from #2278 and a parked call that is not an operator tool all draw no card; only the
  legacy schemas are registered.
- **Host** (`packages/host/src/holder/__tests__/operator-answer*.spec.ts`): an answer is delivered
  from the sealed entry payload alone, with nothing held in memory, reopening it through `openValue`
  and writing the value to a `0600` file and appending exactly one `tool-result`, or typing it into
  the shell; cancel closes the call `cancelled`, a failed write, a gone shell and a sealed value that
  will not decrypt all close it `failed` with the reason; a malformed
  payload wakes nothing; two parked calls each get their own payload; a parked call that carried no
  request is ignored; a message closes every open call, legacy ones included; a turn that parks is
  closed once and never re-runs the tool.
- **Registry and route** (`apps/agent-host/src/operator-input/__tests__`): the posted entry carries
  the call id with the value, or the call id with `cancel: true`, and the call returns without a
  holder; the route refuses no bearer and an unknown bearer, the `requestId` body the shipped
  interface used to send, a value together with a cancel, a missing `callId` and an oversized value,
  answers the preflight with the cors headers, and answers `404` for another user's session.
- **Status** (`packages/core/src/record/__tests__/session-status.spec.ts`): a legacy asked/settled
  pair is record-only, so a request settling after a `run-failed` leaves the session failed instead
  of re-opening the turn.
- **DB** (`packages/db`): the drop migration applies and the contract no longer has
  `V2OperatorRequest`; `refs/db.json` keeps the PR-checks tallies.
- **Web** (`apps/web`): `sessions/__tests__/operator-request-dock.spec.tsx` (the earliest pending
  call is picked among the transcript rows, the body is exactly `{sessionId, callId, value}` with the
  stream bearer and exactly `{sessionId, callId, cancel: true}` on Cancel or Escape, stays submitting
  until the call settles, a `404 session` and a `400 body` refusal read as sentences);
  `threads/__tests__/operator-input-card.spec.tsx` (always the plain textarea and never a masked
  field, inline error, Cancel only when offered, locked while submitting);
  `threads/__tests__/transcript-request.spec.tsx` (a pending call draws nothing, the settled rows
  keep their Trace line and never render the value).
- **Parity**: the two `EXCEPTIONS` entries are deleted and the spec passes.

## 6. Out of scope

- v1 sessions, and the TUI/mobile surfaces.
- Per-tool approval prompts, or a free-form "ask the user" tool.
- Reading the value back out afterwards (`bash` does that).

## 7. Settled questions

1. **No row.** The parked call is the record: an answer names a `callId` and closes that call, so a
   request cannot outlive its call, drift from it, or need a status column, a sweep or a TTL. The
   row, its store and its migration were deleted rather than kept beside the event. A need for an id
   the control plane owns — routing an answer to another instance, or a queue across sessions — would
   bring a row back with a reason (§8).
2. **No deadline.** Nothing holds the request, so the card stays open across a redeploy and the pod
   sleeping, and an unanswered call closes only when the operator answers, cancels, or sends a
   message instead. v1's two-minute timeout
   (`packages/client/src/channel/request-timeout.ts:15-19`) exists to free a held terminal and has no
   counterpart here.
3. **The wake path stays operator-specific** — one inbox kind whose payload is the sealed answer —
   until a second tool parks. Parking itself is core's and generic; a resolver registry with one
   caller would be a seam, not a design.
4. **Sealed in the row, plain on the card.** The value is stored in the inbox entry encrypted with
   the agent host's secrets key, the `SecretCipher` that protects credentials, so a database dump
   hands over no code an operator typed; the request carries no `secret` flag and the card no masked
   input, because the threat is the row at rest, not the operator's own screen. What the harness must keep out
   is the transcript, the event log, the tool result and the model's context — not the control
   plane's own inbox.

## 8. Multi-instance answer routing (void)

Nothing holds an await, so nothing has to be routed: the answer is an ordinary inbox entry, and
whichever host holds or next claims the session delivers it. An answer received by instance A for a
session held by instance B simply wakes it through the inbox ring, the same way a message does. No
`V2Host.address` column, no proxy hop, no instance assumption.

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
