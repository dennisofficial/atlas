# Slice 1+2 — promote clone path, rewire birth to clone-only

**Goal.** A cloud birth provisions a sandbox whose serve clones the repo's **default branch** from
origin on boot. No workspace archive, no transcript, no dormant gate, no family capture. The only
local facts that cross are the repo `remoteUrl` and the brokered `githubToken`. This is the
behavior-change slice; slices 3–4 delete the machinery this one stops calling.

**Constraint.** Every commit typechecks and tests green. Slice 1+2 must not yet delete the
transfer tree (that's slice 3) — it only stops *using* it. Keep it CLEAN/SOLID: serve keeps one
deep `EnsureWorkspace` seam; birth's interface shrinks to "clone default branch."

## A. Slim `WorkspaceSpec` + harden the clone (apps/serve)

`apps/serve/src/workspace-spec.ts:11-24` — reduce the schema to `remoteUrl`, `githubToken`,
`model`. Delete `branch`, `commit`, `patch`, `gitIdentity`, `gpgKey`, `contextBundle`,
`projectDirectory`. Mirror-shrink the API DTO/schema (`packages/harness/src/cloud/sandbox-client.ts:58-64`
and `apps/api/src/api/platform/sandboxes/workspace-spec.ts`) — drop `assertPatchWithinLimit` (:44)
and the 413/`PatchTooLarge` lane; keep columns nullable in DB, stop writing them
(`sandboxes.service.ts:65-100,181-192`).

`apps/serve/src/materialize-workspace.ts` — delete descend machinery:
- `PATCH_FILE` const (:12); `EWorkspaceStep.Apply`/`Baseline` (:25-27); `checkoutArgsFor` (:70-77)
  and its call (:170-174); `patchedTreeOf` (:79-93); the descend-merge doc comment (:95-102); the
  patch block (:179-192).
- Sentinel payload (:197-203): drop `baseline`/`baselineTree`; keep the presence-marker file
  (`WORKSPACE_SENTINEL` :10, check :121-130). Keep `commit` recording the clone's HEAD if useful,
  else drop the JSON body to a minimal stamp.
- KEEP: clone+disarm (:158-168), `httpsRemoteOf` (:58-62), `credentialedRemoteOf` (:64-68), token
  scrub (:149-150), empty-dir skip (:140-147), `workspaceRefusalOf` (:215-218). Clone is full
  (not shallow) so later worktree creation works. No branch/commit arg = clone lands on default
  branch tip.

## B. Rewire `birthInCloud` to clone-only (packages/harness/src/cloud/cloud-birth.ts)

Current body :118-227. Rewrite:
- **Imports** (:10,16-22): drop `cloudWorkspacePath`, `captureWorkspaceFamily`,
  `verifyFamilyRestoration`, `RestoredWorkspace`, `captureLiftWorkspace`/`LiftWorkspaceArchive`,
  `releaseWorktree`, `probeWorkspace`, `createBuildProgressThrottle`/`ArchiveBuildReporter`,
  `activateSessionReplySchema`/`applyWorkspaceArchiveReplySchema`, `RelocationTransferProgress`.
- **`EBirthNode`** (:30-37): remove `CaptureWorkspace` and `Activate`. Keep `Provision`, `Attach`,
  `FlipOwnership`, `Open`.
- **`BIRTH_WAVES`** (:41-46): drop the `CaptureWorkspace` "packing the uncommitted work" row.
- **`EBirthFault`** (:48-56): remove `PatchTooLarge`, `Transfer`. `birthFaultOf` (:93-101): drop
  the 413 branch (:99).
- **`BirthArgs`** (:68-91): remove `onBuildProgress`, `onTransferProgress`, `restoredWorkspace`
  from the `open` callback. Keep `captureContext`.
- **Body**: delete the CaptureWorkspace block (:129-144), `workspaceDirectoryOf` (:103-108), the
  archive-release finally (:211-220). In Provision (:147-166): call
  `bridge.sandboxes.create({ threadId, workspace: <spec with remoteUrl+githubToken+model>, model,
  captureContext, onSettleWait, onRotationStarted })` — populate `remoteUrl` from the operator's
  local checkout (`git -C <cwd> remote get-url origin`); do NOT pass `workspaceArchivePath` /
  `workspaceDirectory`. Attach (:168-178): keep `bridge.attach`; delete the
  `ApplyWorkspaceArchive` request + `verifyFamilyRestoration`. Delete the worktree-release block
  (:180-185) — nothing local was claimed. Open/FlipOwnership keep. Delete the Activate node
  (:199-208) entirely.
- The `githubToken` is NOT put in the spec by the client — serve fetches the spec (incl. fresh
  token) from the API broker on boot (`workspace-spec.ts:30-50` → `git-credentials.ts:20-45`).
  Confirm the broker resolves from the operator's linked account; the client only sends `remoteUrl`.

## C. Slim the bridge contract (packages/harness/src/cloud/cloud-bridge.ts:52-84)

`create` args: keep `threadId`, `workspace` (rename type off `LiftedWorkspace` → `WorkspaceSpec`,
:21), `model`, `captureContext`, `onTransferProgress` (context upload only), `onRotationStarted`,
`onSettleWait`. Delete `gpgKey` (:56), `transcriptArchivePath` (:69), `workspaceArchivePath`
(:70-74), `workspaceDirectory` (:75). Delete `downloadSession` (:85-90) and `releaseSession` (:91)
— descend-direction, no live caller. Update `local-cloud-bridge.ts` `create` body to match: drop
the `transcriptArchivePath` forward (:118), the workspace-archive upload leg (:115-121), the
`bootstrapSpecOf` fields for gpg/gitIdentity/projectDirectory/patch.

## D. Serve boot: clone is the only workspace path

`apps/serve/src/serve-boot.ts:44-152` — remove the direct-workspace restore call (:63-64) and the
legacy-workspace-directory detection (:67); `createEnsureWorkspace` is the only path. Delete
`apps/serve/src/direct-workspace.ts` and `apps/serve/src/direct-arrival.ts` (whole files) — but
only as part of slice 3 if the transfer tree isn't gone yet; here, stop *calling* them. Remove the
transcript materialization call (:118-141) — slice 4 owns the lane deletion; here stop calling it.
Drop the `restoreWorkspace`/`workspaceDirectory` seams (`serve-args.ts`,
`serve-config.ts:83` `EServeEnv.WorkspaceDir`) — clone lands at serve's cwd.

## E. Dormant gate removal (apps/serve)

`apps/serve/src/serve-workspace-session.ts:9-55` — drop the `dormant` flag and the
`createWorkspaceSession` gate; `startChildren` runs on boot unconditionally (it already does when
not dormant, :49-53). Delete `apps/serve/src/workspace-session.ts` and fold its idempotent
`startChildren` into `serve-workspace-session.ts`. Remove `markActivated`/`apply` from
`DirectWorkspace` usage. Fix `apps/serve/src/serve-rotation-recovery.ts:119` — it reads
`session.dormant()` to gate `startChildren` during a swap; re-anchor so it does not assume
dormancy exists.

## Validation

- `bun run typecheck` green; `bun test` green.
- The birth no longer emits `ApplyWorkspaceArchive`/`ActivateSession`; serve boots via clone and
  reaches ready without a dormant wait.
- Live-boot hand test deferred to final verification (slice 6).

**Hand to slice 3:** the transfer tree, wire ops, descend export surface are now unreferenced —
delete them. Slice 4 then removes the transcript lane + any residual dormant plumbing.
