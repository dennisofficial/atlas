import { EAgentStatus } from '@dltech/atlas-core'

import type { CrewRow } from '../core'

const STATUS_RANK: Record<EAgentStatus, number> = {
  [EAgentStatus.Running]: 0,
  [EAgentStatus.WaitingForModel]: 1,
  [EAgentStatus.Blocked]: 2,
  [EAgentStatus.Paused]: 3,
  [EAgentStatus.Finished]: 4,
  [EAgentStatus.Failed]: 4,
  [EAgentStatus.Stopped]: 4,
}

export const isActiveCrewStatus = (status: EAgentStatus): boolean => STATUS_RANK[status] < 4

export const orderedCrewRows = (rows: readonly CrewRow[]): readonly CrewRow[] =>
  [...rows].sort((left, right) => {
    const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status]
    if (rank !== 0) return rank
    const started = right.startedAt.localeCompare(left.startedAt)
    if (isActiveCrewStatus(left.status)) return started
    return (
      (right.endedAt ?? right.startedAt).localeCompare(left.endedAt ?? left.startedAt) || started
    )
  })
