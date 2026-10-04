import type { AssistantPart, EventDraft } from '../events/body'
import type { Event, EventOfType } from '../events/envelope'
import type { ThreadId } from '../events/ids'
import { rowsOwnedBy } from '../events/ownership'
import { lostOf, type LifecycleKind } from '../lifecycle/lifecycle'
import { EKilledBy } from '../shells/status'
import { EAgentStatus } from './status'

/**
 * An agentId is a real ThreadId — globally unique, never recycled — so the id scopes to itself and
 * no boot identity is needed: one boot's ending can never name another boot's agent.
 */
export const agentLifecycleKind: LifecycleKind<
  EventOfType<'agent-spawned'>,
  EventOfType<'agent-ended'>
> = {
  isStart: (event): event is EventOfType<'agent-spawned'> => event.type === 'agent-spawned',
  isEnd: (event): event is EventOfType<'agent-ended'> => event.type === 'agent-ended',
  keyOf: (event) => event.agentId,
  scopeOf: (event) => event.agentId,
}

export type RosteredAgent = {
  agentId: ThreadId
  agentType: string
  intent: string
  status: EAgentStatus
  turns: number
  toolCalls: number
  prose: string
  killedBy: EKilledBy | undefined
  failureCause: string | undefined
  spawnedAt: string | undefined
  endedAt: string | undefined
}

/**
 * A spawn with no ending behind it means the process died while the child was stepping: a clean
 * quit records an ending for every live child, so the absence of one is a crash or a kill, and
 * nothing is left stepping it either way.
 */
export function agentRoster({
  events,
  threadId,
}: {
  events: readonly Event[]
  threadId: ThreadId
}): readonly RosteredAgent[] {
  const held = new Map<ThreadId, RosteredAgent>()

  for (const event of rowsOwnedBy({ events, threadId })) {
    if (event.type === 'agent-spawned') {
      const prior = held.get(event.agentId)
      if (prior !== undefined && prior.endedAt !== undefined) continue

      held.set(event.agentId, {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
        status: EAgentStatus.Stopped,
        turns: prior?.turns ?? 0,
        toolCalls: prior?.toolCalls ?? 0,
        prose: prior?.prose ?? '',
        killedBy: undefined,
        failureCause: undefined,
        spawnedAt: prior?.spawnedAt ?? event.at,
        endedAt: undefined,
      })
      continue
    }

    if (event.type === 'agent-restarted') {
      const previous = held.get(event.agentId)
      held.set(event.agentId, {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
        status: EAgentStatus.Stopped,
        turns: previous?.turns ?? 0,
        toolCalls: previous?.toolCalls ?? 0,
        prose: previous?.prose ?? '',
        killedBy: undefined,
        failureCause: undefined,
        spawnedAt: previous?.spawnedAt ?? event.at,
        endedAt: undefined,
      })
      continue
    }

    if (event.type !== 'agent-ended') continue

    held.set(event.agentId, {
      agentId: event.agentId,
      agentType: event.agentType,
      intent: event.intent,
      status: event.status === EAgentStatus.Running ? EAgentStatus.Stopped : event.status,
      turns: event.turns,
      toolCalls: event.toolCalls,
      prose: event.prose,
      killedBy: event.killedBy,
      failureCause: event.failureCause,
      spawnedAt: held.get(event.agentId)?.spawnedAt,
      endedAt: event.at,
    })
  }

  return [...held.values()]
}

export function unendedSpawns(events: readonly Event[]): readonly EventOfType<'agent-spawned'>[] {
  return lostOf(events, agentLifecycleKind).map((lifecycle) => lifecycle.started)
}

export const isLost = (agent: Pick<RosteredAgent, 'endedAt'>): boolean =>
  agent.endedAt === undefined

export type AgentProgress = { turns: number; toolCalls: number; prose: string }

const spokenText = (parts: readonly AssistantPart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()

export function agentProgress(drafts: readonly EventDraft[]): AgentProgress {
  let turns = 0
  let toolCalls = 0
  let prose = ''

  for (const draft of drafts) {
    if (draft.type === 'tool-called') {
      toolCalls += 1
      continue
    }
    if (draft.type !== 'assistant-said') continue

    turns += 1
    const said = spokenText(draft.parts)
    if (said !== '') prose = said
  }

  return { turns, toolCalls, prose }
}

export function lostAgentEnding({
  agent,
  progress,
}: {
  agent: Pick<RosteredAgent, 'agentId' | 'agentType' | 'intent'>
  progress: AgentProgress
}): EventDraft {
  return {
    type: 'agent-ended',
    agentId: agent.agentId,
    agentType: agent.agentType,
    intent: agent.intent,
    status: EAgentStatus.Stopped,
    killedBy: EKilledBy.Unrecorded,
    prose: progress.prose,
    turns: progress.turns,
    toolCalls: progress.toolCalls,
  }
}
