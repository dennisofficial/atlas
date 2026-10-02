import {
  EAgentStatus,
  EKilledBy,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { TEAMMATE_AGENT_TYPE } from '../../types'
import { openChildThread } from '../open-child'
import { agentTypeNamed, openSupervisor, type OpenedSupervisor } from './fixtures'

export const openFamily = async (opened: OpenedSupervisor[]): Promise<OpenedSupervisor> => {
  const entry = await openSupervisor({
    agentTypes: [
      agentTypeNamed({ name: 'explore' }),
      agentTypeNamed({ name: TEAMMATE_AGENT_TYPE }),
    ],
  })
  opened.push(entry)
  return entry
}

export const openChild = async (args: {
  entry: OpenedSupervisor
  spawnedBy: ThreadId
  agentType?: string
  brief?: string
}): Promise<ThreadId> => {
  const { threadId } = await openChildThread({
    threads: args.entry.harness.threads,
    log: args.entry.harness.log,
    ids: args.entry.harness.ids,
    spawnedBy: args.spawnedBy,
    agentType: agentTypeNamed({ name: args.agentType ?? 'explore' }),
    brief: args.brief ?? 'find the callers',
    intent: 'find the callers',
  })
  return threadId
}

export const append = (entry: OpenedSupervisor, threadId: ThreadId, drafts: readonly EventDraft[]) =>
  entry.harness.log.append({ threadId, runId: entry.harness.ids.nextRunId(), drafts })

export const endingFor = (args: {
  agentId: ThreadId
  status: EAgentStatus
  killedBy?: EKilledBy
  turns?: number
  agentType?: string
}): EventDraft => ({
  type: 'agent-ended',
  agentId: args.agentId,
  agentType: args.agentType ?? 'explore',
  intent: 'find the callers',
  status: args.status,
  killedBy: args.killedBy,
  prose: 'four callers, in two files',
  turns: args.turns ?? 3,
  toolCalls: 2,
})

export const snapshotOf = (entry: OpenedSupervisor, owner: ThreadId, agentId: ThreadId) =>
  entry.supervisor.list({ threadId: owner }).find((one) => one.agentId === agentId)

