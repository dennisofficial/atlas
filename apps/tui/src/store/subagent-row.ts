import {
  agentDisplayName,
  EAgentStatus,
  TEAMMATE_AGENT_TYPE,
  type EKilledBy,
  type ProviderIdentity,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  crewActivityOf,
  subagentStateLabel as crewStateLabel,
  type CrewActivity,
  type CrewReadout,
} from '@dltech/atlas-client/crew'

import { truncateCells } from '../ui/components/sidebar/cells'
import type { PullRequestBadge } from '../ui/pull-request-pill'
import type { ShellSnapshot } from '../ui/shells-model'
import { TITLE_CELLS } from './sidebar-text'

export type ChildContext = { tokens: number; window: number }

export type AgentSnapshot = {
  agentId: ThreadId
  spawnedBy: ThreadId
  agentType: string
  intent: string
  status: EAgentStatus
  killedBy?: EKilledBy | undefined
  failureCause?: string | undefined
  turns: number
  toolCalls: number
  lastTool?: string | undefined
  startedAt: string
  endedAt?: string | undefined
  waitingOn?: string | undefined
  context?: ChildContext | undefined
  model?: ProviderIdentity | undefined
}

export type SubagentReadout = CrewReadout

export type SidebarSubagent = SubagentReadout & {
  id: string
  name: string
  agentType?: string | undefined
  state: string
  model: string | null
  context?: ChildContext | undefined
  selected: boolean
  activity?: CrewActivity | undefined
  failureReason: string | null
  pullRequest?: PullRequestBadge | undefined
}

/** The cross-thread listings the activity is counted from: every shell and every child in the process. */
export type CrewRosters = {
  shells: readonly ShellSnapshot[]
  children: readonly AgentSnapshot[]
}

export type SidebarCrewFold = { hidden: number; hiddenFailed: boolean }

export const subagentLabel = (snapshot: Pick<AgentSnapshot, 'intent' | 'agentType'>): string =>
  truncateCells({ text: agentDisplayName(snapshot), cells: TITLE_CELLS })

export {
  crewActivityOf,
  crewRowReading,
  ESubagentReading,
  isSubagentAlive,
  isSubagentWaiting,
  isSubagentWorking,
  subagentContextLabel,
  subagentElapsedMs,
  subagentReading,
  subagentShowsElapsed,
  subagentWentWrong,
  type CrewActivity,
} from '@dltech/atlas-client/crew'

export const subagentStateLabel = (args: { subagent: SubagentReadout; now: number }): string =>
  crewStateLabel({ ...args, truncate: truncateCells })

export function subagentRows(args: {
  snapshots: readonly AgentSnapshot[]
  now: number
  modelLabel?: ((model: ProviderIdentity) => string) | undefined
  viewing?: string | null | undefined
  rosters: CrewRosters
  pullRequestOf?: ((args: { threadId: ThreadId }) => PullRequestBadge | null) | undefined
}): readonly SidebarSubagent[] {
  return args.snapshots.map((snapshot) => {
    const readout: SubagentReadout = {
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? null,
      waitingOn: snapshot.waitingOn,
    }

    const activity = crewActivityOf({
      id: snapshot.agentId,
      rosters: args.rosters,
    })
    const pullRequest =
      snapshot.agentType === TEAMMATE_AGENT_TYPE
        ? (args.pullRequestOf?.({ threadId: snapshot.agentId }) ?? undefined)
        : undefined

    return {
      ...readout,
      id: snapshot.agentId,
      name: subagentLabel(snapshot),
      agentType: snapshot.agentType,
      state: subagentStateLabel({ subagent: readout, now: args.now }),
      model:
        snapshot.model === undefined
          ? null
          : (args.modelLabel?.(snapshot.model) ?? snapshot.model.modelId),
      context: snapshot.context,
      selected: snapshot.agentId === args.viewing,
      activity,
      failureReason:
        snapshot.status === EAgentStatus.Failed ? (snapshot.failureCause ?? null) : null,
      pullRequest,
    }
  })
}
