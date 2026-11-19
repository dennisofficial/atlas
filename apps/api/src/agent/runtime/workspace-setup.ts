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
  type CapturedBase,
  type PrepareResult,
  type RemoteCalls,
  type SetupLifecycle,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'
import type { WorkspaceConfig } from '../config/agent-host-config'

import { replayCapturedBases } from './workspace-bases'
import type { CheckoutReport } from './workspace-checkout'
import { prepareFailureResult, prepareWorkspace, resultOf } from './workspace-materialize'
import { run } from './workspace-clone'
import { RepoProgress, repoNamesOf } from './workspace-repos'
import {
  checkSentinels,
  clearSetupStarted,
  exists,
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
export const SETUP_INTERRUPTED_REASON = 'setup was interrupted: the sandbox restarted'

const runSetupOnce = async (args: {
  deps: Deps
  setupScript: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
  onOutput?: ((text: string) => void) | undefined
  onStep?: ((step: WorkspaceStepReport) => void) | undefined
}): Promise<{ ok: boolean; output: string; interrupted?: boolean }> => {
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
  // once the script is known to have ended the marker has served its purpose; while a host gave up
  // watching it (a timeout or a cancel) the script may still be running, so the next host resumes it
  const forgetStarted = async (): Promise<void> => {
    if (outcome.detached === true) return
    await clearSetupStarted({ deps, path: args.sentinels.setupStarted })
  }
  if (!outcome.ok) {
    const interrupted = outcome.interrupted === true && deps.signal?.aborted !== true
    const reason = interrupted
      ? SETUP_INTERRUPTED_REASON
      : `workspace setup script failed (command: ${command.slice(0, COMMAND_CHARS)})`
    report({ deps, message: reason, detail: output })
    args.onStep?.({
      step: EWorkspaceStep.Setup,
      state: EWorkspaceStepState.Failed,
      reason,
      ...recorded,
    })
    await forgetStarted()
    return { ok: false, output, ...(interrupted ? { interrupted: true } : {}) }
  }
  await writeSentinel({
    deps,
    path: args.sentinels.setupRan,
    message: 'setup sentinel write failed; setup is not done',
  })
  args.onStep?.({ step: EWorkspaceStep.Setup, state: EWorkspaceStepState.Done, ...recorded })
  await forgetStarted()
  return { ok: true, output }
}

const startSetupInBackground = (args: {
  deps: Deps
  command: string
  launchDirectory: string
  sentinels: Sentinels
  scrub: (text: string) => string
  scopeKey: string
  resume?: boolean | undefined
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
    // a resume re-joins the call the earlier host started: the pod may never run it a second time
    ...(args.resume === undefined ? {} : { attachOnly: args.resume }),
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
  onCheckedOut?: CheckoutReport | undefined
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
  const { workspace, launchDirectory, githubToken, onStep, onCheckedOut } = args
  const stateDir = stateDirOf(launchDirectory)
  const sentinels = sentinelsOf(stateDir)
  const scrub = (text: string): string =>
    githubToken === null ? text : text.split(githubToken).join('***')
  const phases = ['check', 'clone', 'setup'].map((phase) =>
    scopeFor({ sandboxName: args.sandboxName, phase }),
  )
  const setupScope = phases[2] ?? 'setup:setup'
  let setupInBackground = false
  let captured: readonly CapturedBase[] = []
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
      captured = await replayCapturedBases({
        deps,
        path: sentinels.bases,
        expectedRepos: repoNamesOf(workspace).length,
      })
      onStep?.({
        step: EWorkspaceStep.Clone,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
        repos: progress.snapshot().map((entry) => ({ ...entry, state: EWorkspaceRepoState.Done })),
      })
    } else {
      const prepared = await runInCallScope({
        scopeKey: phases[1] ?? 'setup:clone',
        body: () =>
          prepareWorkspace({
            deps,
            workspace,
            githubToken,
            launchDirectory,
            stateDir,
            sentinels,
            progress,
            scrub,
            onCheckedOut,
            onStep,
          }),
      })
      captured = prepared.bases
      if (!prepared.ok) {
        return prepareFailureResult({
          prepared,
          deps,
          warnings,
          setupScript: workspace.setupScript,
        })
      }
      // the workspace was rebuilt, so a setup script started in the old one says nothing about it
      await clearSetupStarted({ deps, path: sentinels.setupStarted })
    }
    args.signal?.throwIfAborted()
    const setupStarted =
      !state.setupRan &&
      state.materialized &&
      (await exists({ files: args.files, path: sentinels.setupStarted }))
    if (state.setupRan || workspace.setupScript.trim() === '') {
      onStep?.({
        step: EWorkspaceStep.Setup,
        state: EWorkspaceStepState.Done,
        outcome: EWorkspaceStepOutcome.Skipped,
      })
    } else {
      if (!setupStarted) {
        onStep?.({
          step: EWorkspaceStep.Setup,
          state: EWorkspaceStepState.Started,
          command: workspace.setupScript,
        })
        await writeSentinel({
          deps,
          path: sentinels.setupStarted,
          message: 'setup start marker write failed; a new host may not find this setup again',
        })
      }
      setupInBackground = true
      startSetupInBackground({
        deps,
        command: workspace.setupScript,
        launchDirectory,
        sentinels,
        scrub,
        scopeKey: setupScope,
        resume: setupStarted,
        onOutput: args.onOutput,
        onStep,
        onSetup: args.onSetup,
        ackScope: () => args.calls.ackScope({ scopeKey: setupScope }),
      })
    }
    return { ...resultOf(warnings), ...(captured.length === 0 ? {} : { bases: captured }) }
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
