import {
  type ECompactionAnchor,
  type EExecutionLocation,
  EForkMode,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'

import { titleMatchesHandle } from '../composition/thread-slug'
import type { Unsubscribe } from '../channel/delta-channel'
import type { OpenThreadArgs } from '../store/create-with-events'
import type {
  ModelChosenListener,
  RenameListener,
  SupervisedAgent,
  ThreadModel,
  ThreadSummary,
} from '../store/thread-store'
import { ThreadStorePort } from '../store/thread-store'
import { EClientRequest, readThreadReplySchema, readThreadsReplySchema } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'
import { threadFromWire } from './session-wire'

const WRITE_REFUSAL =
  'the sandbox owns the transcript while lifted — thread mutations happen in its loop, not over this channel'

const refuseWrite = (): Promise<never> => Promise.reject(new Error(WRITE_REFUSAL))

/**
 * The cloud transcript's thread-record half: reads and the two mutations the operator owns — the
 * thread's name and its model — cross the channel to the sandbox's serve, which applies them to
 * its on-disk stores and announces the change back over the wire. Every other mutation still
 * refuses: the loop inside the sandbox is the only writer of those.
 */
export class RemoteThreadStore extends ThreadStorePort {
  private readonly channel: Pick<
    RemoteDeltaChannel,
    'request' | 'onThreadRenamed' | 'onThreadModelChanged'
  >
  private readonly renameListeners = new Set<RenameListener>()
  private readonly modelChosenListeners = new Set<ModelChosenListener>()

  constructor(args: {
    channel: Pick<RemoteDeltaChannel, 'request' | 'onThreadRenamed' | 'onThreadModelChanged'>
  }) {
    super()
    this.channel = args.channel
    this.channel.onThreadRenamed((renamed) => this.emitRename(renamed))
    this.channel.onThreadModelChanged((changed) => this.emitModelChosen(changed))
  }

  override onRename(listener: RenameListener): Unsubscribe {
    this.renameListeners.add(listener)
    return () => {
      this.renameListeners.delete(listener)
    }
  }

  override onModelChosen(listener: ModelChosenListener): Unsubscribe {
    this.modelChosenListeners.add(listener)
    return () => {
      this.modelChosenListeners.delete(listener)
    }
  }

  private emitRename(args: { threadId: ThreadId; title: string }): void {
    for (const listener of [...this.renameListeners]) listener(args)
  }

  private emitModelChosen(args: { threadId: ThreadId; model: ThreadModel }): void {
    for (const listener of [...this.modelChosenListeners]) listener(args)
  }

  async find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined> {
    const reply = readThreadReplySchema.parse(
      await this.channel.request({
        op: EClientRequest.ReadThread,
        params: { threadId: args.threadId },
      }),
    )
    return reply.thread === null ? undefined : threadFromWire(reply.thread)
  }

  async spawned(args: { threadId: ThreadId }): Promise<readonly ThreadSummary[]> {
    const reply = readThreadsReplySchema.parse(
      await this.channel.request({ op: EClientRequest.ReadThreads, params: {} }),
    )
    return reply.threads
      .map(threadFromWire)
      .filter((thread) => thread.agent?.spawnedBy === args.threadId)
  }

  async mostRecent(_args: { project: string }): Promise<ThreadSummary | undefined> {
    return undefined
  }

  async list(_args: {
    project: string
    limit?: number | undefined
  }): Promise<readonly ThreadSummary[]> {
    return []
  }

  async findNamed(args: {
    project: string
    handle: string
  }): Promise<ThreadSummary | undefined> {
    const reply = readThreadsReplySchema.parse(
      await this.channel.request({ op: EClientRequest.ReadThreads, params: {} }),
    )
    return reply.threads
      .map(threadFromWire)
      .find(
        (thread) =>
          thread.title !== undefined &&
          titleMatchesHandle({ title: thread.title, handle: args.handle }),
      )
  }

  create(_args: Parameters<ThreadStorePort['create']>[0]): Promise<ThreadSummary> {
    return refuseWrite()
  }

  createWithFirstEvents(
    _args: OpenThreadArgs,
  ): Promise<{ thread: ThreadSummary; events: Event[] }> {
    return refuseWrite()
  }

  async rename(args: { threadId: ThreadId; title: string }): Promise<void> {
    await this.channel.request({
      op: EClientRequest.RenameThread,
      params: { threadId: args.threadId, title: args.title },
    })
    this.emitRename(args)
  }

  async chooseModel(args: Parameters<ThreadStorePort['chooseModel']>[0]): Promise<void> {
    const model = { ref: args.model.ref, effort: args.model.effort }
    await this.channel.request({
      op: EClientRequest.SetThreadModel,
      params:
        args.retarget === undefined
          ? { threadId: args.threadId, model }
          : { threadId: args.threadId, model, retarget: args.retarget },
    })
    this.emitModelChosen({ threadId: args.threadId, model: args.model })
  }

  chooseExecutionLocation(_args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void> {
    return refuseWrite()
  }

  adopt(_args: { threadId: ThreadId; workspace: string; repo: string | null }): Promise<void> {
    return refuseWrite()
  }

  rewind(_args: {
    threadId: ThreadId
    toSeq: number
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<void> {
    return refuseWrite()
  }

  compact(_args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
  }): Promise<number> {
    return refuseWrite()
  }

  summarise(_args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<number> {
    return refuseWrite()
  }

  fork(_args: {
    from: ThreadId
    seq: number
    mode: EForkMode
    title?: string | undefined
  }): Promise<ThreadSummary> {
    return refuseWrite()
  }
}
