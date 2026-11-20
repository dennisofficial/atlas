import { EWorkspaceStep, EWorkspaceStepState, type WorkspaceStepReport } from '@dltech/atlas-core'

import { run } from './workspace-clone'
import {
  clearSetupStarted,
  report,
  writeSentinel,
  type Deps,
  type Sentinels,
} from './workspace-state'

const SETUP_TIMEOUT_MS = 10 * 60_000
const SETUP_OUTPUT_TAIL_CHARS = 16_000
const COMMAND_CHARS = 500
export const SETUP_INTERRUPTED_REASON = 'setup was interrupted: the sandbox restarted'

export const runSetupOnce = async (args: {
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
  const ended =
    outcome.ok ||
    !(outcome.interrupted === true || outcome.unknownExit === true || outcome.detached === true)
  const forgetStarted = async (): Promise<void> => {
    if (!ended) return
    await clearSetupStarted({ deps, path: args.sentinels.setupStarted })
  }
  if (!outcome.ok) {
    const interrupted = !ended
    const reason = interrupted
      ? SETUP_INTERRUPTED_REASON
      : `workspace setup script failed (command: ${command.slice(0, COMMAND_CHARS)})`
    report({ deps, message: reason, detail: output })
    args.onStep?.({
      step: EWorkspaceStep.Setup,
      state: interrupted ? EWorkspaceStepState.Interrupted : EWorkspaceStepState.Failed,
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
