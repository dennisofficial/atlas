import {
  ECompactionAnchor,
  EForkMode,
  type EExecutionLocation,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'

import type { OpenThreadArgs } from '../store/create-with-events'
import type { SupervisedAgent, ThreadModel, ThreadSummary } from '../store/thread-store'
import { ThreadStorePort } from '../store/thread-store'
import type { SessionsClient } from './sessions-client'
import { eventFromWire, threadFromWire, wireDraftOf } from './session-wire'

export class RemoteThreadStore extends ThreadStorePort {
  private readonly client: SessionsClient

  constructor(args: { client: SessionsClient }) {
    super()
    this.client = args.client
  }

  async create(args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: SupervisedAgent | undefined
  }): Promise<ThreadSummary> {
    const wire = await this.client.createThread({
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      ...(args.repo === undefined ? {} : { repo: args.repo }),
      ...(args.agent === undefined
        ? {}
        : { agent: { spawnedBy: args.agent.spawnedBy, type: args.agent.type } }),
    })
    return threadFromWire(wire)
  }

  async createWithFirstEvents(
    args: OpenThreadArgs,
  ): Promise<{ thread: ThreadSummary; events: Event[] }> {
    const wire = await this.client.openThread({
      runId: args.runId,
      drafts: args.drafts.map(wireDraftOf),
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
      ...(args.repo === undefined ? {} : { repo: args.repo }),
      ...(args.executionLocation === undefined
        ? {}
        : { executionLocation: args.executionLocation }),
      ...(args.agent === undefined
        ? {}
        : { agent: { spawnedBy: args.agent.spawnedBy, type: args.agent.type } }),
    })
    return { thread: threadFromWire(wire.thread), events: wire.events.map(eventFromWire) }
  }

  async find(args: { threadId: ThreadId }): Promise<ThreadSummary | undefined> {
    const wire = await this.client.findThread({ threadId: args.threadId })
    return wire === undefined ? undefined : threadFromWire(wire)
  }

  async spawned(args: { threadId: ThreadId }): Promise<readonly ThreadSummary[]> {
    const wire = await this.client.spawnedThreads({ threadId: args.threadId })
    return wire.map(threadFromWire)
  }

  async mostRecent(args: { project: string }): Promise<ThreadSummary | undefined> {
    const wire = await this.client.mostRecentThread({ project: args.project })
    return wire === undefined ? undefined : threadFromWire(wire)
  }

  async list(args: {
    project: string
    limit?: number | undefined
  }): Promise<readonly ThreadSummary[]> {
    const wire = await this.client.listThreads({
      project: args.project,
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    })
    return wire.map(threadFromWire)
  }

  async rename(args: { threadId: ThreadId; title: string }): Promise<void> {
    await this.client.renameThread({ threadId: args.threadId, title: args.title })
  }

  async chooseModel(args: { threadId: ThreadId; model: ThreadModel }): Promise<void> {
    await this.client.chooseThreadModel({
      threadId: args.threadId,
      ref: args.model.ref,
      effort: args.model.effort,
    })
  }

  async chooseExecutionLocation(args: {
    threadId: ThreadId
    location: EExecutionLocation
  }): Promise<void> {
    await this.client.chooseThreadLocation({ threadId: args.threadId, location: args.location })
  }

  async adopt(args: {
    threadId: ThreadId
    workspace: string
    repo: string | null
  }): Promise<void> {
    await this.client.adoptThread({
      threadId: args.threadId,
      workspace: args.workspace,
      repo: args.repo,
    })
  }

  async rewind(args: {
    threadId: ThreadId
    toSeq: number
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<void> {
    await this.client.rewindThread({
      threadId: args.threadId,
      toSeq: args.toSeq,
      ...(args.cutAgents === undefined ? {} : { cutAgents: args.cutAgents }),
    })
  }

  compact(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
  }): Promise<number> {
    return this.client.compactThread({
      threadId: args.threadId,
      anchor: args.anchor,
      fromSeq: args.fromSeq,
      throughSeq: args.throughSeq,
      summary: args.summary,
    })
  }

  summarise(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    fromSeq: number
    throughSeq: number
    summary: string
    cutAgents?: readonly ThreadId[] | undefined
  }): Promise<number> {
    return this.client.summariseThread({
      threadId: args.threadId,
      anchor: args.anchor,
      fromSeq: args.fromSeq,
      throughSeq: args.throughSeq,
      summary: args.summary,
      ...(args.cutAgents === undefined ? {} : { cutAgents: args.cutAgents }),
    })
  }

  async fork(args: {
    from: ThreadId
    seq: number
    mode: EForkMode
    title?: string | undefined
  }): Promise<ThreadSummary> {
    const wire = await this.client.forkThread({
      threadId: args.from,
      seq: args.seq,
      mode: args.mode,
      ...(args.title === undefined ? {} : { title: args.title }),
    })
    return threadFromWire(wire)
  }
}
