import { EAgentDisplay, needsAttention } from '@dltech/atlas-ui/ai/agent-status'

import { type AppTeammate, EAgentStatus, ESandboxState } from './fixtures/teammates'

const DISPLAY_OF_RUN: Record<EAgentStatus, EAgentDisplay> = {
  [EAgentStatus.Running]: EAgentDisplay.Running,
  [EAgentStatus.Blocked]: EAgentDisplay.NeedsApproval,
  [EAgentStatus.Paused]: EAgentDisplay.Paused,
  [EAgentStatus.WaitingForModel]: EAgentDisplay.WaitingForModel,
  [EAgentStatus.Failed]: EAgentDisplay.Failed,
  [EAgentStatus.Finished]: EAgentDisplay.Done,
  [EAgentStatus.Stopped]: EAgentDisplay.Done,
}

export function teammateDisplay(teammate: AppTeammate): EAgentDisplay {
  if (teammate.sandbox === ESandboxState.Booting) return EAgentDisplay.StartingSandbox
  return DISPLAY_OF_RUN[teammate.run]
}

export function isDoneTeammate(teammate: AppTeammate): boolean {
  return teammateDisplay(teammate) === EAgentDisplay.Done
}

export function hasAttentionTeammate(teammates: AppTeammate[]): boolean {
  return teammates.some((teammate) => needsAttention(teammateDisplay(teammate)))
}

export interface TeammateGroups {
  live: AppTeammate[]
  done: AppTeammate[]
}

export function groupTeammates(teammates: AppTeammate[]): TeammateGroups {
  const rank = (teammate: AppTeammate): number =>
    needsAttention(teammateDisplay(teammate)) ? 0 : 1
  return {
    live: teammates
      .filter((teammate) => !isDoneTeammate(teammate))
      .sort((a, b) => rank(a) - rank(b)),
    done: teammates.filter(isDoneTeammate),
  }
}

export function teammateCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'teammate' : 'teammates'}`
}
