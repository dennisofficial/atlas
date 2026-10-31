import { EAgentStatus } from '@dltech/atlas-core'

import { runFailureOf, safeFailureMessage } from '../../model/run-failure'
import type { PauseSignal } from '../../loop/pause-signal'
import { ETurnStatus } from '../../loop/turn-outcome'
import type { TurnRunner } from '../../loop/turn-runner.port'
import type { ChildState } from './child-state'
import type { ChildStep } from './child-steps'
import { statusOf } from './reasons'

export async function steppedStatus({
  child,
  step,
  signal,
  pause,
  runnerFor,
}: {
  child: ChildState
  step: ChildStep
  signal: AbortSignal
  pause: PauseSignal
  runnerFor: () => TurnRunner | Promise<TurnRunner>
}): Promise<EAgentStatus> {
  try {
    let runner: TurnRunner
    try {
      const built = runnerFor()
      runner = built instanceof Promise ? await built : built
    } catch (error) {
      child.lastFullText = safeFailureMessage(
        error instanceof Error ? error.message : String(error),
      )
      return signal.aborted ? EAgentStatus.Stopped : EAgentStatus.Failed
    }
    if (signal.aborted) return EAgentStatus.Stopped
    const outcome = await step({ runner, signal, pause })
    if (outcome.status === ETurnStatus.Failed) {
      child.failureCause = safeFailureMessage(outcome.message)
      child.failureKind = runFailureOf({ message: outcome.message, cause: outcome.cause }).kind
    }
    return statusOf(outcome)
  } catch {
    return signal.aborted ? EAgentStatus.Stopped : EAgentStatus.Failed
  }
}
