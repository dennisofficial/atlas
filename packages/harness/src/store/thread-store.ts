import {
  ECompactionAnchor,
  EExecutionLocation,
  EForkMode,
  locationOfPlacement,
  placementOf,
  type PlacementRecord,
  type ThreadId,
  type Event,
  type LinkedPullRequest,
} from '@dltech/atlas-core'

import type { Unsubscribe } from '../channel/delta-channel'
import type { ParkedTranscriptRecord } from '../cloud/transcript-freshness'
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

export type RenameListener = (args: { threadId: ThreadId; title: string }) => void

export type ModelChosenListener = (args: { threadId: ThreadId; model: ThreadModel }) => void

export type PlacementChangedListener = (args: {
  threadId: ThreadId
  record: PlacementRecord
}) => void

export type WritePlacementArgs = {
  threadId: ThreadId
  record: PlacementRecord
  expectedRevision?: number | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
}

export abstract class ThreadStorePort {
  onRename(listener: RenameListener): Unsubscribe {
    void listener
    return () => undefined
  }

  onModelChosen(listener: ModelChosenListener): Unsubscribe {
    void listener
    return () => undefined
  }

  onPlacementChanged(listener: PlacementChangedListener): Unsubscribe {
    void listener
    return () => undefined
  }

  async readPlacement(args: { threadId: ThreadId }): Promise<PlacementRecord | undefined> {
    const thread = await this.find(args)
    if (thread === undefined) return undefined
    return {
      placement: placementOf(thread.executionLocation ?? EExecutionLocation.Host),
      revision: 0,
      move: null,
      born: null,
    }
  }

  async writePlacement(args: WritePlacementArgs): Promise<void> {
    await this.chooseExecutionLocation({
      threadId: args.threadId,
      location: locationOfPlacement(args.record.placement),
    })
  }

  async writeParkedTranscript(args: {
    threadId: ThreadId
    record: ParkedTranscriptRecord
  }): Promise<void> {
    void args
  }

  async readParkedTranscript(args: { threadId: ThreadId }): Promise<ParkedTranscriptRecord | null> {
    void args
    return null
  }

  abstract create(args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: SupervisedAgent | undefined
    /** Caller-chosen id, for a stub that shadows a thread another store already owns; generated when absent. */
    id?: ThreadId | undefined
    /** Names an existing session the new main joins (rotation); absent, a main opens its own session. */
    sessionId?: string | undefined
    executionLocation?: EExecutionLocation | undefined
    model?: ThreadModel | undefined
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
    onUpdate?: ((threads: readonly ThreadSummary[]) => void) | undefined
    enrich?: readonly ThreadId[] | undefined
  }): Promise<readonly ThreadSummary[]>
  /** Resume-by-name lookup; uncapped, where `list`'s limit is the picker's display window. */
  abstract findNamed(args: {
    project: string
    handle: string
  }): Promise<ThreadSummary | undefined>
  abstract rename(args: { threadId: ThreadId; title: string }): Promise<void>
  abstract chooseModel(args: {
    threadId: ThreadId
    model: ThreadModel
    /** A deliberate per-child switch; passes the spawn-freeze guard for a frozen child. */
    retarget?: boolean | undefined
  }): Promise<void>
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
