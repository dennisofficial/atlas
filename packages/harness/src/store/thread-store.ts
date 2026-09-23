import {
  ECompactionAnchor,
  EExecutionLocation,
  EForkMode,
  type ThreadId,
  type Event,
  type LinkedPullRequest,
} from '@dltech/atlas-core'

import type { OpenThreadArgs } from './create-with-events'
import type { ThreadWorktree } from './sessions/thread-places'

export type SupervisedAgent = { spawnedBy: ThreadId; type: string }

export type ThreadModel = { ref: string; effort: string }

export type ThreadSummary = {
  id: ThreadId
  title?: string | undefined
  head: number
  createdAt: string
  updatedAt: string
  parent?: { threadId: ThreadId; forkSeq: number } | undefined
  forkMode?: EForkMode | undefined
  agent?: SupervisedAgent | undefined
  workspace: string | null
  repo: string | null
  model?: ThreadModel | undefined
  /** Set only by `list`, the one read whose caller is picking between threads rather than opening one. */
  worktree?: ThreadWorktree | undefined
  /** Set only by `list`, alongside `worktree`; absent when the thread never linked a pull request. */
  pullRequests?: LinkedPullRequest[] | undefined
  executionLocation?: EExecutionLocation | undefined
}

export const THREAD_LISTING_LIMIT = 50

export abstract class ThreadStorePort {
  abstract create(args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: SupervisedAgent | undefined
  }): Promise<ThreadSummary>
  abstract createWithFirstEvents(
    args: OpenThreadArgs,
  ): Promise<{ thread: ThreadSummary; events: Event[] }>
  abstract find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined>
  abstract spawned(args: { threadId: ThreadId }): Promise<readonly ThreadSummary[]>
  abstract mostRecent(args: { project: string }): Promise<ThreadSummary | undefined>
  abstract list(args: {
    project: string
    limit?: number | undefined
  }): Promise<readonly ThreadSummary[]>
  /** Resume-by-name lookup; uncapped, where `list`'s limit is the picker's display window. */
  abstract findNamed(args: {
    project: string
    handle: string
  }): Promise<ThreadSummary | undefined>
  abstract rename(args: { threadId: ThreadId; title: string }): Promise<void>
  abstract chooseModel(args: { threadId: ThreadId; model: ThreadModel }): Promise<void>
  abstract chooseExecutionLocation(args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void>
  abstract adopt(args: {
    threadId: ThreadId
    workspace: string
    repo: string | null
  }): Promise<void>
  abstract rewind(args: {
    threadId: ThreadId
    toSeq: number
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<void>
  abstract compact(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
  }): Promise<number>

  abstract summarise(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<number>

  abstract fork(args: {
    from: ThreadId
    seq: number
    mode: EForkMode
    title?: string | undefined
  }): Promise<ThreadSummary>
}
