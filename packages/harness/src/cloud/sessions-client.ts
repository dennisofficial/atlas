import { z } from 'zod'

import { cloudRequest } from './cloud-transport'
import {
  wireEventSchema,
  wireThreadSchema,
  wireTurnSchema,
  type WireDraft,
  type WireEvent,
  type WireThread,
  type WireTurn,
} from './session-wire'

const openResponseSchema = z.object({
  thread: wireThreadSchema,
  events: z.array(wireEventSchema),
})

const headResponseSchema = z.object({ head: z.number().int() })

const replacedResponseSchema = z.object({ replaced: z.number().int() })

const turnTreeSchema = z.object({
  own: z.array(wireTurnSchema),
  delegated: z.array(wireTurnSchema),
})

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

export class SessionsClient {
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    url: string
    token: string
    clientVersion?: string
    fetchFn?: typeof fetch
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
  }

  async createThread(args: {
    title?: string | undefined
    workspace?: string | undefined
    repo?: string | null | undefined
    agent?: { spawnedBy: string; type: string } | undefined
  }): Promise<WireThread> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/threads',
      body: {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        ...(args.agent === undefined ? {} : { agent: args.agent }),
      },
    })
    return wireThreadSchema.parse(body)
  }

  async openThread(args: OpenThreadWire): Promise<{ thread: WireThread; events: WireEvent[] }> {
    const body = await this.request({
      method: 'POST',
      path: '/v1/threads/open',
      body: {
        runId: args.runId,
        drafts: args.drafts,
        ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        ...(args.executionLocation === undefined
          ? {}
          : { executionLocation: args.executionLocation }),
        ...(args.agent === undefined ? {} : { agent: args.agent }),
      },
    })
    return openResponseSchema.parse(body)
  }

  async findThread(args: { threadId: string }): Promise<WireThread | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/threads/${args.threadId}`,
      allowMissing: true,
    })
    return body === undefined ? undefined : wireThreadSchema.parse(body)
  }

  async spawnedThreads(args: { threadId: string }): Promise<WireThread[]> {
    const body = await this.request({ method: 'GET', path: `/v1/threads/${args.threadId}/spawned` })
    return z.array(wireThreadSchema).parse(body)
  }

  async mostRecentThread(args: { project: string }): Promise<WireThread | undefined> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/threads/recent?project=${encodeURIComponent(args.project)}`,
      allowMissing: true,
    })
    if (body === undefined || body === null) return undefined
    return wireThreadSchema.parse(body)
  }

  async listThreads(args: { project: string; limit?: number | undefined }): Promise<WireThread[]> {
    const limit = args.limit === undefined ? '' : `&limit=${args.limit}`
    const body = await this.request({
      method: 'GET',
      path: `/v1/threads?project=${encodeURIComponent(args.project)}${limit}`,
    })
    return z.array(wireThreadSchema).parse(body)
  }

  async renameThread(args: { threadId: string; title: string }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/threads/${args.threadId}/title`,
      body: { title: args.title },
    })
  }

  async chooseThreadModel(args: {
    threadId: string
    ref: string
    effort: string
  }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/threads/${args.threadId}/model`,
      body: { ref: args.ref, effort: args.effort },
    })
  }

  async chooseThreadLocation(args: { threadId: string; location: string }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/threads/${args.threadId}/location`,
      body: { location: args.location },
    })
  }

  async adoptThread(args: {
    threadId: string
    workspace: string
    repo: string | null
  }): Promise<void> {
    await this.request({
      method: 'PATCH',
      path: `/v1/threads/${args.threadId}/workspace`,
      body: { workspace: args.workspace, repo: args.repo },
    })
  }

  async rewindThread(args: {
    threadId: string
    toSeq: number
    cutAgents?: readonly string[] | undefined
  }): Promise<void> {
    await this.request({
      method: 'POST',
      path: `/v1/threads/${args.threadId}/rewind`,
      body: {
        toSeq: args.toSeq,
        ...(args.cutAgents === undefined ? {} : { cutAgents: args.cutAgents }),
      },
    })
  }

  async compactThread(args: {
    threadId: string
    anchor: string
    fromSeq: number
    throughSeq: number
    summary: string
  }): Promise<number> {
    return await this.markThread(args, 'compact')
  }

  async summariseThread(args: {
    threadId: string
    anchor: string
    fromSeq: number
    throughSeq: number
    summary: string
    cutAgents?: readonly string[] | undefined
  }): Promise<number> {
    return await this.markThread(args, 'summarise')
  }

  async forkThread(args: {
    threadId: string
    seq: number
    mode: string
    title?: string | undefined
  }): Promise<WireThread> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/threads/${args.threadId}/fork`,
      body: {
        seq: args.seq,
        mode: args.mode,
        ...(args.title === undefined ? {} : { title: args.title }),
      },
    })
    return wireThreadSchema.parse(body)
  }

  async appendEvents(args: {
    threadId: string
    runId: string
    parentRunId?: string | undefined
    depth?: number | undefined
    drafts: readonly WireDraft[]
  }): Promise<WireEvent[]> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/threads/${args.threadId}/events`,
      body: {
        runId: args.runId,
        drafts: args.drafts,
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
        ...(args.depth === undefined ? {} : { depth: args.depth }),
      },
    })
    return z.array(wireEventSchema).parse(body)
  }

  async replaceEvents(args: {
    threadId: string
    runId: string
    drafts: readonly WireDraft[]
  }): Promise<WireEvent[]> {
    const body = await this.request({
      method: 'PUT',
      path: `/v1/threads/${args.threadId}/events`,
      body: { runId: args.runId, drafts: args.drafts },
    })
    return z.array(wireEventSchema).parse(body)
  }

  async readEvents(args: {
    threadId: string
    upTo?: number | undefined
    own?: boolean | undefined
  }): Promise<WireEvent[]> {
    const upTo = args.upTo === undefined ? '' : `?upTo=${args.upTo}`
    const own = args.own === true ? (upTo === '' ? '?own=true' : '&own=true') : ''
    const body = await this.request({
      method: 'GET',
      path: `/v1/threads/${args.threadId}/events${upTo}${own}`,
    })
    return z.array(wireEventSchema).parse(body)
  }

  async threadHead(args: { threadId: string }): Promise<number> {
    const body = await this.request({ method: 'GET', path: `/v1/threads/${args.threadId}/head` })
    return headResponseSchema.parse(body).head
  }

  async recordTurn(args: {
    threadId: string
    runId: string
    spend: Omit<WireTurn, 'runId' | 'threadId'>
  }): Promise<void> {
    await this.request({
      method: 'PUT',
      path: `/v1/threads/${args.threadId}/turns/${args.runId}`,
      body: args.spend,
    })
  }

  async turnsForThread(args: { threadId: string }): Promise<WireTurn[]> {
    const body = await this.request({ method: 'GET', path: `/v1/threads/${args.threadId}/turns` })
    return z.array(wireTurnSchema).parse(body)
  }

  async turnTree(args: { threadId: string }): Promise<{ own: WireTurn[]; delegated: WireTurn[] }> {
    const body = await this.request({
      method: 'GET',
      path: `/v1/threads/${args.threadId}/turns/tree`,
    })
    return turnTreeSchema.parse(body)
  }

  private async markThread(
    args: {
      threadId: string
      anchor: string
      fromSeq: number
      throughSeq: number
      summary: string
      cutAgents?: readonly string[] | undefined
    },
    operation: 'compact' | 'summarise',
  ): Promise<number> {
    const body = await this.request({
      method: 'POST',
      path: `/v1/threads/${args.threadId}/${operation}`,
      body: {
        anchor: args.anchor,
        fromSeq: args.fromSeq,
        throughSeq: args.throughSeq,
        summary: args.summary,
        ...(args.cutAgents === undefined ? {} : { cutAgents: args.cutAgents }),
      },
    })
    return replacedResponseSchema.parse(body).replaced
  }

  private request(args: {
    method: string
    path: string
    body?: unknown
    allowMissing?: boolean
  }): Promise<unknown> {
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
      ...(args.allowMissing === undefined ? {} : { allowMissing: args.allowMissing }),
    })
  }
}
