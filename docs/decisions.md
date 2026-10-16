# Decisions — cloud-born clone-only revamp

- **Clone-only birth.** Cloud sessions clone from origin inside the sandbox. No local files, git
  state, worktrees, or uncommitted work cross over. Dennis, 2026-10-15: "not a real issue if
  local state doesn't go over; start very simple, easy to maintain, don't solve problems we don't
  have yet."
- **Delete the tar transfer subsystem, don't shrink it.** ~4,200 LOC capture + ~1,450 LOC restore +
  upload transport + wire schemas. In the born-placed world it fails the deletion test — its
  complexity vanishes rather than reappearing across callers.
- **`family-ownership` stays.** It is session-local infrastructure seeded by the thread store
  (`thread-store-history.ts:22`), used for worktree claiming — unrelated to transfer. Only the
  family *transfer* modules (snapshot/capture/proof/arrival) die with the archive.
- **`releaseWorktree` / `claimWorktree` stay.** Generic worktree-lock machinery with many callers;
  only the `cloud-birth.ts:184` call site goes away.
- **Unpushed work dies with the sandbox.** No descend, no sync-back. The agent pushes branches;
  the 7-day drive retirement is the only retention. Documented, not engineered around.

## Resolved fork — which ref the clone lands on

Dennis ruled 2026-10-15: **the remote is the only truth; local HEAD is never consulted.** His
stated reason: "my agents exploring a stale codebase" is a real problem — a local checkout's HEAD
can be completely outdated, and a cloud sandbox must start from what origin says right now.

The remaining sub-choice — always the default branch vs. remote tip of the currently-checked-out
branch — is narrowed to **always clone the default branch** (recommended): no local inspection at
all, matches the read-only-main + fresh-worktree convention, and fully solves the stale-codebase
problem. The "continue this feature branch in the cloud" case is deferred to an explicit branch
picker at birth (a later iteration), never inferred from cwd.

This ruling dissolves the earlier dirty-checkout fork: with nothing local read, there is nothing
local to check. The `WorkspaceSpec` no longer needs `branch`/`commit` populated by the client for
the default-branch flow; `githubToken` still carries the clone credentials.

Confirmed by Dennis 2026-10-15: always the default branch, no branch picker for now. The
"continue this feature branch in the cloud" capability is deferred to an explicit picker at birth
(a later iteration), never inferred from cwd.

## Rulings on the three open questions (2026-10-15)

- **Drain / in-place swap: KEEP.** Serve and TUI must run the same Atlas version (no cross-version
  compatibility). Version drift is reconciled by swapping the serve binary **in place** on
  wake/reconnect; the sandbox, temp files, and downloaded packages stay. Do NOT delete the sandbox
  and recreate from the drive — that discards off-drive state the session depends on. The drain
  protocol (`/v1/drain`, swap lock, rotation receipt) exists for the busy case of that swap (a
  serve with an in-flight turn must freeze before its binary is replaced) and stays. The earlier
  "replace drain with delete-and-recreate" suggestion was wrong about what drain is for; corrected.
- **Transcript-archive lane: DELETE.** Verified: no live code path sets `transcriptArchivePath` —
  the only producers are test fixtures and the plumbing itself (`local-cloud-bridge.ts:118`
  forwards an always-`undefined` value). The whole lane (upload, `materializeTranscript`,
  `GET /v1/sandboxes/transcript`, API transcript store) was only reachable from the deleted lift
  path. Dead code.
- **Dormant-boot gate: DROP, boot to ready.** The dormant flag only sequenced "don't go live until
  the client confirms the workspace restore." With no archive there is no restore to confirm.
  `startChildren` (`serve-workspace-session.ts:29-53`) already runs on boot when not dormant and is
  idempotent/no-op on a genuine first birth — it is crash-recovery, not a client-triggered cost
  gate. Drop `ActivateSession`, the dormant flag, and the `workspace-session.ts` gate; serve boots
  to ready once its clone finishes. Caveat for the implementer: `serve-rotation-recovery.ts:119`
  currently reads `session.dormant()` to gate `startChildren` during a swap — that path must not
  assume dormancy exists once the flag is removed.
