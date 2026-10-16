# Slice 3+4 — delete the transfer subsystem, descend export surface, transcript lane, dormant gate

**Goal.** Remove everything slice 1+2 stopped calling. This is pure deletion + reference cleanup;
no new behavior. Run after slice 1+2 lands green.

**Constraint.** Deletion, not shrink-wrap. Confirm each target is unreferenced (grep) before
deleting. Keep `family-ownership*`, `worktree-lock.ts`, the drain/swap/rotation stack, park/wake,
transcript mirror, and the git credential broker — those stay (see decisions.md).

## Slice 3 — transfer subsystem + descend export surface

**Delete `packages/harness/src/workspace/transfer/` wholesale** (~37 impl + ~38 spec files):
all `capture-*.ts`, `restore-*.ts`, `archive.ts`, `manifest.ts`, `git-state.ts`,
`cleanup-proof*.ts`, `source-coverage.ts`, `export-primary.ts`, `family-snapshot.ts`,
`family-restoration-proof.ts`, `family-manifest.ts`, `plain-receipt.ts`, `workspace-archive.ts`,
`__tests__/`. First relocate the one external fixture consumer:
`packages/harness/src/composition/__tests__/family-arrival-lock.spec.ts:11` imports `git` from
`transfer/__tests__/capture-fixture` — move that fixture helper somewhere neutral or inline it.

**Core transfer modules:** `packages/core/src/workspace/transfer/` (`family-restoration-proof.ts`,
`family-manifest.ts`, `cleanup-reasons.ts`, `cleanup-verdict.ts`) and the barrel line
`packages/core/src/index.ts:99`.

**Harness barrel:** remove `packages/harness/src/index.ts:102-110` (transfer/manifest, capture,
source-coverage, cleanup-proof, family-snapshot, export-primary, restore) and :110
(workspace-archive), :112 (workspace-archive-transport), :113 (legacy-workspace-directory). Also
:109 `workspace-arrival` — delete `packages/harness/src/workspace/workspace-arrival.ts` and
`family-arrival.ts` (restore-outcome bookkeeping; serve `workspace-hooks.ts:11,119-120` and
`serve-app.ts:147-149` callers die too).

**Cloud transport:** delete `packages/harness/src/cloud/workspace-archive-transport.ts` (whole —
upload :88, download :186, release :198, `exportedWorkspacePathOf` :166),
`bootstrap-archive-uploads.ts` (whole), `legacy-workspace-directory.ts`,
`session-archive-transport.ts` (whole), `archive-file.ts`, `archive-download.ts` (if only used by
the deleted lanes — confirm `ReadSessionArchive` decision), `archive-build-progress.ts` (if only
consumed by capture + session-archive), `transfer-progress.ts`, `buffered-transfer.ts` (check
context-archive still needs it).

**Serve receiving end:** delete `apps/serve/src/direct-workspace.ts`, `direct-arrival.ts`,
`workspace-ops.ts` (whole), `serve-session-archive.ts` (whole), `archive-requests.ts:5-23`
(`ReadSessionArchive` handler). Remove dispatch in `socket-requests.ts:31-33,240-241`,
`socket-session-types.ts:20-22`. Remove `driveWorkspaceReceiptPath`/`driveWorkspaceArchivePath`/
`driveWorkspaceExportDirectory`/`driveTranscriptArchiveFetcher` from `drive-bootstrap.ts`.

**Wire:** delete `packages/wire/src/workspace-transfer-wire.ts` (whole). Remove
`EClientRequest.ApplyWorkspaceArchive` (:83) and `EClientRequest.ActivateSession` (:84) from
`channel-wire.ts`, the reply schemas, the re-exports in `packages/harness/src/cloud/channel-wire.ts:40-42,99-105`,
`request-timeout.ts:19-21`, `remote-channel-upstream.ts:54-55` allowed-resend entries. Remove
`packages/wire/src/cloud-workspace-path.ts` (sole caller cloud-birth died). Decide
`ReadSessionArchive` op — descend-direction; remove unless something else reads it.

**API descend/transcript stores:** remove `downloadSession`/`releaseSession` plumbing and the
transcript-archive routes (`apps/api/src/api/platform/sandboxes/sandbox-context.controller.ts:25-33`,
`sandboxes.service.ts:241-253`, `context-archive.store.ts`/`prisma-context-archive.store.ts`
`readSandboxTranscript`/`writeSandboxTranscript`). Leave DB columns/columns nullable; stop writing.

**TUI test fixtures** referencing the deleted ops: `composition/cloud/__tests__/fixture.ts:272,321-341,749-778`,
`composition/__tests__/app-cloud-archive-fixture.tsx:28-31`, `app-born-placement-chip.spec.tsx:103`,
serve `__tests__/workspace-transfer.spec.ts` (whole), `booting-handshake.spec.ts:275`,
`history-mutation-admission.spec.ts:17`, harness `remote-channel-upstream.spec.ts:390-400`.

## Slice 4 — transcript-archive lane + residual dormant plumbing

Delete the transcript bootstrap lane end to end:
- Client: `transcriptArchivePath` field (already removed from the contract in slice 1+2 — clean up
  `bootstrap-archive-uploads.ts` if it survived slice 3, `TRANSCRIPT_ARCHIVE_PATH`
  `local-cloud-bootstrap.ts:32`), `VercelDriver.transcriptLanded` (`vercel-driver.ts:247`).
- Serve: `apps/serve/src/transcript-bootstrap.ts` (whole), `materialize-transcript.ts` (whole),
  `driveTranscriptArchiveFetcher`/`FetchTranscriptArchive` (`drive-bootstrap.ts:58-70`,
  `workspace-spec.ts:74`), the boot call (already removed in slice 1+2 `serve-boot.ts:118-141`).
- API: the `GET /v1/sandboxes/transcript` route + store (covered above).

Dormant-gate residue: confirm no remaining reference to `dormant`, `markActivated`,
`ActivateSession`, or the `workspace-session.ts` gate after slice 1+2's E. Adjust
`serve-rotation-recovery.ts:119` if not already done.

## Validation

- `git grep` shows zero references to: `workspace/transfer`, `captureLiftWorkspace`,
  `captureWorkspaceFamily`, `verifyFamilyRestoration`, `ApplyWorkspaceArchive`, `ActivateSession`,
  `transcriptArchivePath`, `TRANSCRIPT_ARCHIVE_PATH`, `downloadWorkspaceArchive`,
  `releaseWorkspaceExport`, `direct-workspace`, `workspace-arrival`, `family-arrival`,
  `WORKSPACE_EXPORT_DIRECTORY`, `cloudWorkspacePath`, `legacyWorkspaceDirectory`.
- `bun run typecheck` green; `bun test` green.
- Spec count drops substantially; no spec deleted that covered behavior still present.

**Hand to slice 5:** rename lift vocabulary (`liftNewborn`, `preflightLift`, `CLOUD_LIFT_NOTICE_KEY`,
lift-framed OAuth errors) and rewrite `docs/architecture.md:1393-1563` to describe born-placed
clone-only birth.
