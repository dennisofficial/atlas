import {
  agentDisplayName,
  agentEnding,
  EAgentStatus,
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

export const agentEndedLine = (ending: AgentEndingRow): string =>
  `${isTeammateType(ending.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(ending)} ${agentEnding(ending)}`

export const agentReportedLine = (report: { agentType: string; intent: string }): string =>
  `${isTeammateType(report.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(report)} reported`

export const agentEndingFailed = (ending: { status: EAgentStatus }): boolean =>
  NEEDS_ATTENTION[ending.status]
