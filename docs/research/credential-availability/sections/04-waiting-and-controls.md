# 04 — Truthful waiting and provider controls

Status: buildable spec against `eeee3e7ef`; planning only. Shared authority is `$ATLAS_CONTEXT_DIR/contracts.md` (canonical): this slice consumes its `NormalizedProviderFailure`, `CredentialAvailabilityPort` (inspect/admit/promoteProbe/complete/control), `CredentialRevision`/`AvailabilityKey`/`AvailabilitySnapshot`, and probe promotion lifecycle without restating policy. No second account store or classifier. Cloud authority ships independently as03a (API keys) and03b (Cloud-owned OAuth) with the identical gate protocol.

## Delivered outcome and scope

When admission denies every authorized route, return **Waiting for model**, preserve work, and stop scheduling inference. Show one durable issue per unavailable account/fault scope, shared by affected agents rather than a toast per failed call. Operator can pause that account, remove only the manual pause, or request one bounded recheck. Ship web (including narrow/mobile layouts), local TUI and detached TUI/serve together. New deliberate model substitution is slice05; new automatic main substitution is not required. Preserve existing narrowly bounded helper/utility→eligible current-session recovery, gate each actual candidate and expose its effective identity; no new main automatic fallback or preference/pin rewrite.

## Evidence that determines the edits

All paths are repo-relative to `/atlas/workspaces/atlas`.
- `packages/harness/src/activity/state.ts:38–45` currently reports `working = turning || background`; `activity/binding.ts:45–47` considers Running children/shells background work. A waiting child must not remain Running merely to stay resumable.
- `packages/harness/src/activity/runtime-session-activity.ts:138–161` rebuilds activity from own log, roster and operator input. This is the durable read seam, not a frontend timer.
- `packages/harness/src/intake/message-intake.ts:221–256` already skips `driver.blocked()` but counts retries against changing input witnesses. Availability must block before that scheduler, not rely on its three-attempt budget.
- `apps/serve/src/turn-driver.ts:64–96,273–283` repeats `again` and registers wake eligibility; `apps/tui/src/composition/use-main-wake.ts:67–93` has separate local wake bindings. Both bind one shared eligibility predicate.
- `packages/harness/src/loop/tracked-turn.ts:88–123,225–261` settles pending tools and drains input before requesting a model; `loop/run-turn.ts:249–277` releases its sleep assertion when it returns and writes `run-failed` only for Failed. Waiting is a distinct outcome, not an indefinitely awaited Promise.
- `packages/harness/src/agents/registry/reasons.ts:9–14`, `stepped-status.ts:35–41` and `child-steps.ts:196–245` currently funnel outcomes into child endings. A new waiting outcome needs a non-ending path; otherwise the parent may respawn useful blocked children.
- `packages/client/src/transcript/run-attention.ts:54–101` derives current failure/remedies, and `apps/web/src/features/threads/data/use-run-attention.ts:67–79,95–120` currently wires Retry/Resume, provider settings and picker. `apps/tui/src/composition/use-run-attention.ts:41–82` uses the same projection. Extend that projection rather than inventing surface-specific retry policy.
- Web provider settings: `apps/web/src/features/settings/pages/providers.tsx:60–83,119–175`; terminal accounts: `apps/tui/src/ui/components/accounts.tsx:65–98,101–154`. Connected/login status is not availability and remains visible separately.
- Wire waiting is presently only input/approval: `packages/wire/src/session-wire.ts:39–47`, `request-wire.ts:42`, `sandbox-self-wire.ts:37`, `thread-routes-wire.ts:256`. Do not silently change its meaning.
- `packages/wire/src/turn-outcome-wire.ts:5–12,22–46` owns the actual turn enum/schema; client adds its TS union at `packages/client/src/channel/turn-outcome.ts:7–19` (harness re-exports it).

## Contract additions

Core new `packages/core/src/model-recovery/waiting.ts` owns pure types/projectors; use real TS enums. A durable wait episode is referenced by a DISCRIMINATED union, never a fabricated AvailabilityKey for faults that have no account authority:

```ts
export enum EWaitEpisodeKind {
  Credential = 'credential',
  ControlPlane = 'control-plane',
}
export type WaitEpisodeRef =
  | { kind: EWaitEpisodeKind.Credential; key: AvailabilityKey; generation: number }
  | {
      kind: EWaitEpisodeKind.ControlPlane
      code: string
      providerId: string
      modelId: string | null
    }
```

