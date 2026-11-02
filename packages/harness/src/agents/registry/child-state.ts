import {
  type SaidFile,
  type SaidImage,
  attributedStop,
  EAgentStatus,
  type ERunFailureKind,
  type AssistantPart,
  type EKilledBy,
  type EMessageOrigin,
  type EventDraft,
  type ProviderIdentity,
  type RosteredAgent,
  type ThreadId,
  type WaitEpisodeRef,
} from '@dltech/atlas-core'

import { PauseSignal } from '../../loop/pause-signal'
import type { AgentSnapshot, ChildContext } from './snapshot'

export type ChildState = {
  agentId: ThreadId
  spawnedBy: ThreadId
  agentType: string
  intent: string
  status: EAgentStatus
  killedBy: EKilledBy | undefined
  turns: number
  toolCalls: number
  lastTool: string | undefined
  lastText: string
  lastFullText: string
  failureCause: string | undefined
  failureKind: ERunFailureKind | undefined
  startedAt: string
  steppingSince: string | undefined
  endedAt: string | undefined
  deliveredAt: string | undefined
  waitingOn: string | undefined
  waitingFor: WaitEpisodeRef | undefined
  abort: AbortController
  pause: PauseSignal
  pending: SteerMessage[]
  context: ChildContext | undefined
  model: ProviderIdentity | undefined
  projectDirectory: string | undefined
}

export type SteerMessage = {
  text: string
  images?: readonly SaidImage[] | undefined
  files?: readonly SaidFile[] | undefined
  via?: EMessageOrigin | undefined
}

export const LAST_TEXT_TAIL_CHARACTERS = 4_000

export const boundedTail = (text: string): string =>
  text.length <= LAST_TEXT_TAIL_CHARACTERS ? text : text.slice(-LAST_TEXT_TAIL_CHARACTERS)

export const isRunning = (child: ChildState): boolean => child.status === EAgentStatus.Running

export const isStepping = (child: ChildState): boolean =>
  isRunning(child) && child.steppingSince !== undefined

export const isHeld = (child: ChildState): boolean =>
  isRunning(child) && child.steppingSince === undefined

export const isWaiting = (child: ChildState): boolean =>
  child.status === EAgentStatus.WaitingForModel

export function parkWaiting({
  child,
  episode,
}: {
  child: ChildState
  episode: WaitEpisodeRef
}): void {
  child.status = EAgentStatus.WaitingForModel
  child.waitingFor = episode
  child.steppingSince = undefined
  child.endedAt = undefined
  child.waitingOn = undefined
}

export function freshChild({
  agentId,
  spawnedBy,
  agentType,
  intent,
  at,
  projectDirectory,
}: {
  agentId: ThreadId
  spawnedBy: ThreadId
  agentType: string
  intent: string
  at: string
  projectDirectory: string | undefined
}): ChildState {
  return {
    agentId,
    spawnedBy,
    agentType,
    intent,
    status: EAgentStatus.Running,
    killedBy: undefined,
    turns: 0,
    toolCalls: 0,
    lastTool: undefined,
    lastText: '',
    lastFullText: '',
    failureCause: undefined,
    failureKind: undefined,
    startedAt: at,
    steppingSince: undefined,
    endedAt: undefined,
    deliveredAt: undefined,
    waitingOn: undefined,
    waitingFor: undefined,
    abort: new AbortController(),
    pause: new PauseSignal(),
    pending: [],
    context: undefined,
    model: undefined,
    projectDirectory,
  }
}

