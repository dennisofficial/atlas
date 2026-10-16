# Evidence: legacy cloud-container lifecycle sweep (born-placed)

Source: explore agent "hunt legacy cloud features" (brn_f5c30ef3), 2026-10-15.
Scope: lifecycle features whose reason-to-exist was lift/descend or mid-life movement.
Anchors are path:line against the worktree (origin/main).

## Two overloaded "rotation"s — do not conflate

- **Conversation rotation** (`packages/harness/src/rotation`, `RotationPort`) — summarize/compact
  context on operator request. Unrelated to sandboxes. KEEP in both worlds.
- **Sandbox rotation** (`/v1/drain`, drain client, swap lock, rotation receipt) — swaps the running
  serve binary in a sandbox that outlives park/wake, triggered on wake when the client's pinned
  serve version / wire protocol drifted (`resume-probe.ts:258-310`). NOT lift-specific — it is the
  upgrade path for parked-then-woken sandboxes. The reevaluation is whether born-placed wants
  in-place serve swaps at all vs delete-and-recreate.

## KEEP — born-placed steady state

- Idle-park: `idle-stop.ts:15` (SERVE_IDLE_MINUTES=5) → `sandbox-park.ts:4` → driver.stop. Billing.
- Park lifecycle + `finalizePark` checkpoint; runtime-checkpoint schema + API store
  (`sandbox-checkpoint.controller.ts`); `Running`/`Parked` phases serve parked-resume freshness.
- Wake/reattach escalation (`local-cloud-bootstrap.ts:94-120`), `reattachSandbox`
  (`local-cloud-reattach.ts:5-11`).
- Resume probe `probeSandboxForResume` (`resume-probe.ts:185-311`) as drift detector — Missing/
  Kept/Replaced outcomes needed on every wake. The `Swapped` (in-place) outcome is the suspect half.
- Transcript freshness + mirror (`transcript-freshness.ts:29-75`, `transcript-syncer.ts:34`,
  `mirrored-event-log.ts`) — the live attach model for any cloud session.
- Git credential broker (`apps/api/.../git-credentials.ts:20-45`) — resolves a fresh token on every
  workspace-spec fetch; spec is re-fetched on wake boot, so this IS the answer to the post-park
  stale-token gap. KEEP.
- Workspace-spec fetch + git access env (`workspace-spec.ts:30-50`, `git-access-env.ts:11-16`,
  re-applied `environment-profile.ts:110-155`).
- `readGhAuthToken` (`gh-auth-token.ts:37`), keepalive (`keepalive.ts:9`), context-archive fetch
  retry, API graceful-shutdown.

## REMOVE / REEVALUATE — existed for the move model

- **Serve drain protocol (`/v1/drain`)**: `serve-drain.ts:12-62`, `serve-drain-binding.ts:11-80`,
  client `serve-drain-client.ts:139-180`. Moves a LIVE session between serve binaries without losing
  in-flight work. Born-placed never moves; the only remaining trigger is wake-time serve upgrade on
  a parked sandbox, which by definition has no in-flight turn (drain client already bypasses idle
  serves at `serve-drain-client.ts:147-151`). REEVALUATE → replace with delete-and-recreate on drift.
- **Sandbox swap lock** (`sandbox-swap-lock.ts` whole) — serializes in-place swaps; dies with swap.
- **Rotation receipt/intent + recovery**: `sandbox-rotation.ts` (whole), `sandbox-rotation-receipt.ts`,
  `serve-rotation-recovery.ts` (whole), `persistSandboxRotationIntent/Receipt`. Durable resume
  obligation log for the replacement serve. REMOVE if drain goes.
- **`ERuntimePhase.Rotating` + `finalizeRotation`** (`runtime-checkpoint.ts:7`,
  `runtime-checkpoint-binding.ts:60`) — keep checkpoint, remove the phase with drain.
- **In-place serve swap (`Swapped`)** (`resume-probe.ts:230-232,280-282`, `swapServe` at
  `vercel-driver-provision.ts:162-170`) — preserves off-drive filesystem; born-placed keeps durable
  state on the drive, so recreate (`Replaced`) is simpler. AMBIGUOUS: swap may survive only as a
  boot-latency optimization (warm off-drive caches), not correctness.
- **Wedge-proof / drain-refusal classification** (`serve-drain-client.ts:49-137`, the "cannot confirm
  safe relocation preparation" wedge) — the live-wedge failure mode exists only to prove relocation
  safety. No relocation → no gate. REMOVE with drain.
- **`rotationPreparationVersion`** (`serve-boot-listener.ts:38,59`).
- **Descend export surface**: `workspace-archive-transport.ts:166-207` (download/release),
  `session-archive-transport.ts` (whole), serve `serve-session-archive.ts` (whole) +
  `archive-requests.ts:5-23` (`ReadSessionArchive`), bridge `cloud-bridge.ts:85-91`
  (`downloadSession`/`releaseSession`), `drive-bootstrap.ts:17,78-79` export dir. Born-placed
  transcripts sync live over the mirror; nothing downloads a tarball back. REMOVE.
- **Transcript archive bootstrap at serve boot**: `transcript-bootstrap.ts` (whole),
  `materialize-transcript.ts` (whole), `driveTranscriptArchiveFetcher` (`drive-bootstrap.ts:58-69`),
  boot call `serve-boot.ts:118-141`, upload `TRANSCRIPT_ARCHIVE_PATH` + `bootstrap-archive-uploads.ts:19-26`.
  A cloud birth has no transcript; this restores a LIFTED session's event log. REMOVE.
- **API transcript-archive store/routes**: `sandbox-context.controller.ts:25-33` (`GET
  /v1/sandboxes/transcript`), `sandboxes.service.ts:241-253`, `context-archive.store.ts` /
  `prisma-context-archive.store.ts` `readSandboxTranscript`/`writeSandboxTranscript`. No serve caller
  (serve reads the drive fetcher). REMOVE.
- **Lift provenance `projectDirectory`** in workspace spec (`workspace-spec.ts:20-21`) — Mac-side
  origin bookkeeping for descend-back. REMOVE.
- **Descend merge baseline** in `materialize-workspace.ts:91-101` (sentinel for descend to merge
  against). REEVALUATE — sentinel may still serve publish-workspace flows.
- **`LiftedWorkspace` type + lift vocabulary** on bridge (`cloud-bridge.ts:21,55,63-64`).
- **OAuth "cannot be lifted" error text** (`cloud-oauth-sandbox.ts:81,106,116,119`) — the CHECK stays;
  the lift-framed wording is move-model. Reword/re-anchor to birth.
- **`history-admission.ts` `Rotation` reason** (:6) — goes with drain if unused elsewhere.

## Genuinely ambiguous — flagged, not guessed

- In-place swap vs recreate (boot-latency residual value).
- `bootstrapArchiveUploads` workspace leg — sibling agent's territory.
- TUI `useContainerMove`/boot overlay — not deeply swept; deserves its own pass if the refactor
  touches the location/move overlay.

## Net read

Born-placed keeps: park (billing), wake/reattach, resume-drift-detection, transcript mirror/freshness,
git credential broker, spec re-fetch on wake. The move-model machinery that goes: drain + swap-lock +
rotation-receipt + in-place swap (the whole "move a live session between serve binaries" stack) and
the descend export/transcript-archive lanes. Biggest single simplification after the workspace
archive: **replace drain/in-place-swap with delete-and-recreate-from-drive on any version drift.**
