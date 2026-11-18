import {
  ESetupPhase,
  EWorkspaceRepoState,
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
  type SetupLifecycle,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { WorkspaceConfig } from '../config/agent-host-config'

import { materialize, run } from './workspace-clone'
import { RepoProgress, repoNamesOf } from './workspace-repos'
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
const SETUP_OUTPUT_TAIL_CHARS = 16_000
const COMMAND_CHARS = 500

const runSetupOnce = async (args: {
  deps: Deps
  setupScript: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
  onOutput?: ((text: string) => void) | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
}): Promise<{ ok: boolean; output: string }> => {
  const { deps, setupScript, launchDirectory } = args
  const command = setupScript.trim()
  const outcome = await run({
    processes: deps.processes,
    cmd: ['sh', '-c', setupScript],
    cwd: launchDirectory,
    timeoutMs: SETUP_TIMEOUT_MS,
    signal: deps.signal,
    ...(deps.env === undefined ? {} : { env: deps.env }),
    onOutput: (text) => args.onOutput?.(args.scrub(text)),
  })
  const output = args.scrub(outcome.output)
  const recorded = { command, output: output.slice(-SETUP_OUTPUT_TAIL_CHARS) }
  if (!outcome.ok) {
    report({ deps, message: 'workspace setup script failed', detail: output })
    args.onStep?.({
      step: EWorkspaceStep.Setup,
      state: EWorkspaceStepState.Failed,
      reason: `workspace setup script failed (command: ${command.slice(0, COMMAND_CHARS)})`,
      ...recorded,
    })
    return { ok: false, output }
  }
  await writeSentinel({
    deps,
    path: args.sentinels.setupRan,
    message: 'setup sentinel write failed; setup is not done',
  })
  args.onStep?.({ step: EWorkspaceStep.Setup, state: EWorkspaceStepState.Done, ...recorded })
  return { ok: true, output }
}

const startSetupInBackground = (args: {
  deps: Deps
  command: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
  scopeKey: string
  onOutput?: ((text: string) => void) | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
  onSetup?: ((lifecycle: SetupLifecycle) => void) | undefined
  ackScope(): Promise<void>
}): void => {
  const { deps, command } = args
  const startedAt = Date.now()
  args.onSetup?.({ phase: ESetupPhase.Started, script: command })
  void runInCallScope({
    scopeKey: args.scopeKey,
    body: () =>
      runSetupOnce({
        deps,
        setupScript: command,
        launchDirectory: args.launchDirectory,
        sentinels: args.sentinels,
        scrub: args.scrub,
        onOutput: args.onOutput,
        onStep: args.onStep,
      }),
  })
    .then((outcome) => {
      args.onSetup?.({
        phase: ESetupPhase.Finished,
        script: command,
        ok: outcome.ok,
        durationMs: Date.now() - startedAt,
        output: outcome.output,
      })
    })
    .catch((error: unknown) => {
      deps.log?.error({
        source: 'runtime.workspace-setup',
        message: 'the background setup script failed',
        ...logFieldsOf({ error }),
      })
    })
    .finally(() => args.ackScope().catch(() => undefined))
}

const resultOf = (warnings: readonly string[]): PrepareResult =>
  warnings.length === 0 ? { ok: true } : { ok: true, warnings: [...warnings] }

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
  env?: Record<string, string> | undefined
  signal?: AbortSignal | undefined
  log?: LogPort | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
  onOutput?: ((text: string) => void) | undefined
  onSetup?: ((lifecycle: SetupLifecycle) => void) | undefined
}): Promise<PrepareResult> => {
  const warnings: string[] = []
  const deps: Deps = {
    processes: args.processes,
    files: args.files,
    warnings,
    signal: args.signal,
    ...(args.env === undefined ? {} : { env: args.env }),
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
  const setupScope = phases[2] ?? 'setup:setup'
  let setupInBackground = false
  try {
    const state = await runInCallScope({
      scopeKey: phases[0] ?? 'setup:check',
      body: () => checkSentinels({ deps, sentinels, launchDirectory }),
    })
    args.signal?.throwIfAborted()
    const progress = new RepoProgress({
      names: repoNamesOf(workspace),
      emit: (repos) =>
        onStep?.({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started, repos }),
    })
    if (state.materialized) {
      onStep?.({
        step: EWorkspaceStep.Clone,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
        repos: progress.snapshot().map((entry) => ({ ...entry, state: EWorkspaceRepoState.Done })),
      })
    } else {
      progress.start()
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
            progress,
            scrub,
          }),
      })
      if (!materialized) {
        onStep?.({
          step: EWorkspaceStep.Clone,
          state: EWorkspaceStepState.Failed,
          reason: warnings.join('\n') || 'clone failed',
          repos: progress.snapshot(),
        })
        if (workspace.setupScript.trim() !== '') {
          fail({ deps, message: 'setup script was skipped because the workspace clone failed' })
        }
        return resultOf(warnings)
      }
      onStep?.({
        step: EWorkspaceStep.Clone,
        state: EWorkspaceStepState.Done,
        repos: progress.snapshot(),
      })
    }
    args.signal?.throwIfAborted()
    if (state.setupRan || workspace.setupScript.trim() === '') {
      onStep?.({
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
      })
    } else {
      onStep?.({
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Started,
        command: workspace.setupScript,
      })
      setupInBackground = true
      startSetupInBackground({
        deps,
        command: workspace.setupScript,
        launchDirectory,
        sentinels,
        scrub,
        scopeKey: setupScope,
        onOutput: args.onOutput,
        onStep,
        onSetup: args.onSetup,
        ackScope: () => args.calls.ackScope({ scopeKey: setupScope }),
      })
    }
    return resultOf(warnings)
  } catch (error) {
    fail({ deps, message: 'workspace setup failed', detail: String(error) })
    deps.log?.error({
      source: 'runtime.workspace-setup',
      message: 'workspace setup failed',
      ...logFieldsOf({ error }),
    })
    return { ok: false, reason: warnings.join('\n') }
  } finally {
    for (const scopeKey of phases) {
      if (setupInBackground && scopeKey === setupScope) continue
      await args.calls.ackScope({ scopeKey }).catch(() => undefined)
    }
  }
}
