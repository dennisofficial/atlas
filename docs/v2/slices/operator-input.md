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
  session in web shows the card above the composer, not in the transcript.
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
   (`pending | answered | cancelled | expired | failed`), `createdAt`, `expiresAt`, `resolvedAt?`.
   **No value column exists and none may be added.**
2. **Two events** in `plugins/operator/src/core/request.ts`:
   `operator-input-asked {requestId, kind, prompt, secret, shellId?, expiresAt, sessionId}` and
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

export type PodOperatorDelivery =
  | { ok: true; path: string; bytes: number } // kind: 'input'
  | { ok: true; shellId: string; bytes: number } // kind: 'shell'
  | { ok: false; reason: string } // cancelled | expired | failed

export type PodOperatorInput = {
  ask(args: { ask: PodOperatorAsk; signal: AbortSignal }): Promise<PodOperatorDelivery>
}
```

`EMPTY_OPERATOR_INPUT` answers `{ok: false, reason: 'this session cannot ask the operator for
input'}`, so every pod fake keeps compiling. **The value is never part of the answer**: the host
adapter delivers it, so the tool's arguments and result — both recorded in the event log — cannot
contain it. `childDeny: ['operator_input', 'operator_shell_input']` on the plugin's pod slot keeps
v1's rule that only the main session asks (`PodSlot.childDeny`, `packages/plugin-sdk/src/slots.ts:100`).

Model text, mirroring v1's so a model behaves the same way:
- file: `the operator's value was written to <path> (N bytes, mode 0600). Read it from there and
  never paste it into a message.`
- shell: `the operator's value was typed into the stdin of shell <shellId> (N bytes). Read the shell's
  output to see what the CLI did with it.`
- cancelled/expired/failed: v1's sentence naming the reason, plus that no value arrived.

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
2. The registry (`apps/agent-host/src/operator-input/registry.ts`) inserts the `pending` row, returns
   `{requestId, expiresAt, answered, abandon}`, and arms the deadline (`expiresAt = now + 15 min`).
3. The adapter appends `operator-input-asked` with that id and deadline, then awaits `answered`, raced
   against `signal`.
4. An abort calls `abandon('cancelled')`; the deadline resolves `{ok: false, reason: 'expired'}` and
   writes `status = expired`.
5. On `{ok: true, value}` the adapter `mkdir`s `requests/`, writes the file (or the shell), appends
   `operator-input-settled {outcome: 'delivered', path, bytes}` and returns the delivery. A failed
   write appends `outcome: 'failed'` with the reason and returns `{ok: false}`.

**Answer** (`apps/agent-host/src/operator-input/route.ts`, mounted beside `mcpOauthBegin`):
1. `POST /operator-requests/answer`, CORS as `begin-route.ts:29-50`, bearer → `resolve(bearer)`.
2. `{requestId, value}` resolves the pending request only when `entry.userId === principal.userId`;
   `{requestId, cancel: true}` cancels. Answers `200 {}`, `401 bearer`, `403 request`, `404 request`
   (unknown or already settled), `400 body`, `409 not_held_here` when the waiting call is not in this
   host's registry.
3. `maxLength` 64 KiB on `value`; the body is never logged.

**Card** (`apps/web`): `EEntryKind.OperatorRequest` (`packages/client/src/transcript/transcript-model.ts`)
→ `ETranscriptKind.Request` row → `transcript/transcript-request.tsx`: the prompt, an `Input`
(`type="password"` when `secret`), Submit and Cancel, disabled while sending, and the delivered /
expired / cancelled states. Submit posts to the route with `fetchStreamToken()`, and the row settles
when the stream delivers `operator-input-settled`.

**Fold** (`plugins/operator/src/client/request-entry.ts`): pair by `requestId`; an entry whose
`expiresAt` has passed with no settlement reads as `expired`, so a dead host leaves no live-looking
card.

## 5. Test plan

- **Pod** (`plugins/operator/src/pod/__tests__`): both tools pass the schema's values to the port,
  return the path/shell sentence, turn a refusal into the reason sentence, and never echo the port's
  value (the double answers a marked string; the test asserts it is absent from `modelText`);
  `childDeny` hides both from a sub-agent.
- **Fold** (`plugins/operator/src/client/__tests__`): asked alone is pending; asked + settled is
  delivered/expired/failed; a passed deadline with no settlement reads expired.
- **Registry** (`apps/agent-host/src/operator-input/__tests__`): `open` writes a `pending` row,
  `answer` resolves and marks it `answered` once, a second answer is `404`, expiry resolves and marks
  `expired`, `abandon` marks `cancelled`.
- **Adapter** (`packages/host/src/holder/__tests__`): asked then settled events in order, the file
  written at `<sessionDir>/requests/<id>` with `0600` and the value, `shells.write` for the shell
  kind, abort → `cancelled`, expiry → `expired`, no event payload contains the value.
- **Route** (`apps/agent-host/src/operator-input/__tests__`): bearer, ownership, unknown id,
  `409` off-holder, cancel, and the body cap.
- **Control/db**: migration applies; `packages/db/src/__tests__/v2-smoke.spec.ts` covers the row.
- **Web** (`apps/web/src/features/threads/__tests__/transcript-request.spec.tsx`): prompt, masked
  secret field, one submit then disabled, cancel, and the settled states.
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
2. **Deadline**: 15 minutes is a guess. v1 gives a remote answer two minutes
   (`packages/client/src/channel/request-timeout.ts:15-19`); a transcript card can stay open longer
   without holding a terminal.

## 8. Multi-instance answer routing (deferred shape)

An answer must reach the host whose process holds the await. The lease names the holder
(`V2Lease.holderHostId`, `packages/db/src/prisma/schema/v2/lease.prisma:3-11`) and `V2Host` has no
address (`host.prisma:3-7`), so the shape is: `V2Host` gains `address`, the host registers its own
base URL at boot, and the route proxies one hop when it is not the receiving instance. Not built
while production runs one instance; it is a column and a fetch, not a redesign.
