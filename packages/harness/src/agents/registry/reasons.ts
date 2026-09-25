import { EAgentStatus, type ThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import type { AgentType } from '../types'
import type { AgentSnapshot } from './snapshot'

export const EMPTY_BRIEF = 'a sub-agent reads nothing but its brief, so it cannot be empty'

export const statusOf = (outcome: TurnOutcome): EAgentStatus => {
  if (outcome.status === ETurnStatus.Failed) return EAgentStatus.Failed
  if (outcome.status === ETurnStatus.Interrupted) return EAgentStatus.Stopped
  if (outcome.status === ETurnStatus.Paused) return EAgentStatus.Blocked
  return EAgentStatus.Finished
}

export function unknownAgentType({
  agentType,
  known,
}: {
  agentType: string
  known: readonly AgentType[]
}): string {
  const names = known.length === 0 ? 'none is registered' : known.map((one) => one.name).join(', ')
  return `no agent type named "${agentType}" is registered; known types: ${names}`
}

export function unknownAgent({
  agentId,
  known,
}: {
  agentId: ThreadId
  known: readonly AgentSnapshot[]
}): string {
  const ids = known.length === 0 ? 'none is running' : known.map((one) => one.agentId).join(', ')
  return `you have no sub-agent registered as "${agentId}"; your agents: ${ids}`
}

export const retiredAgentType = (agentType: string): string =>
  `agent type "${agentType}" is no longer defined, so this agent cannot take another step`

export const alreadyStepping = (agentId: ThreadId): string =>
  `agent ${agentId} is already taking a step; steer it with a message or stop it first`

export function terminalAgent({
  agentId,
  status,
}: {
  agentId: ThreadId
  status: EAgentStatus
}): string {
  return `agent ${agentId} is ${status}, so a queued resume is dropped rather than replayed; send a message if it should run again`
}

export const deliberatelyStopped = ({ agentId }: { agentId: ThreadId }): string =>
  `agent ${agentId} was stopped deliberately, so queued notices do not wake it; send a message if it should run again`

export const TEAMMATE_FROM_MAIN_ONLY =
  'only the main session spawns teammates — end your turn asking for one, and the main agent will spawn it and hand you its id'

export const NOT_A_TEAMMATE =
  'teammate_message is how one teammate reaches another; you are not a teammate, so message your own agents with agent_say or end your turn to reach the main agent'

export function notYourTeammate({
  agentId,
  known,
}: {
  agentId: ThreadId
  known: readonly AgentSnapshot[]
}): string {
  const ids = known.length === 0 ? 'none' : known.map((one) => one.agentId).join(', ')
  return `${agentId} is not a teammate of yours; your teammates: ${ids}`
}
