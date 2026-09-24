import {
  agentEnding,
  agentLabel,
  EAgentRestart,
  EAgentStatus,
  type AgentEnding,
} from '@dltech/atlas-core'

export type AgentEndingRow = AgentEnding & {
  agentType: string
  intent: string
}

export type AgentRestartRow = {
  agentType: string
  intent: string
  via: EAgentRestart
}

const RESTART_VIA: Record<EAgentRestart, string> = {
  [EAgentRestart.Resume]: 'resumed',
  [EAgentRestart.Message]: 'restarted by a message',
  [EAgentRestart.Wake]: 'woken by a queued notice',
  [EAgentRestart.Relocation]: 'moved with the conversation',
}

export const agentRestartedLine = (restart: AgentRestartRow): string =>
  `Sub-agent ${agentLabel(restart)} ${RESTART_VIA[restart.via]}`

const NEEDS_ATTENTION: Record<EAgentStatus, boolean> = {
  [EAgentStatus.Running]: false,
  [EAgentStatus.Finished]: false,
  [EAgentStatus.Failed]: true,
  [EAgentStatus.Stopped]: false,
  [EAgentStatus.Blocked]: true,
}

export const agentEndedLine = (ending: AgentEndingRow): string =>
  `Sub-agent ${agentLabel(ending)} ${agentEnding(ending)}`

export const agentEndingFailed = (ending: { status: EAgentStatus }): boolean =>
  NEEDS_ATTENTION[ending.status]
