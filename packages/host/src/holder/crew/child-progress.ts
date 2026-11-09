import {
  EAgentStatus,
  activeWorktreeOf,
  type AssistantPart,
  type Event,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-agent'
import type {
  SubagentSnapshot,
  SubagentWorktree,
  WorktreeEntryInfo,
} from '@dltech/atlas-plugin-sdk'

export type Progress = {
  turns: number
  toolCalls: number
  prose: string
  lastTool: string | undefined
}

const spokenText = (parts: readonly AssistantPart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()

export const progressOf = (events: readonly V2Event[]): Progress => {
  let turns = 0
  let toolCalls = 0
  let prose = ''
  let lastTool: string | undefined
  for (const event of events) {
    if (event.type === 'tool-called') {
      toolCalls += 1
      lastTool = event.name
      continue
    }
    if (event.type !== 'assistant-said') continue
    turns += 1
    const said = spokenText(event.parts)
    if (said !== '') prose = said
  }
  return { turns, toolCalls, prose, lastTool }
}

export const statusOf = (outcome: TurnOutcome): EAgentStatus => {
  switch (outcome.status) {
    case ETurnStatus.Failed:
      return EAgentStatus.Failed
    case ETurnStatus.Interrupted:
      return EAgentStatus.Stopped
    case ETurnStatus.Paused:
      return EAgentStatus.Blocked
    case ETurnStatus.HandoffPaused:
      return EAgentStatus.Paused
    case ETurnStatus.WaitingForModel:
      return EAgentStatus.WaitingForModel
    default:
      return EAgentStatus.Finished
  }
}

export const failureOf = (outcome: TurnOutcome): string | undefined =>
  outcome.status === ETurnStatus.Failed ? outcome.message : undefined

export const activeWorktreeSnapshotOf = (args: {
  events: readonly Event[]
  spawned: WorktreeEntryInfo | undefined
}): SubagentWorktree | undefined => {
  const active = activeWorktreeOf(args.events)
  if (active !== undefined) return { path: active.path, branch: active.branch }
  if (args.spawned === undefined) return undefined
  return { path: args.spawned.path, branch: args.spawned.branch }
}

type SpawnedWorktreeDraft = {
  path: string
  branch: string
  base?: string | undefined
  adopted?: boolean | undefined
}

export const worktreeDraftOf = (entry: WorktreeEntryInfo): SpawnedWorktreeDraft => ({
  path: entry.path,
  branch: entry.branch,
  ...(entry.base === undefined ? {} : { base: entry.base }),
  ...(entry.adopted === undefined ? {} : { adopted: entry.adopted }),
})

export const snapshotOf = (args: {
  agentId: ThreadId
  agentType: string
  intent: string
  startedAt: string
  events: readonly V2Event[]
  status: EAgentStatus
  endedAt: string | undefined
  worktree: SubagentWorktree | undefined
}): SubagentSnapshot => {
  const progress = progressOf(args.events)
  return {
    agentId: args.agentId,
    agentType: args.agentType,
    intent: args.intent,
    status: args.status,
    turns: progress.turns,
    toolCalls: progress.toolCalls,
    startedAt: args.startedAt,
    ...(args.endedAt === undefined ? {} : { endedAt: args.endedAt }),
    ...(progress.prose === '' ? {} : { prose: progress.prose }),
    ...(progress.lastTool === undefined ? {} : { lastTool: progress.lastTool }),
    ...(args.worktree === undefined ? {} : { worktree: args.worktree }),
  }
}
