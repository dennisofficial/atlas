import type { WireThread } from '@dltech/atlas-wire'

export type ThreadModelDto = {
  ref: string
  effort: string
}

export type ThreadParentDto = {
  threadId: string
  forkSeq: number
}

export type SupervisedAgentDto = {
  spawnedBy: string
  type: string
}

export type ThreadWorktreeDto = {
  path: string
  branch: string
}

export type LinkedPullRequestDto = {
  number: number
  url: string
  repo: string
  branch: string
  state?: string | undefined
  via?: { threadId: string; title: string | null } | undefined
}

export type ThreadDraft = {
  id?: string | undefined
  title?: string | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
  model?: string | undefined
  effort?: string | undefined
  agent?: SupervisedAgentDto | undefined
}

export type ThreadSubscriptionDto = NonNullable<WireThread['subscriptions']>[number]

export type ThreadStatusDto = NonNullable<WireThread['status']>

export type ThreadDto = {
  id: string
  sessionId?: string | undefined
  title?: string | undefined
  head: number
  createdAt: string
  updatedAt: string
  parent?: ThreadParentDto | undefined
  forkMode?: string | undefined
  agent?: SupervisedAgentDto | undefined
  workspace: string | null
  repo: string | null
  model?: ThreadModelDto | undefined
  worktree?: ThreadWorktreeDto | undefined
  pullRequests?: LinkedPullRequestDto[] | undefined
  subscriptions?: ThreadSubscriptionDto[] | undefined
  executionLocation?: string | undefined
  projectId?: string | null | undefined
  pinnedAt?: string | null | undefined
  archivedAt?: string | null | undefined
  status?: ThreadStatusDto | undefined
}

export type EventDto = {
  id: string
  threadId: string
  seq: number
  runId: string
  parentRunId?: string | undefined
  depth: number
  at: string
  type: string
  body: string
  contextSlot?: string | undefined
  contextKey?: string | undefined
  contextDigest?: string | undefined
}

export type TurnDto = {
  runId: string
  threadId: string
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
}

export type TurnTreeDto = {
  own: TurnDto[]
  delegated: TurnDto[]
}
