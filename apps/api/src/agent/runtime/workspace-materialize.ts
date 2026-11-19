import { EWorkspaceStep, EWorkspaceStepState, type WorkspaceStepReport } from '@dltech/atlas-core'
import type { CapturedBase } from '@dltech/atlas-host'

import type { WorkspaceConfig } from '../config/agent-host-config'
import { captureCheckedOut, type CheckoutReport } from './workspace-checkout'
import { writeCapturedBases } from './workspace-bases'
import { materialize } from './workspace-clone'
import type { RepoProgress } from './workspace-repos'
import { fail, writeSentinel, type Deps, type Sentinels } from './workspace-state'

export enum EWorkspacePrepareFailure {
  Clone = 'clone',
  Materialized = 'materialized',
}

export type WorkspacePrepareOutcome =
  | { ok: true; bases: readonly CapturedBase[] }
  | { ok: false; failure: EWorkspacePrepareFailure; bases: readonly CapturedBase[] }

export const markMaterialized = async (args: {
  deps: Deps
  basesPath: string
  sentinelPath: string
  bases: readonly CapturedBase[]
}): Promise<boolean> => {
  const persisted = await writeCapturedBases({
    files: args.deps.files,
    path: args.basesPath,
    bases: args.bases,
  })
  if (!persisted) {
    fail({
      deps: args.deps,
      message:
        'the captured session bases were not persisted; the workspace stays unmaterialized so the next prepare captures them again',
    })
    return false
  }
  return writeSentinel({
    deps: args.deps,
    path: args.sentinelPath,
    message: 'materialized sentinel write failed; setup is not done',
  })
}

export const prepareWorkspace = async (args: {
  deps: Deps
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  stateDir: string
  sentinels: Sentinels
  progress: RepoProgress
  scrub: (text: string) => string
  onCheckedOut: CheckoutReport | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
}): Promise<WorkspacePrepareOutcome> => {
  const { deps, workspace, launchDirectory, sentinels, progress, onStep } = args
  progress.start()
  const cloned = await materialize({
    deps,
    workspace,
    githubToken: args.githubToken,
    launchDirectory,
    stateDir: args.stateDir,
    sentinels,
    progress,
    scrub: args.scrub,
  })
  if (!cloned) {
    onStep?.({
      step: EWorkspaceStep.Clone,
      state: EWorkspaceStepState.Failed,
      reason: (deps.warnings ?? []).join('\n') || 'clone failed',
      repos: progress.snapshot(),
    })
    return { ok: false, failure: EWorkspacePrepareFailure.Clone, bases: [] }
  }
  const bases = await captureCheckedOut({
    deps,
    workspace,
    launchDirectory,
    onCheckedOut: args.onCheckedOut,
  })
  const marked = await markMaterialized({
    deps,
    basesPath: sentinels.bases,
    sentinelPath: sentinels.materialized,
    bases,
  })
  onStep?.({
    step: EWorkspaceStep.Clone,
    state: marked ? EWorkspaceStepState.Done : EWorkspaceStepState.Failed,
    ...(marked ? {} : { reason: (deps.warnings ?? []).join('\n') || 'materialize failed' }),
    repos: progress.snapshot(),
  })
  return marked
    ? { ok: true, bases }
    : { ok: false, failure: EWorkspacePrepareFailure.Materialized, bases }
}
