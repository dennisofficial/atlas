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
import type { RenameListener, SupervisedAgent, ThreadModel, ThreadSummary } from '../store/thread-store'
import { ThreadStorePort } from '../store/thread-store'
import { EClientRequest, readThreadReplySchema, readThreadsReplySchema } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'
import { threadFromWire } from './session-wire'

const WRITE_REFUSAL =
  'the sandbox owns the transcript while lifted — thread mutations happen in its loop, not over this channel'

const refuseWrite = (): Promise<never> => Promise.reject(new Error(WRITE_REFUSAL))

/**
 * The cloud transcript's thread-record read half: the sandbox's serve answers from its on-disk
 * stores. Reads cross the channel; every mutation refuses, because the loop inside the sandbox is
 * the only writer and a client attempting one has a stale wiring bug to surface.
 */
export class RemoteThreadStore extends ThreadStorePort {
  private readonly channel: Pick<RemoteDeltaChannel, 'request'>

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'request'> }) {
    super()
    this.channel = args.channel
  }

  override onRename(_listener: RenameListener): Unsubscribe {
    return () => undefined
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

  create(_args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: SupervisedAgent | undefined
  }): Promise<ThreadSummary> {
    return refuseWrite()
  }

  createWithFirstEvents(
    _args: OpenThreadArgs,
  ): Promise<{ thread: ThreadSummary; events: Event[] }> {
    return refuseWrite()
  }

  rename(_args: { threadId: ThreadId; title: string }): Promise<void> {
    return refuseWrite()
  }

  chooseModel(_args: { threadId: ThreadId; model: ThreadModel }): Promise<void> {
    return refuseWrite()
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
