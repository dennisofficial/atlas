import type { ApiClient, ApiClientOptions } from '@dltech/atlas-api-router'
import {
  type CompactThreadInput,
  type ForkThreadInput,
  type PodEvent,
  type PodEventsReply,
} from '@dltech/atlas-wire'

import { EventSource } from 'eventsource'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import {
  wireThreadSchema,
  type WireDraft,
  type WireEvent,
  type WireThread,
  type WireTurn,
} from './session-wire'

export type OpenThreadWire = {
  threadId?: string | undefined
  runId: string
  drafts: readonly WireDraft[]
  title?: string | undefined
  workspace?: string | undefined
  repo?: string | null | undefined
  executionLocation?: string | undefined
  agent?: { spawnedBy: string; type: string } | undefined
}

type MarkArgs = {
  threadId: string
  anchor: CompactThreadInput['anchor']
  fromSeq: number
  throughSeq: number
  summary: string
}

export class SessionsClient {
  private readonly client: ApiClient
  private readonly streamClient: ApiClient

  constructor(args: {
    url: string
    token: string
    clientVersion?: string
    fetchFn?: typeof fetch
    EventSource?: ApiClientOptions['EventSource']
  }) {
    const shared = {
      url: args.url,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
    }
    this.client = createHarnessApiClient(shared)
    this.streamClient = createHarnessApiClient({
      ...shared,
      timeoutMs: null,
      EventSource: args.EventSource ?? EventSource,
    })
  }

  watchEvents(args: {
    threadId: string
    onTick: () => void
    onFailure: (reason: string) => void
    onEnded: () => void
  }): () => void {
    const subscription = this.streamClient.sandboxSelf.watchEvents.subscribe(
      { threadId: args.threadId },
      {
        onData: args.onTick,
        onError: (failure) => args.onFailure(failure.message),
        onComplete: args.onEnded,
      },
    )
    return () => subscription.unsubscribe()
  }

  async createThread(args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: { spawnedBy: string; type: string } | undefined
  }): Promise<WireThread> {
    const body = await cloudCall(this.client.threads.create.mutate(args))
    return wireThreadSchema.parse(body)
  }

  async openThread(args: OpenThreadWire): Promise<{ thread: WireThread; events: WireEvent[] }> {
    const { threadId, drafts, ...rest } = args
    return await cloudCall(
      this.client.threads.open.mutate({
        ...rest,
        drafts: [...drafts],
        ...(threadId === undefined ? {} : { id: threadId }),
      }),
    )
  }

  async findThread(args: { threadId: string }): Promise<WireThread | undefined> {
    return await cloudCall(this.client.threads.get.query({ threadId: args.threadId }), {
      allowMissing: true,
    })
  }

  async spawnedThreads(args: { threadId: string }): Promise<WireThread[]> {
    return await cloudCall(this.client.threads.spawned.query({ threadId: args.threadId }))
  }

  async mostRecentThread(args: { project: string }): Promise<WireThread | undefined> {
    const thread = await cloudCall(this.client.threads.recent.query({ project: args.project }), {
      allowMissing: true,
    })
    return thread ?? undefined
  }

  async listThreads(args: { project: string; limit?: number | undefined }): Promise<WireThread[]> {
    return await cloudCall(
      this.client.threads.list.query({
        project: args.project,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }),
    )
  }

  async renameThread(args: { threadId: string; title: string }): Promise<void> {
    await cloudCall(this.client.threads.rename.mutate(args))
  }

  async chooseThreadModel(args: { threadId: string; ref: string; effort: string }): Promise<void> {
    await cloudCall(this.client.threads.chooseModel.mutate(args))
  }

  async adoptThread(args: {
    threadId: string
    workspace: string
    repo: string | null
  }): Promise<void> {
    await cloudCall(this.client.threads.adopt.mutate(args))
  }

  async rewindThread(args: {
    threadId: string
    toSeq: number
    cutAgents?: readonly string[] | undefined
  }): Promise<void> {
    await cloudCall(
      this.client.threads.rewind.mutate({
        threadId: args.threadId,
        toSeq: args.toSeq,
        ...(args.cutAgents === undefined ? {} : { cutAgents: [...args.cutAgents] }),
      }),
    )
  }

  async compactThread(args: MarkArgs): Promise<number> {
    const reply = await cloudCall(this.client.threads.compact.mutate(args))
    return reply.replaced
  }

  async summariseThread(
    args: MarkArgs & { cutAgents?: readonly string[] | undefined },
  ): Promise<number> {
    const { cutAgents, ...rest } = args
    const reply = await cloudCall(
      this.client.threads.summarise.mutate({
        ...rest,
        ...(cutAgents === undefined ? {} : { cutAgents: [...cutAgents] }),
      }),
    )
    return reply.replaced
  }

  async forkThread(args: {
    threadId: string
    seq: number
    mode: ForkThreadInput['mode']
    title?: string | undefined
  }): Promise<WireThread> {
    return await cloudCall(this.client.threads.fork.mutate(args))
  }

  async appendEvents(args: {
    threadId: string
    runId: string
    parentRunId?: string | undefined
    depth?: number | undefined
    drafts: readonly WireDraft[]
  }): Promise<WireEvent[]> {
    return await cloudCall(
      this.client.threadEvents.append.mutate({ ...args, drafts: [...args.drafts] }),
    )
  }

  async replaceEvents(args: {
    threadId: string
    runId: string
    drafts: readonly WireDraft[]
  }): Promise<WireEvent[]> {
    return await cloudCall(
      this.client.threadEvents.replace.mutate({ ...args, drafts: [...args.drafts] }),
    )
  }

  async readEvents(args: {
    threadId: string
    fromSeq?: number | undefined
    upTo?: number | undefined
    own?: boolean | undefined
  }): Promise<WireEvent[]> {
    return await cloudCall(
      this.client.threadEvents.read.query({
        threadId: args.threadId,
        ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
        ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
        ...(args.own === true ? { own: true } : {}),
      }),
    )
  }

  async importEvents(args: {
    threadId: string
    events: readonly PodEvent[]
  }): Promise<PodEventsReply> {
    return await cloudCall(
      this.client.threadEvents.import.mutate({ threadId: args.threadId, events: [...args.events] }),
    )
  }

  async threadHead(args: { threadId: string }): Promise<number> {
    const reply = await cloudCall(this.client.threadEvents.head.query({ threadId: args.threadId }))
    return reply.head
  }

  async recordTurn(args: {
    threadId: string
    runId: string
    spend: Omit<WireTurn, 'runId' | 'threadId'>
  }): Promise<void> {
    await cloudCall(
      this.client.threadTurns.record.mutate({
        ...args.spend,
        threadId: args.threadId,
        runId: args.runId,
      }),
    )
  }

  async turnsForThread(args: { threadId: string }): Promise<WireTurn[]> {
    return await cloudCall(this.client.threadTurns.list.query({ threadId: args.threadId }))
  }

  async turnTree(args: { threadId: string }): Promise<{ own: WireTurn[]; delegated: WireTurn[] }> {
    return await cloudCall(this.client.threadTurns.tree.query({ threadId: args.threadId }))
  }
}
