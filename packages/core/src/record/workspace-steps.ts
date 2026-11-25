import type { RecordEvent } from './event'
import { withinLatestAttempt } from './workspace-attempts'
import { EWorkspaceStep, EWorkspaceStepState, type WorkspaceStep } from './workspace'

export type WorkspaceStepStatus = Pick<
  WorkspaceStep,
  'state' | 'outcome' | 'reason' | 'repos' | 'command' | 'output'
> & {
  at: string
}

export const WORKSPACE_STEP_ORDER: readonly EWorkspaceStep[] = [
  EWorkspaceStep.Sandbox,
  EWorkspaceStep.Daemon,
  EWorkspaceStep.Clone,
  EWorkspaceStep.Setup,
]

export const workspaceStepsOf = (
  events: readonly RecordEvent[],
): Partial<Record<EWorkspaceStep, WorkspaceStepStatus>> => {
  const folded: Partial<Record<EWorkspaceStep, WorkspaceStepStatus>> = {}
  const current = withinLatestAttempt({
    events,
    keep: (event): event is Extract<RecordEvent, { type: 'workspace-step' }> =>
      event.type === 'workspace-step',
  })
  for (const event of current) {
    const previous = folded[event.step]
    folded[event.step] = {
      state: event.state,
      outcome: event.outcome,
      reason: event.reason,
      repos: event.repos ?? previous?.repos,
      command: event.command ?? previous?.command,
      output: event.output,
      at: event.at,
    }
  }
  return folded
}

/**
 * The setup script was started and has not reported an end since, so a host that takes the
 * session over has to re-join the running call rather than start the script again.
 */
export const setupInFlightOf = (events: readonly RecordEvent[]): boolean =>
  workspaceStepsOf(events)[EWorkspaceStep.Setup]?.state === EWorkspaceStepState.Started
