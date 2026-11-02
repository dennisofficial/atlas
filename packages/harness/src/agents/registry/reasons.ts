import { EAgentStatus, EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import type { AgentType } from '../types'
import type { ChildState } from './child-state'
import type { AgentSnapshot } from './snapshot'

export const EMPTY_BRIEF = 'a sub-agent reads nothing but its brief, so it cannot be empty'

export const statusOf = (outcome: TurnOutcome): EAgentStatus => {
  if (outcome.status === ETurnStatus.Failed) return EAgentStatus.Failed
  if (outcome.status === ETurnStatus.Interrupted) return EAgentStatus.Stopped
  if (outcome.status === ETurnStatus.RelocationPaused) return EAgentStatus.Paused
  if (outcome.status === ETurnStatus.Paused) return EAgentStatus.Blocked
  if (outcome.status === ETurnStatus.WaitingForModel) return EAgentStatus.WaitingForModel
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

export const wedgedAgent = ({ agentId }: { agentId: ThreadId }): string =>
  `agent ${agentId} ended permanently: its thread fails prompt assembly on every step, so Atlas will not retry it and a message cannot repair the thread; spawn a fresh agent instead`

export function terminalAgent({
  agentId,
  status,
  killedBy,
}: {
  agentId: ThreadId
  status: EAgentStatus
  killedBy?: EKilledBy | undefined
}): string {
  if (killedBy === EKilledBy.Fault) return wedgedAgent({ agentId })
  return `agent ${agentId} is ${status}, so a queued resume is dropped rather than replayed; send a message if it should run again`
}

export const deliberatelyStopped = ({ agentId }: { agentId: ThreadId }): string =>
  `agent ${agentId} was stopped deliberately, so queued notices do not wake it; send a message if it should run again`

export const killedRefusal = ({ child }: { child: ChildState }): string =>
  child.killedBy === EKilledBy.Fault
    ? wedgedAgent({ agentId: child.agentId })
    : deliberatelyStopped({ agentId: child.agentId })

export const TEAMMATE_FROM_MAIN_ONLY =
  'only the main session spawns teammates — end your turn asking for one, and the main agent will spawn it and hand you its id'

export const NOT_A_TEAMMATE =
  'that channel is how a teammate reports to the main session; you are not a teammate, so message your own agents with agent_say or end your turn to reach the main agent'

export const reportNotRecorded = (cause: string): string =>
  `your report was not delivered: the main agent's log refused it (${cause}); nothing was sent, so send it again`