export function recoveredChild({
  agent,
  spawnedBy,
  at,
}: {
  agent: RosteredAgent
  spawnedBy: ThreadId
  at: string
}): ChildState {
  return {
    agentId: agent.agentId,
    spawnedBy,
    agentType: agent.agentType,
    intent: agent.intent,
    status: agent.status,
    killedBy: agent.killedBy,
    turns: agent.turns,
    toolCalls: agent.toolCalls,
    lastTool: undefined,
    lastText: boundedTail(agent.prose),
    lastFullText: agent.prose,
    failureCause: agent.failureCause,
    failureKind: agent.failureKind,
    startedAt: agent.spawnedAt ?? at,
    steppingSince: undefined,
    endedAt: agent.endedAt,
    deliveredAt: undefined,
    waitingOn: undefined,
    waitingFor: undefined,
    abort: new AbortController(),
    pause: new PauseSignal(),
    pending: [],
    context: undefined,
    model: undefined,
    projectDirectory: undefined,
  }
}

export function reviseFromTransfer({
  child,
  agent,
}: {
  child: ChildState
  agent: RosteredAgent
}): void {
  child.agentType = agent.agentType
  child.intent = agent.intent
  child.status = agent.status
  child.killedBy = agent.killedBy
  child.turns = agent.turns
  child.toolCalls = agent.toolCalls
  child.lastTool = undefined
  child.lastText = boundedTail(agent.prose)
  child.lastFullText = agent.prose
  child.failureCause = agent.failureCause
  child.failureKind = agent.failureKind
  child.startedAt = agent.spawnedAt ?? child.startedAt
  child.steppingSince = undefined
  child.endedAt = agent.endedAt
  child.deliveredAt = undefined
  child.waitingOn = undefined
  child.waitingFor = undefined
  child.abort = new AbortController()
  child.pause = new PauseSignal()
  child.context = undefined
}

export function snapshotOf(child: ChildState): AgentSnapshot {
  return {
    agentId: child.agentId,
    spawnedBy: child.spawnedBy,
    agentType: child.agentType,
    intent: child.intent,
    status: child.status,
    killedBy: attributedStop({ status: child.status, killedBy: child.killedBy }),
    turns: child.turns,
    toolCalls: child.toolCalls,
    lastTool: child.lastTool,
    ...(child.failureCause === undefined ? {} : { failureCause: child.failureCause }),
    ...(child.failureKind === undefined ? {} : { failureKind: child.failureKind }),
    startedAt: child.startedAt,
    ...(child.steppingSince === undefined ? {} : { steppingSince: child.steppingSince }),
    endedAt: child.endedAt,
    deliveredAt: child.deliveredAt,
    context: child.context,
    model: child.model,
    ...(child.waitingOn === undefined ? {} : { waitingOn: child.waitingOn }),
  }
}

export function bookkeepingEndedDraft(child: ChildState): EventDraft {
  return { ...agentEndedDraft(child), relayed: false }
}

export function agentEndedDraft(child: ChildState): EventDraft & { type: 'agent-ended' } {
  return {
    type: 'agent-ended',
    agentId: child.agentId,
    agentType: child.agentType,
    intent: child.intent,
    status: child.status,
    killedBy: attributedStop({ status: child.status, killedBy: child.killedBy }),
    prose: child.lastFullText,
    ...(child.failureCause === undefined ? {} : { failureCause: child.failureCause }),
    ...(child.failureKind === undefined ? {} : { failureKind: child.failureKind }),
    turns: child.turns,
    toolCalls: child.toolCalls,
  }
}

const spokenText = (parts: readonly AssistantPart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()

export function recordContext({
  child,
  tokens,
  window,
}: {
  child: ChildState
  tokens: number
  window: number
}): void {
  child.context = { tokens, window }
}

export function recordProgress({
  child,
  drafts,
}: {
  child: ChildState
  drafts: readonly EventDraft[]
}): void {
  for (const draft of drafts) {
    if (draft.type === 'assistant-said') {
      child.turns += 1
      const said = spokenText(draft.parts)
      if (said !== '') {
        child.lastText = boundedTail(said)
        child.lastFullText = said
      }
      continue
    }

    if (draft.type === 'tool-called') {
      child.toolCalls += 1
      child.lastTool = draft.name
    }
  }
}
