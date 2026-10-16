# Evidence: birth-path simplification inventory (clone-only ruling)

Source: explore agent "enumerate birth simplifications" (brn_c53b8f4a), 2026-10-15.
Scope: everything dead/simplifiable once a cloud birth clones the default branch and only
`remoteUrl` + `githubToken` cross. Anchors are path:line against origin/main.

## Keep (birth still needs)

- `CloudSandboxes.create`: `threadId`, `model`, `captureContext` (the skills/memory tar),
  `onTransferProgress` (simplified), `onRotationStarted`, `onSettleWait` — `cloud-bridge.ts:53-83`.
- `WorkspaceSpec`: `remoteUrl`, `githubToken`, `model` — `apps/serve/src/workspace-spec.ts:11-24`.
- Clone core in `materialize-workspace.ts`: clone+disarm-remote (:158-168), `httpsRemoteOf`
  (:58-62), `credentialedRemoteOf` (:64-68), token scrub (:149-150), empty-dir skip (:140-147),
  sentinel presence-check (:121-130), `workspaceRefusalOf` (:215-218).
- `workspace/family-ownership*.ts`, `worktree-lock.ts` (`releaseWorktree` non-birth callers),
  `probe.ts`, `worktrees*.ts`, `run-git.ts`, `git-text.ts`, `snapshot.ts`, `git-config-env.ts`,
  `process-identity.ts`.

## Dead — bridge contract & spec fields

- `workspaceArchivePath` (:70), `workspaceDirectory` (:75) on `create`; `transcriptArchivePath`
  (:69) dead *if* the newborn transcript lane dies.
- `gpgKey` (:56) and its whole chain: `bootstrapSpecOf`, serve `profile-gpg.ts:87`, API seal
  (`sandboxes.service.ts:105,181-192`, `sandboxes.dto.ts:103`).
- Spec fields `branch`/`commit`/`patch`/`gitIdentity`/`gpgKey`/`contextBundle`/`projectDirectory`.
- API spec DTO shrinks; `assertPatchWithinLimit` + the 413/`PatchTooLarge` lane die
  (`apps/api/src/api/platform/sandboxes/workspace-spec.ts:44,65`).
- `downloadSession`/`releaseSession` (descend-direction) — separate descend deletion.

## Dead — descend-era in materialize-workspace.ts

`PATCH_FILE` (:12), `EWorkspaceStep.Apply`/`Baseline` (:25-27), `checkoutArgsFor` (:70-77),
`patchedTreeOf` (:79-93), doc comment (:95-102), patch block (:179-192), sentinel
`baseline`/`baselineTree` payload (:176-178,197-203).

## Dead — entire packages/harness/src/workspace/transfer/ (~3,900 LOC + ~5,000 spec LOC)

Confirmed: nothing outside transfer/ imports it except `cloud-birth.ts` (:16-19),
`apps/serve/src/direct-workspace.ts` (:10-13), the `workspace-archive.ts` wrapper, the barrel
`packages/harness/src/index.ts:102-110`, and one test fixture
(`composition/__tests__/family-arrival-lock.spec.ts:11` importing `capture-fixture` — relocate
the fixture). All capture-*, restore-*, cleanup-proof, family-snapshot, family-restoration-proof,
export-primary, source-coverage, manifest, plain-receipt, git-state, archive.ts, workspace-archive.ts.

## Dead — wire ops & schemas

- `EClientRequest.ApplyWorkspaceArchive` (`channel-wire.ts:83`).
- `EClientRequest.ActivateSession` (:84) — exists only to confirm archive restore / release the
  dormant gate. Dead *if* the dormant-boot mechanism goes (see ruling #3).
- `workspace-transfer-wire.ts`: all manifest/family/restore schemas (:6-80),
  `applyWorkspaceArchiveReplySchema` (:82), `activateSessionReplySchema` (:93),
  `WORKSPACE_EXPORT_DIRECTORY_NAME`/`_FILE_PATTERN` (:3-4, descend export).
- Plumbing: serve `workspace-ops.ts` (whole), `socket-requests.ts:31-33,240-241`, channel-wire
  re-exports (:99-105), `request-timeout.ts:19-21`, `remote-channel-upstream.ts:54-55`, and the
  listed specs/fixtures.

## Dead — birth-path family/arrival/restore machinery

`verifyFamilyRestoration` (cloud-birth.ts:17,175), `captureWorkspaceFamily` (:16,131),
`family-arrival.ts` + `workspace-arrival.ts` (packages/harness/src/workspace/), serve
`direct-workspace.ts` (whole :1-162), `direct-arrival.ts`, `driveWorkspaceReceiptPath` /
`workspace-applied.json`, `driveWorkspaceArchivePath` / `workspace.tar.gz`,
`bootstrap-archive-uploads.ts`, `legacy-workspace-directory.ts:22`, `workspaceDirectoryOf` +
`EServeEnv.WorkspaceDir` env seam, `cloudWorkspacePath` (wire), `EBirthNode.CaptureWorkspace` +
`BIRTH_WAVES` capture row + `workspaceArchive.release()` finally (:129-220).

## Rename (vocabulary, not behavior)

`liftNewborn`, `lift` callback plumbing, `preflightLift`/`liveLiftPreflightFor`,
`CLOUD_LIFT_NOTICE_KEY`/`liftFailedNotice` (`cloud/lift-notices.ts` — also dead faults
`PatchTooLarge`, `Transfer`). Keep `useContainerMove` overlay as birth-progress surface; its
transfer/build lanes (`ArchiveBuildProgress` spans, `container-move-birth.ts`,
`handleBuildProgress`) become dead once nothing is packed/uploaded.

## Rulings needed before slicing

1. **Transcript bootstrap lane** — `transcriptArchivePath`, `TRANSCRIPT_ARCHIVE_PATH`,
   `materializeTranscript`, `driveTranscriptArchiveFetcher`, `VercelDriver.transcriptLanded`.
   Nothing sets it on the birth path today; dead only if "nothing local crosses" includes the
   newborn transcript tar.
2. **`captureContext` payload** — it IS the skills/memory tar (`context-archive-policy.ts:22`),
   same tar transport as the workspace tar. Decision keeps it; only flag if "delete tar
   transport" was meant literally.
3. **Dormant-boot gate** — serve boots dormant until the client confirms the workspace landed
   (`serve-boot-finish.ts:83-92`, `workspace-session.ts markActivated`). With no archive to
   acknowledge, does serve still boot dormant waiting for the client to open the conversation?
   This decides whether `ActivateSession` fully dies.
