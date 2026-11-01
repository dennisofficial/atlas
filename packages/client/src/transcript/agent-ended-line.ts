import {
  agentDisplayName,
  agentEnding,
  EAgentRestart,
  EAgentStatus,
  EReportKind,
  isTeammateType,
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
  `${isTeammateType(restart.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(restart)} ${RESTART_VIA[restart.via]}`

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

const REPORT_VERB: Record<EReportKind, string> = {
  [EReportKind.Done]: 'reported done',
  [EReportKind.Blocked]: 'reported it is blocked',
  [EReportKind.NeedsDecision]: 'needs a decision',
  [EReportKind.Progress]: 'reported progress',
}

export const agentReportedKindLine = (report: {
  agentType: string
  intent: string
  kind?: EReportKind | undefined
}): string =>
  report.kind === undefined
    ? agentReportedLine(report)
    : `${isTeammateType(report.agentType) ? 'Teammate' : 'Sub-agent'} ${agentDisplayName(report)} ${REPORT_VERB[report.kind]}`

export const agentReportNeedsAttention = (kind: EReportKind | undefined): boolean =>
  kind === EReportKind.Blocked || kind === EReportKind.NeedsDecision
