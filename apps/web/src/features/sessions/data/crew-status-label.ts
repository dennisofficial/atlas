import { EAgentStatus } from '@dltech/atlas-core'

const STATUS_LABEL: Record<EAgentStatus, string> = {
  [EAgentStatus.Running]: 'running',
  [EAgentStatus.Finished]: 'finished',
  [EAgentStatus.Failed]: 'failed',
  [EAgentStatus.Stopped]: 'stopped',
  [EAgentStatus.Blocked]: 'blocked',
  [EAgentStatus.Paused]: 'paused',
  [EAgentStatus.WaitingForModel]: 'waiting for model',
}

export const crewStatusLabelOf = (status: EAgentStatus): string => STATUS_LABEL[status]
