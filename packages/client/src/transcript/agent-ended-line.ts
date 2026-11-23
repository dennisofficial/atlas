import {
  agentDisplayName,
  agentEnding,
  countedNoun,
  EAgentStatus,
  EKilledBy,
  isTeammateType,
  type AgentEnding,
} from '@dltech/atlas-core'

export type AgentEndingRow = AgentEnding & {
  agentType: string
  intent: string
}

const NEEDS_ATTENTION: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: false,
  [EAgentStatus.Blocked]: true,
  [EAgentStatus.Paused]: false,
  [EAgentStatus.WaitingForModel]: false,
}

const STOPPED_BY: Partial<Record<EKilledBy, string>> = {
  [EKilledBy.User]: 'was stopped by you after',
  [EKilledBy.Model]: 'was stopped by atlas after',
}

const outcomeOf = (ending: AgentEnding): string => {
  const stoppedBy =
    ending.status === EAgentStatus.Stopped && ending.killedBy !== undefined
      ? STOPPED_BY[ending.killedBy]
      : undefined
  if (stoppedBy === undefined) return agentEnding(ending)
  const turns = countedNoun({ count: ending.turns, noun: 'turn' })
  const toolCalls = countedNoun({ count: ending.toolCalls, noun: 'tool call' })
  return `${stoppedBy} ${turns} and ${toolCalls}`
}

export const agentEndedLine = (ending: AgentEndingRow): string =>
  `${isTeammateType(ending.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(ending)} ${outcomeOf(ending)}`

export const agentReportedLine = (report: { agentType: string; intent: string }): string =>
  `${isTeammateType(report.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(report)} reported`

export const agentEndingFailed = (ending: { status: EAgentStatus }): boolean =>
  NEEDS_ATTENTION[ending.status]
