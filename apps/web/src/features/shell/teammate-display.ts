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

const isDoneTeammate = (teammate: WireThread): boolean =>
  teammateDisplay(teammate) === EAgentDisplay.Done

export function hasAttentionTeammate(teammates: readonly WireThread[]): boolean {
  return teammates.some((teammate) => needsAttention(teammateDisplay(teammate)))
}

export interface TeammateGroups {
  live: WireThread[]
  done: WireThread[]
}

export function groupTeammates(teammates: readonly WireThread[]): TeammateGroups {
  const rank = (teammate: WireThread): number => (needsAttention(teammateDisplay(teammate)) ? 0 : 1)
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
