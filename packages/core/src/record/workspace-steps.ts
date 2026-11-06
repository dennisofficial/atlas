import type { V2Event } from './event'
import { EWorkspaceStep, type WorkspaceStep } from './workspace'

export type WorkspaceStepStatus = Pick<WorkspaceStep, 'state' | 'outcome' | 'reason'> & {
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
    folded[event.step] = {
      state: event.state,
      outcome: event.outcome,
      reason: event.reason,
      at: event.at,
    }
  }
  return folded
}
