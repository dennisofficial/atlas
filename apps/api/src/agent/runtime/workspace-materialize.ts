import { EWorkspaceStep, EWorkspaceStepState, type WorkspaceStepReport } from '@dltech/atlas-core'
import type { BootNotice, CapturedBase, PrepareResult } from '@dltech/atlas-host'

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

export const resultOf = (args: {
  warnings: readonly string[]
  notices?: readonly BootNotice[] | undefined
}): Extract<PrepareResult, { ok: true }> => ({
  ok: true,
  ...(args.warnings.length === 0 ? {} : { warnings: [...args.warnings] }),
  ...(args.notices === undefined || args.notices.length === 0
    ? {}
    : { notices: [...args.notices] }),
})

export const prepareFailureResult = (args: {
  prepared: Extract<WorkspacePrepareOutcome, { ok: false }>
  deps: Deps
  warnings: readonly string[]
  setupScript: string
}): PrepareResult => {
  if (args.prepared.failure === EWorkspacePrepareFailure.Materialized) {
    return {
      ok: false,
      reason: args.warnings.join('\n') || 'the workspace was not marked materialized',
    }
  }
  if (args.setupScript.trim() !== '') {
    fail({
      deps: args.deps,
      message: 'setup script was skipped because the workspace clone failed',
    })
  }
  return resultOf({ warnings: args.warnings })
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
