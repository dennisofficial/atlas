# Slice 4A review follow-ups (slice 4A merged as PR #1644; these carry into 4B)

Source: reviewer brn_d02bf35c (completed after a long wedge). Slice 4A is merged; these are the
findings to fold into slice 4B.

## P1 — fold into 4B

- **`waitingFor` on agent snapshots is dead code + a wire leak.** `packages/harness/src/agents/registry/snapshot.ts:42`
  adds `waitingFor?: WaitEpisodeRef` to `AgentSnapshot`, filled by child-state/recovery/stepped-status,
  cleared by child-steps — but NOTHING reads it, and `agentSnapshotWireSchema`
  (`packages/wire/src/roster-wire.ts:74-101`) does not declare it, so zod strips it for capable clients
  while raw reply frames can carry it as an undocumented extra key. **Fix in 4B: delete the field
  everywhere** (recommended — 4B's card reads the waiting state from the read-activity
  `waitingForModel` field, not the snapshot). If a real consumer appears, reintroduce it with a schema
  slot AND make `downgradeAgentSnapshot` aware of it. Do not leave both.

## P2 — schedule in/after 4B

- `apps/serve/src/__tests__/model-availability-egress.spec.ts` is 315 lines (>300 cap) — split legacy
  vs capable describe blocks into sibling spec files.
- `activity/waiting.ts currentWaiting` returns only `projectWaiting(...)[0]` — a thread blocked on two
  episodes projects one issue through read-activity. 4B's card must not treat it as complete episode
  state (multi-episode is supported by `unresolved()`).
- `wait-state.ts:113-121 reconcile` had no caller in 4A; Builder 1 (4B control path) wires it. If it
  stays uncalled after 4B, delete it.
- `frame-egress.ts:20-31` encode-once-per-capability caching assumes a binary capable/legacy split —
  a future third capability relevant to agent/turn payloads would go stale. Note only.
- 4B scope reminder (not a defect): a pod parked while waiting shows no issue on reopen until 4B's
  `Thread.waitingForModel` persistence lands (Builder 2).
- Slice-05 note: `tracked-turn.ts` `admitted()` clears every unresolved episode on any successful step
  without checking the admitted key matches the blocked key — correct for one-model-per-session in 4A/4B,
  but slice 5's substitution must move the authority check into `admitted` (a wait for credential A must
  not clear when credential B admits).
