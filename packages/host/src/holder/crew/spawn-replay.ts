import { EAgentStatus, lostAgentEnding, type AgentLost, type ThreadId } from '@dltech/atlas-core'
import type { SubagentSnapshot } from '@dltech/atlas-plugin-sdk'

import { derivedIdOf } from '../derived-id'
import { effectResultKeyOf } from '../host-step'
import { STEP_FACT_KIND } from '../record/call-steps'
import type { SessionRecord } from '../record/record-adapter'
import { endingKeyOf, postNotice, threadLastSeq } from './child-reports'
import type { CrewRoomArgs } from './crew-room'
import type { OpenChild } from './open-children'

const SPAWN_OP = 'host.agent.spawn'

export const spawnBriefKeyOf = (agentId: ThreadId): string => `spawn-brief:${agentId}`

const opOf = (value: unknown): string | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  const op = (value as { op?: unknown }).op
  return typeof op === 'string' ? op : undefined
}

export const keyedSpawnOpenOf = (args: { record: SessionRecord; agentId: ThreadId }): boolean => {
  const bookkeeping = args.record.eventCache().bookkeeping()
  return bookkeeping
    .factsWithPrefix('')
    .filter((fact) => fact.kind === STEP_FACT_KIND && opOf(fact.value) === SPAWN_OP)
    .some(
      (step) =>
        derivedIdOf(`agent:${step.key}`) === args.agentId &&
        !bookkeeping.fact(effectResultKeyOf(step.key)).found,
    )
}

export const lostSnapshotOf = (child: OpenChild): SubagentSnapshot => ({
  agentId: child.agentId,
  agentType: child.agentType,
  intent: child.intent,
  status: EAgentStatus.Failed,
  turns: 0,
  toolCalls: 0,
  startedAt: child.spawnedAt,
  prose:
    'this sub-agent was started before the host changed and its log could not be read, so it never ran',
  ...(child.worktree === undefined ? {} : { worktree: child.worktree }),
})

export const postLostChild = async (args: {
  room: CrewRoomArgs
  child: OpenChild
  lost: AgentLost
}): Promise<void> => {
  const seq = await threadLastSeq({
    plane: args.room.deps.plane,
    threadId: args.child.agentId,
  }).catch(() => 0)
  await postNotice(args.room, {
    event: lostAgentEnding({
      agent: args.child,
      progress: { turns: 0, toolCalls: 0, prose: '' },
      lost: args.lost,
    }),
    key: endingKeyOf({ agentId: args.child.agentId, seq }),
  })
}
