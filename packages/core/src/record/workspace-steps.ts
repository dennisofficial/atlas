import type { V2Event } from './event'
import { EWorkspaceStep, type WorkspaceStep } from './workspace'

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
  events: readonly V2Event[],
): Partial<Record<EWorkspaceStep, WorkspaceStepStatus>> => {
  const folded: Partial<Record<EWorkspaceStep, WorkspaceStepStatus>> = {}
  for (const event of events) {
    if (event.type !== 'workspace-step') continue
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
