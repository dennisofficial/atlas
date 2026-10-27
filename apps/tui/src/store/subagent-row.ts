import { agentDisplayName, EAgentStatus, type ThreadId } from '@dltech/atlas-core'
import {
  TEAMMATE_AGENT_TYPE,
  type AgentSnapshot,
  type PullRequestBadge,
} from '@dltech/atlas-harness'

import { truncateCells } from '../ui/components/sidebar/cells'
import { formatElapsed } from '../ui/theme'
import { oneLineOf, TITLE_CELLS } from './sidebar-text'

export type SidebarSubagent = {
  id: string
  name: string
  agentType?: string | undefined
  status: EAgentStatus
  waitingOn?: string | undefined
  value: string
  selected: boolean
  pullRequest?: PullRequestBadge | undefined
}

export type SidebarCrewFold = { hidden: number; hiddenFailed: boolean }

const WAITING_CELLS = 18

export const subagentLabel = (snapshot: Pick<AgentSnapshot, 'intent' | 'agentType'>): string =>
  truncateCells({ text: agentDisplayName(snapshot), cells: TITLE_CELLS })

export const subagentTitle = (snapshot: Pick<AgentSnapshot, 'intent' | 'agentType'>): string =>
  oneLineOf(snapshot.intent) ?? snapshot.agentType

export const isAgentLive = (agent: Pick<AgentSnapshot, 'status'>): boolean =>
  agent.status === EAgentStatus.Running || agent.status === EAgentStatus.Blocked

export const isAgentTicking = (agent: Pick<AgentSnapshot, 'status' | 'waitingOn'>): boolean =>
  agent.status === EAgentStatus.Running && agent.waitingOn === undefined

const FIXED_VALUE: Record<EAgentStatus, string | null> = {
  [EAgentStatus.Running]: null,
  [EAgentStatus.Blocked]: 'approve?',
  [EAgentStatus.Paused]: 'paused',
  [EAgentStatus.Finished]: 'done',
  [EAgentStatus.Failed]: 'failed',
  [EAgentStatus.Stopped]: 'stopped',
}

const elapsedLabel = (args: { startedAt: string; now: number }): string => {
  const started = Date.parse(args.startedAt)
  if (Number.isNaN(started)) return 'running'

  return formatElapsed(Math.max(0, args.now - started))
}

export function subagentValue(args: {
  snapshot: Pick<AgentSnapshot, 'status' | 'waitingOn' | 'startedAt'>
  now: number
}): string {
  const { snapshot } = args
  const fixed = FIXED_VALUE[snapshot.status]
  if (fixed !== null) return fixed
  if (snapshot.waitingOn !== undefined) {
    return truncateCells({ text: snapshot.waitingOn, cells: WAITING_CELLS })
  }

  return elapsedLabel({ startedAt: snapshot.startedAt, now: args.now })
}

export function subagentRows(args: {
  snapshots: readonly AgentSnapshot[]
  now: number
  viewing?: string | null | undefined
  pullRequestOf?: ((args: { threadId: ThreadId }) => PullRequestBadge | null) | undefined
}): readonly SidebarSubagent[] {
  return args.snapshots.map((snapshot) => ({
    id: snapshot.agentId,
    name: subagentTitle(snapshot),
    agentType: snapshot.agentType,
    status: snapshot.status,
    waitingOn: snapshot.waitingOn,
    value: subagentValue({ snapshot, now: args.now }),
    selected: snapshot.agentId === args.viewing,
    pullRequest:
      snapshot.agentType === TEAMMATE_AGENT_TYPE
        ? (args.pullRequestOf?.({ threadId: snapshot.agentId }) ?? undefined)
        : undefined,
  }))
}
