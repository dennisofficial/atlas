import {
  EWorkspaceStep,
  EWorkspaceStepState,
  type FileSystemPort,
  type ProcessPort,
} from '@dltech/atlas-core'
import {
  RemoteCalls,
  WorkspaceGate,
  type HostTimers,
  type PrepareResult,
  type PrepareStepReporter,
  type SetupLifecycle,
} from '@dltech/atlas-host'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { WorkspaceConfig } from '../config/agent-host-config'
import type { ProjectFilesSource } from '../config/project-files'
import type { GithubTokenReader } from '../tokens/github-token-reader'
import type { SigningKeyReader } from '../tokens/signing-key-reader'
import { abortable } from './abortable'
import type { PrepareSteps } from './prepare-steps'
import type { ScopedFileMount } from './project-files'
import { shellEnvironmentOf, type SessionPaths } from './session-paths'
import type { ShellEnvCell } from './shell-env'
import { prepareSigning } from './signing-setup'
import { ensureWorkspace } from './workspace-setup'

const SETUP_DEADLINE_MS = 15 * 60_000

export type PrepareController = {
  gate: Promise<void>
  workspaceGate: WorkspaceGate
  prepare(onStep?: PrepareStepReporter): Promise<PrepareResult>
  subscribeSetup(listener: (lifecycle: SetupLifecycle) => void): void
  checkedOutBaseOf(repoPath: string): string | null
}

export const prepareControllerOf = (args: {
  sessionId: string
  userId: string
  launchDirectory: string
  sandboxName: string
  workspace: WorkspaceConfig
  paths: SessionPaths
  calls: Pick<RemoteCalls, 'ready' | 'ackScope'>
  processes: ProcessPort
  files: FileSystemPort
  steps: PrepareSteps
  shellEnv: ShellEnvCell
  refreshSecrets: (signal: AbortSignal) => Promise<void>
  projectFiles: ProjectFilesSource | undefined
  projectId: string | null
  github: Pick<GithubTokenReader, 'read'>
  signingKey: Pick<SigningKeyReader, 'read'> | undefined
  timers: HostTimers
  setupDeadlineMs: number | undefined
  log: LogPort | undefined
}): PrepareController => {
  const { sessionId, userId, launchDirectory, calls, processes, files, steps, shellEnv } = args
  const projectFileMounts = async (signal: AbortSignal): Promise<readonly ScopedFileMount[]> => {
    const source = args.projectFiles
    const projectId = args.projectId
    if (source === undefined || projectId === null) return []
    try {
      return await abortable(source.read({ projectId }), signal)
    } catch (error) {
      args.log?.error({
        source: 'runtime.project-files',
        message: `reading project file mounts for ${sessionId} failed; the sandbox starts without them`,
        ...logFieldsOf({ error }),
      })
      return []
    }
  }
  let setupListener: ((lifecycle: SetupLifecycle) => void) | undefined
  const setupLifecycles: SetupLifecycle[] = []
  const checkedOutBranches = new Map<string, string>()
  const attempt = (signal: AbortSignal): Promise<PrepareResult> =>
    abortable(calls.ready(), signal)
      .then(async () => {
        steps.report({
          step: EWorkspaceStep.Daemon,
          state: EWorkspaceStepState.Done,
        })
        const token = await abortable(args.github.read({ userId }), signal)
        const signing = await prepareSigning({
          reader: args.signingKey,
          files,
          calls,
          userId,
          launchDirectory,
          signal,
          log: args.log,
        })
        await shellEnv.refresh({ token, signing, launchDirectory, signal })
        await args.refreshSecrets(signal)
        const mounts = await projectFileMounts(signal)
        return ensureWorkspace({
          mounts,
          env: shellEnvironmentOf({ paths: args.paths, base: shellEnv.current() }),
          calls,
          processes,
          files,
          workspace: args.workspace,
          githubToken: token,
          launchDirectory,
          sandboxName: args.sandboxName,
          signal,
          onStep: (step) => steps.report(step),
          onOutput: (text) => steps.output(text),
          onSetup: (lifecycle) => {
            setupLifecycles.push(lifecycle)
            setupListener?.(lifecycle)
          },
          onCheckedOut: ({ path, branch }) => checkedOutBranches.set(path, branch),
          ...(args.log === undefined ? {} : { log: args.log }),
        })
      })
      .catch((error: unknown): PrepareResult => {
        steps.failOpen(error instanceof Error ? error.message : String(error))
        args.log?.error({
          source: 'runtime.workspace-setup',
          message: `workspace setup for ${sessionId} failed`,
          ...logFieldsOf({ error }),
        })
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }
      })
  const deadlineMs = args.setupDeadlineMs ?? SETUP_DEADLINE_MS
  let failedAttempt: Promise<PrepareResult> | undefined
  const workspaceGate = new WorkspaceGate()
  const start = (previous: Promise<unknown>): Promise<PrepareResult> => {
    const controller = new AbortController()
    const running = previous.then(() => attempt(controller.signal))
    let deadline: unknown
    const expired = new Promise<PrepareResult>((resolve) => {
      deadline = args.timers.setTimeout(() => {
        args.log?.error({
          source: 'runtime.workspace-setup',
          message: `workspace setup for ${sessionId} did not finish within ${deadlineMs}ms`,
        })
        controller.abort(new Error(`workspace setup did not finish within ${deadlineMs}ms`))
        steps.failOpen(`workspace setup did not finish within ${deadlineMs}ms`)
        resolve({
          ok: false,
          reason: `workspace setup did not finish within ${deadlineMs}ms`,
        })
      }, deadlineMs)
    })
    const outcome = Promise.race([running, expired]).then((result) => {
      args.timers.clearTimeout(deadline)
      if (!result.ok) failedAttempt = running
      return result
    })
    workspaceGate.arm(outcome)
    return outcome
  }
  let current = start(Promise.resolve())
  return {
    gate: current.then(() => undefined),
    workspaceGate,
    prepare: (onStep?: PrepareStepReporter): Promise<PrepareResult> => {
      if (onStep !== undefined) steps.subscribe(onStep)
      const previous = failedAttempt
      if (previous === undefined) return current
      failedAttempt = undefined
      current = start(previous)
      return current
    },
    subscribeSetup: (listener) => {
      setupListener = listener
      for (const lifecycle of setupLifecycles) listener(lifecycle)
    },
    checkedOutBaseOf: (repoPath) => checkedOutBranches.get(repoPath) ?? null,
  }
}
