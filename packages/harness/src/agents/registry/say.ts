import {
  EMessageOrigin,
  type EventLogPort,
  type IdPort,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType, type AgentType } from '../types'
import { isStepping, snapshotOf, type ChildState, type SteerMessage } from './child-state'
import type { ChildSteps } from './child-steps'
import { agentTypeNamed, type SupervisorDeps } from './deps'
import type { AgentOutcome } from './port'
import { NOT_A_TEAMMATE, notYourTeammate, retiredAgentType, unknownAgent } from './reasons'
import { childDirectory } from './relocate-children'
import type { AgentRoster } from './roster'

export type SayChannels = {
  log: EventLogPort
  ids: IdPort
  agentTypes: readonly AgentType[]
  roster: AgentRoster
  steps: ChildSteps
  deps: SupervisorDeps
}

type SaidArgs = {
  agentId: ThreadId
  threadId: ThreadId
  text: string
  images?: readonly SaidImage[] | undefined
}

async function deliver({
  args,
  via,
  child,
  known,
  channels,
}: {
  args: SaidArgs
  via: EMessageOrigin
  child: ChildState | undefined
  known: string
  channels: SayChannels
}): Promise<AgentOutcome> {
  const { log, ids, agentTypes, steps, deps } = channels

  if (child === undefined) return { ok: false, reason: known }

  if (isStepping(child)) {
    const queued: SteerMessage = {
      text: args.text,
      images: args.images,
      ...(via === EMessageOrigin.PeerAgent ? { via } : {}),
    }
    child.pending.push(queued)
    return { ok: true, snapshot: snapshotOf(child) }
  }

  const agentType = agentTypeNamed({ agentTypes, name: child.agentType })
  if (agentType === undefined) {
    return { ok: false, reason: retiredAgentType(child.agentType) }
  }

  await log.append({
    threadId: args.agentId,
    runId: ids.nextRunId(),
    drafts: [
      {
        type: 'user-said',
        text: args.text,
        via,
        ...(args.images === undefined || args.images.length === 0 ? {} : { images: args.images }),
      },
    ],
  })
  child.projectDirectory ??= await childDirectory({ deps, threadId: child.spawnedBy })
  steps.take({
    child,
    agentType,
    step: ({ runner, signal }) => runner.runTurn({ threadId: args.agentId, signal }),
  })

  return { ok: true, snapshot: snapshotOf(child) }
}

export async function say(args: SaidArgs & SayChannels): Promise<AgentOutcome> {
  const child = args.roster.find(args.agentId)
  const owned = child === undefined || child.spawnedBy !== args.threadId ? undefined : child

  return deliver({
    args,
    via: EMessageOrigin.ParentAgent,
    child: owned,
    known: unknownAgent({ agentId: args.agentId, known: args.roster.list(args.threadId) }),
    channels: args,
  })
}

export async function sayToPeer(args: SaidArgs & SayChannels): Promise<AgentOutcome> {
  const { roster } = args
  const caller = roster.find(args.threadId)
  const target = roster.find(args.agentId)

  if (caller === undefined || !isTeammateType(caller.agentType)) {
    return { ok: false, reason: NOT_A_TEAMMATE }
  }

  const teammates = roster
    .states()
    .filter(
      (child) =>
        child.agentId !== caller.agentId &&
        child.spawnedBy === caller.spawnedBy &&
        isTeammateType(child.agentType),
    )
  const known = notYourTeammate({ agentId: args.agentId, known: teammates.map(snapshotOf) })

  if (
    target === undefined ||
    !isTeammateType(target.agentType) ||
    target.spawnedBy !== caller.spawnedBy
  ) {
    return { ok: false, reason: known }
  }

  return deliver({ args, via: EMessageOrigin.PeerAgent, child: target, known, channels: args })
}