The `credential` arm reuses02's exact scope/revision/epoch (AvailabilityKey includes credential revision); no backend issue id is invented. The `control-plane` arm covers `AuthorityUnavailable`, missing runtime credential/configuration and other faults with no account identity; `code` is the normalized runtime fault code (e.g. authority-unavailable, credential-not-configured), and the episode key is code+provider+model. Clear events match the same discriminated value. Display grouping keys the credential arm on AvailabilityKey (excluding generation) and the control-plane arm on its code; one unresolved episode survives probe/paused/reason updates, a clear then a later block starts a new episode. Reason reuses01's `EProviderFailureKind`;03 reasonCode is mapped once. No secret/opaque admission receipt is included.

```ts
export enum EModelWaitCause {
  Availability = 'availability',
  ControlPlane = 'control-plane',
}
export type WaitingForModel = {
  episode: WaitEpisodeRef
  cause: EModelWaitCause
  providerId: string
  accountId: string | null
  modelId: string | null
  reason: EProviderFailureKind | null
  resetAt: string | null
  affectedThreadIds: readonly ThreadId[]
}
export enum EAvailabilityControlResult {
  Applied = 'applied',
  Available = 'available',
  Unavailable = 'unavailable',
  ProbeInProgress = 'probe-in-progress',
  Stale = 'stale',
  Unreachable = 'unreachable',
}
```

