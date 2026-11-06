import {
  EWorkspaceStep,
  EWorkspaceStepOutcome,
  EWorkspaceStepState,
  type FileSystemPort,
  type ProcessPort,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import {
  runInCallScope,
  scopeKeyOf,
  type PrepareResult,
  type RemoteCalls,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { WorkspaceConfig } from '../config/agent-host-config'

import { materialize, run } from './workspace-clone'
import {
  checkSentinels,
  fail,
  report,
  sentinelsOf,
  stateDirOf,
  writeSentinel,
  type Deps,
  type Sentinels,
} from './workspace-state'

export { MATERIALIZED_SENTINEL, SETUP_SENTINEL, WORKSPACE_STATE_DIR } from './workspace-state'

const SETUP_TIMEOUT_MS = 10 * 60_000

const runSetupOnce = async (args: {
  deps: Deps
  setupScript: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
}): Promise<void> => {
  const { deps, setupScript, launchDirectory } = args
  if (setupScript.trim() === '') return
  const outcome = await run({
    processes: deps.processes,
    cmd: ['sh', '-c', setupScript],
    cwd: launchDirectory,
    timeoutMs: SETUP_TIMEOUT_MS,
    signal: deps.signal,
  })
  if (!outcome.ok) {
    const detail = args.scrub(outcome.output)
    report({ deps, message: 'workspace setup script failed', detail })
    fail({ deps, message: 'workspace setup script failed', detail })
    return
  }
  await writeSentinel({
    deps,
    path: args.sentinels.setupRan,
    message: 'setup sentinel write failed; setup is not done',
  })
}

const resultOf = (failures: readonly string[]): PrepareResult =>
  failures.length === 0 ? { ok: true } : { ok: false, reason: failures.join('\n') }

const scopeFor = (args: { sandboxName: string; phase: string }): string =>
  scopeKeyOf({ runId: 'setup', callId: `${args.sandboxName}:${args.phase}` })

export const ensureWorkspace = async (args: {
  calls: Pick<RemoteCalls, 'ackScope'>
  processes: ProcessPort
  files: FileSystemPort
  workspace: WorkspaceConfig
  githubToken: string | null
  launchDirectory: string
  sandboxName: string
  signal?: AbortSignal | undefined
  log?: LogPort | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
}): Promise<PrepareResult> => {
  const failures: string[] = []
  const deps: Deps = {
    processes: args.processes,
    files: args.files,
    failures,
    signal: args.signal,
    ...(args.log === undefined ? {} : { log: args.log }),
  }
  const { workspace, launchDirectory, githubToken, onStep } = args
  const stateDir = stateDirOf(launchDirectory)
  const sentinels = sentinelsOf(stateDir)
  const scrub = (text: string): string =>
    githubToken === null ? text : text.split(githubToken).join('***')
  const phases = ['check', 'clone', 'setup'].map((phase) =>
    scopeFor({ sandboxName: args.sandboxName, phase }),
  )
  try {
    const state = await runInCallScope({
      scopeKey: phases[0] ?? 'setup:check',
      body: () => checkSentinels({ deps, sentinels }),
    })
    args.signal?.throwIfAborted()
    if (state.materialized) {
      onStep?.({
        step: EWorkspaceStep.Clone,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
      })
    } else {
      onStep?.({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started })
      const materialized = await runInCallScope({
        scopeKey: phases[1] ?? 'setup:clone',
        body: () =>
          materialize({
            deps,
            workspace,
            githubToken,
            launchDirectory,
            stateDir,
            sentinels,
            scrub,
          }),
      })
      if (!materialized) {
        const result = resultOf(failures)
        onStep?.({
          step: EWorkspaceStep.Clone,
          state: EWorkspaceStepState.Failed,
          reason: result.ok ? 'clone failed' : result.reason,
        })
        return result
      }
      onStep?.({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Done })
    }
    args.signal?.throwIfAborted()
    if (state.setupRan || workspace.setupScript.trim() === '') {
      onStep?.({
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
      })
    } else {
      onStep?.({ step: EWorkspaceStep.Setup, state: EWorkspaceStepState.Started })
      await runInCallScope({
        scopeKey: phases[2] ?? 'setup:setup',
        body: () =>
          runSetupOnce({
            deps,
            setupScript: workspace.setupScript,
            launchDirectory,
            sentinels,
            scrub,
          }),
      })
      const result = resultOf(failures)
      onStep?.(
        result.ok
          ? { step: EWorkspaceStep.Setup, state: EWorkspaceStepState.Done }
          : {
              step: EWorkspaceStep.Setup,
              state: EWorkspaceStepState.Failed,
              reason: result.reason,
            },
      )
      return result
    }
    return resultOf(failures)
  } catch (error) {
    fail({ deps, message: 'workspace setup failed', detail: String(error) })
    deps.log?.error({
      source: 'runtime.workspace-setup',
      message: 'workspace setup failed',
      ...logFieldsOf({ error }),
    })
    return resultOf(failures)
  } finally {
    for (const scopeKey of phases) {
      await args.calls.ackScope({ scopeKey }).catch(() => undefined)
    }
  }
}
