import { EAgentDisplay, needsAttention } from '@dltech/atlas-ui/ai/agent-status'
import type { WireThread } from '@dltech/atlas-wire/web'

export function teammateDisplay(teammate: WireThread): EAgentDisplay {
  const status = teammate.status
  if (status === undefined) return EAgentDisplay.Paused
  if (status.awaiting !== null) return EAgentDisplay.NeedsApproval
  if (status.working) return EAgentDisplay.Running
  if (status.podState === 'booting') return EAgentDisplay.StartingSandbox
  if (status.podState === 'failed' || status.lastOutcome === 'failed') return EAgentDisplay.Failed
  if (status.lastOutcome !== null) return EAgentDisplay.Done
  return EAgentDisplay.Paused
}

export function hasAttentionTeammate(teammates: readonly WireThread[]): boolean {
  return teammates.some((teammate) => needsAttention(teammateDisplay(teammate)))
}

const isArchived = (teammate: WireThread): boolean =>
  teammate.archivedAt !== null && teammate.archivedAt !== undefined

export interface TeammateGroups {
  active: WireThread[]
  done: WireThread[]
}

export function groupTeammates(teammates: readonly WireThread[]): TeammateGroups {
  const rank = (teammate: WireThread): number => (needsAttention(teammateDisplay(teammate)) ? 0 : 1)
  return {
    active: teammates.filter((teammate) => !isArchived(teammate)).sort((a, b) => rank(a) - rank(b)),
    done: teammates.filter(isArchived),
  }
}

export function teammateCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'teammate' : 'teammates'}`
}