`resetAt` is nullable and must come from provider evidence, never a guessed date or a UI countdown. Include provider/account label, sanitized reason and provider/model scope in the read view. A missing runtime credential has `accountId:null` if identity cannot be proven; no pause-invalid-key action is offered for an unassigned account. Control-plane faults (including03's `AuthorityUnavailable`) produce the control-plane arm — the session waits rather than retrying or misreporting as auth — with a reconnect/configuration action, never account mutation. Do not treat absence of a reply or old serve support as eligibility.

Do not turn02's execution `CredentialAvailabilityPort.control({key,expectedGeneration,action}):Promise<AvailabilitySnapshot>` into a detached port. Add harness UI module `model-recovery/availability-control.ts` with `control({key,expectedGeneration,requestId,action:EAvailabilityAction}):Promise<{result:EAvailabilityControlResult;snapshot:AvailabilitySnapshot}>`, mapping labels Pause/RemoveManualPause/Recheck to existing Pause/Resume/Recheck. It checks03's expected secretVersion/control version for Cloud accounts via session-only procedures; snapshot/CAS determines Applied/Stale. `requestId` deduplicates UI submissions only. Recheck arms one normal next requested model-step probe under02/03's lease; it sends NO synthetic inference or tools itself. A waiting-session user explicitly confirms “Recheck and continue” (possible normal model charges), then one existing resume is scheduled after control returns; actual admission decides whether any request leaves. Recheck while paused cannot dispatch or clear pause. RemoveManualPause cannot clear quota/auth/cooldown and does not resume if an automatic barrier remains.

Extend `ETurnStatus` and client `TurnOutcome` with `{ status: ETurnStatus.WaitingForModel; runId: RunId; waiting: WaitingForModel }`. Add nullable/optional `waitingForModel` activity/read-status field, independent of `awaiting:'input'|'approval'|null`. Absent historical fields decode to null. Retain `working` for actual inference or useful background work, but render waiting explicitly even if a shell keeps `working=true`; never infer inference from that aggregate bit.

## Implementation order and exact files

1. Add core `model-recovery/waiting.ts`, `model-recovery/waiting-events.ts` and exports; add event bodies to BOTH `packages/core/src/events/body.ts` (EventBody union) and the matching zod discriminated-union arm in `packages/core/src/events/schema.ts` (the two drift apart silently; eventBodySchema must round-trip both): `model-waiting { waiting }` and `model-wait-cleared { episode, cause }` — episode is the same WaitEpisodeRef value; clear matches a control-plane episode by its code key, never by an invented credential identity. They are bookkeeping, not user speech and not turn-taking. Their pure projector selects the unresolved latest episode per WaitEpisodeRef grouping key (AvailabilityKey for credential episodes, code+provider+model for control-plane), merges affected targets and updates reason/reset with newer generations. Manual-only pause has reason:null and uses the paused overlay, never an invented provider failure kind. A control-plane outage episode also carries reason:null with a reconnect/configuration action. Do not append `run-failed` for denied admission. For concurrent child observations the runtime batches root issue publication and deduplicates under the existing session log writer queue (`packages/harness/src/store/sessions/event-log.ts:46–57`); an unchanged authority key/generation creates no new issue event. Reopen reconstructs it from the log, not component state. Preserve unresolved issues during compaction; rewind/fork must not cause duplicate notifications or change authority availability.
2. Extend02's local manual-pause overlay with persistence in existing vault metadata: optional `manuallyPausedAt:string|null` and `availabilityControlGeneration:number` on core Account schema, defaults null/0 historically. Add `AccountStorePort.setManualPause({accountId,expectedControlGeneration,paused}):Promise<StoredAccount>` and implement under the existing file-vault mutation lock with typed generation conflict; do not alter secret revision, health or settings. Local runtime loads this overlay before first admission and persists controls before replying; replacement preserves it. Cloud-account binding delegates03 session-only controls instead, never sandbox-token mutation. Only manual control is persisted here;02 transient local counters remain ephemeral. Update account DTO/vault serializers and AccountStorePort proxy/remote transport fixtures. Then add `packages/harness/src/model-recovery/wait-state.ts`: combines02 gate outcome and the durable projection, exposes `blocked({threadId}):boolean` and subscribable changes. `loop/tracked-turn.ts` converts gate denial to WaitingForModel at the model-step seam after pending settlement; retrying-step must pass through gate denials without sleep or `onGiveUp`. No new attempted-step count for a preflight denial. Already-admitted streams finish normally; shells/services and tool settlement are not aborted. If tools need operator approval, show that independently; do not disguise model availability as approval.
3. Edit activity `state.ts`, `types.ts`, `binding.ts`, `runtime-session-activity.ts`, `remote-session-activity.ts` to project waiting and clear it only on an authority eligibility/explicit route transition, not on reconnect, dismiss or a generic turn-start callback. Add `EAgentStatus.WaitingForModel = 'waiting-for-model'` to the canonical core enum (`packages/core/src/agents/status.ts:3–10`) plus its rendering branch in `agentEnding` (`:47–56`). Extend `agents/registry/child-state.ts`, `stepped-status.ts`, `reasons.ts`, `child-steps.ts`, roster snapshots/recovery: waiting stores the episode reference, clears `steppingSince`, leaves `endedAt` unset and produces no `agent-ended`, orphan inheritance, agentEnded telemetry or shell cleanup. Resume later uses the existing child id/log. Rebuild waiting children on reopen from the durable wait projection. Explicit Stop still records one real ending.

**Legacy-wire downconversion (capability-conditioned, all agent egress):** old clients strict-decode rosters — `agentSnapshotWireSchema` uses `z.enum(EAgentStatus)` (`packages/wire/src/roster-wire.ts:73–100,122–126`) and is embedded in `rosterWireSchema`, every agent reply (`agentOutcomeWireSchema`, `packages/wire/src/request-wire.ts:111–116`), and activity reads. A serve carrying WaitingForModel MUST downconvert at egress for any peer lacking `ECapability.ModelAvailabilityControls`: map to the existing nearest status `Paused` and keep truthful detail in the existing optional text fields, so no old client sees an unknown enum and no agent appears Running. Apply the same translation in EVERY egress path — roster snapshots, agent start/resume/stop replies, `read-activity`, and any broadcast carrying agent snapshots — via one shared wire helper (e.g. `wire/agent-compat.ts`, `downgradeAgentSnapshot({ snapshot, capabilities })`), never per-handler ad hoc. TurnOutcome WaitingForModel downconversion (status step above) uses the same capability gate. Real legacy-schema round-trip tests (old build's `agentSnapshotWireSchema`/`turnOutcomeWireSchema` parse new-serve output post-translation; ungated translation never reaches a capable client) are required; a test asserting the new enum passes the NEW schema is not sufficient.
4. Bind the same `waitState.blocked` into serve `turn-driver.ts` (both `again` loop and intake driver), local `use-main-wake.ts`/`use-driven-turn.ts` and the shared child wake/resume admission. Incoming shell notices, agent reports and drafts remain queued/durable; they do not clear the block, consume wake retries, or repeatedly create ledger rows. On successful explicit recheck-and-continue or explicit recovery, issue one wake per named waiting thread, coalesced by existing intake registration. Merely reaching reset time does not schedule inference: retain02/03's demand-triggered probe, no background timer or synthetic test. Show evidenced reset time, and require explicit continue/recheck or an independently requested step to claim the lease. A failed probe keeps waiting. A session already using another effective route is not moved back by the recovery notification.
5. Extend wire files above plus new `packages/wire/src/model-availability-wire.ts` with strict schemas for views/control requests/results; browser-safe exports from wire. Extend03's API account DTO/activity report/status read transport rather than adding an issues database. Waiting persistence is concrete: Thread (`packages/db/src/prisma/schema/threads/thread.prisma:2–19`) carries only `working Boolean`, `awaiting String?`, `lastOutcome String?`; `applyThreadActivity` (`apps/api/src/api/platform/sandboxes/thread-activity.ts:7–31`) writes just those three and `thread-status.ts:60–67` re-derives them per pod state. Add `waitingForModel String?` to Thread via a planned Prisma-8 migration in packages/db (`// use prisma-8` header, `bun run contract:emit`, `bunx prisma migration plan --name thread_waiting_for_model`, advance the db ref to the printed hash; no hand-edits, no guessed tip). The column carries the serialized waiting snapshot (issue key+generation, providerId/accountId, reason, resetAt). `sandboxActivityPostSchema` (`packages/wire/src/sandbox-self-wire.ts:34–39`) gains optional `waitingForModel: z.string().min(1).nullable()`; serve posts/clears it beside working/awaiting, old serve never sends it and old API ignores it (additive optional field). `applyThreadActivity` persists/clears it in the same update; a payload omitting the field leaves the column untouched. `thread-status.ts:60–67` returns it even when podState !== Running — unlike working/awaiting it is durable and not gated on pod liveness, because a parked pod is precisely when waiting must stay visible. Clear only on the same confirmed eligibility/explicit-route transition that appends model-wait-cleared and clears the runtime episode; generic turn start, resume, reconnect or dismiss never clears this column. Test a resumed turn denied again without any transient sidebar clearing. This requires no new execution checkpoint.
6. Extend client run-attention with waiting first (supersedes stale failed-step card for that episode), render a single root issue with expandable affected-agent links and per-child status references. Add `apps/web/src/features/threads/transcript/model-wait-card.tsx`, `data/use-model-availability.ts`, `features/settings/parts/account-availability-controls.tsx`; wire via existing `thread-source.ts`, `use-run-attention.ts`, `thread-transcript.tsx` and providers page. Settings controls list each concrete account, not only the subscription/API key chosen by today's helper; account status must never mutate `model.id`, `model.effort`, account preference or a frozen child's model. Add TUI `ui/components/model-wait.tsx` and `composition/use-model-availability.ts`; extend accounts model/actions/modal and failure strip to dispatch the shared control, not direct `retry()`.

## UI behavior, including failures

- Heading **Waiting for model**; detail e.g. “Anthropic · Work account: monthly allowance exhausted. Provider reset: not supplied.” Include last checked timestamp and affected count. Account identity is never a key fragment. Unknown reason becomes “Model access unavailable” with sanitized details, not “invalid key.”
- Slice04 primary action is **Recheck access**, secondary **Providers**; paused issue primary **Remove manual pause**. Explain local-only scope for local authority; both local and Cloud manual pause persist across restart as specified below. Slice05 replaces primary with **Continue with another model**. No generic Retry bypass while gate denies. A dismiss/collapse action hides detail only; status remains waiting. Keep permanent account state out of transient toasts.
- Provider account row has “Connected” and separately “Paused by you”/“Allowance exhausted”/“Checking access”; Pause confirmation names account and affected-session count and warns in-flight work will finish. Account control is user-scoped only where03 owns the account; signed-out host control is local-authority-scoped and labelled “On this machine.”
- Pending action disables only its account's conflicting controls, not the whole page; render inline pending text, then updated state. Stale revision reloads and asks user to retry; transport error preserves the prior issue and action error beside the control. Empty affected list says “No sessions currently waiting”; missing account offers Providers/configuration fix; models-list failure must not look like an empty eligible list.
- Web: reuse existing Alert/Button/Sheet patterns and tokens, `role=status` with polite one-time announcement keyed by issue episode, no repeated countdown announcements, labelled controls, visible keyboard focus, Escape closes detail and returns focus. At 320/375px actions stack, labels wrap, details and affected targets scroll; primary action stays visible, no horizontal overflow. Loading only the action uses a spinner, not the waiting transcript. Screen reader text describes cause and any background work separately. Input/approval retains its own accessible region.
- TUI: same copy/action availability via shared view, arrows/Enter/Escape through account/picker conventions, mouse targets use `useClickRegion` hover, one text with spans per row, no ticking React state for waits; narrow terminals wrap descriptions without clipping account identity/reason. Keep a static waiting indicator; child and root sidebar labels must not animate as Running.

## Feature/runtime/transport slots and release

- Feature: core waiting projection + harness wait-state/scheduler;02/03 own availability decision/control. Runtime: the same composed wait-state/activity binding for host local and serve sandbox, account control uses02/03 local/Cloud adapter. No UI owns admission policy.
- SessionActivityPort already has detached registry/binding (`packages/harness/src/composition/port-bindings.ts:15`); extend its existing remote activity adapter and read/status schemas. CredentialAvailabilityPort remains registered once by02/03 as shared runtime with explicit transport:none/null. UI module maps local authority or Cloud session-only controls. Web uses browser-safe03 tRPC controls; signed-in TUI uses its user's bearer, never sandbox credentials for manual mutation. For detached local-authority sessions add capability-gated ReadModelAvailability/ControlLocalModelAvailability serve requests and a browser-safe channel client; serve refuses Cloud-account manual controls through this path. These adapters carry the same UI module, not another admission implementation. No new independent session port in04. Harness's private wait-state is not a session port and explicitly has no detached transport; its projection travels activity/events.
- Add `ECapability.ModelAvailabilityControls` and advertise only when runtime control+waiting projection are bound; the same capability gates the WaitingForModel/agent-status downconversion described above, and the handshake capability set is captured at connect (already parsed at greet, `packages/wire/src/capabilities.ts:44–54`) so egress uses the peer's advertised set, not a guessed version. Missing capability disables mutation with “Update/restart this session to manage model access”; never send new requests to an old serve. Additive activity fields are safe to strip. The new outcome enum is NOT safe for an old client: increment channel protocol32→33 while retaining minimum29, and at serve egress translate WaitingForModel to an existing Failed outcome with actionable waiting text for peers lacking the capability. Test old/new schemas and gates; this does not reopen retries in harness. Do not raise the minimum simply for this slice.
- `feat` release required for serve/TUI/web/Mac; the Thread.waitingForModel migration deploys through the existing `migrate-production` check before API code reads it, and released serve posts it only after that deploy. Regenerate committed api-router output if DTO/router signatures change. Keep web static-export safe. Completion includes real Bun binary builds AND the full web production build (`bun run --cwd apps/web build`), not typecheck alone.

## Proof and commands (implementation phase, not run by this planning pass)

New specs: core `model-recovery/__tests__/waiting.spec.ts`; harness `model-recovery/__tests__/wait-state.spec.ts`, `intake/__tests__/model-wait.spec.ts`, `agents/registry/__tests__/waiting-for-model.spec.ts`; wire `__tests__/model-availability-wire.spec.ts`; serve `src/__tests__/model-wait.spec.ts`; web `features/threads/data/__tests__/use-model-availability.spec.tsx`, settings controls and narrow card specs; TUI `composition/__tests__/model-wait.spec.tsx`, `ui/__tests__/model-wait-render.spec.tsx`. API's colocated `thread-status.spec.ts` proves parked/reopen persistence through the stored column, and `sandboxes/thread-activity` specs prove the post/clear semantics (old payload without the field leaves the column untouched).

Prove 30 blocked children produce one issue, zero additional provider requests or wake churn after changing pending-input witnesses; existing shell continues and reports its ending once. Reopen/second client retains issue; credential replacement rejects old observation/control; independent accounts remain selectable; provider-known reset and unknown reset differ; manual pause outlives recheck; local and Cloud manual pause outlive restart via their existing account authorities; one probe lease across clients; unavailable control plane never appears as auth rejection. Verify no child ending while waiting, input/approval coexistence, route recovery wake exactly once, persisted waiting after pod park, disabled old-serve actions, keyboard/focus and no idle TUI frames. Legacy-schema egress tests in wire/serve: an OLD build's `agentSnapshotWireSchema` and `turnOutcomeWireSchema` parse every roster/agent-reply/activity/turn payload produced by a new serve after capability-gated downconversion (WaitingForModel → Paused on agent snapshots, Failed-with-waiting-text on turn outcomes), and a client advertising the capability receives the untranslated enum.

Run from repo root, after `bun install --frozen-lockfile` when implementation starts:

```sh
bun run --cwd packages/core test src/model-recovery
bun run --cwd packages/harness test src/model-recovery src/activity src/intake src/agents/registry
bun run --cwd packages/wire test
bun run --cwd packages/client test src/transcript
bun run --cwd apps/serve test src/__tests__/model-wait.spec.ts
bun run --cwd apps/web test src/features/threads src/features/settings
bun run --cwd apps/tui test src/composition/__tests__/model-wait.spec.tsx src/ui/__tests__/model-wait-render.spec.tsx
bun run --cwd apps/api test src/api/platform/sessions/thread-status.spec.ts
bun run typecheck
bun run lint
bun run --cwd apps/serve build:serve
bun run --cwd apps/tui build
bun run --cwd apps/web build
bun run --cwd apps/web build:desktop
```

UI implementation must additionally inspect rendered web at desktop/375/320px and narrow TUI with the above failure/pending states. No rendering or tests were claimed in planning.
