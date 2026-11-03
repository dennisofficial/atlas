import { randomUUID } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import type { V2SessionRow } from '@dltech/atlas-control'
import {
  sessionStatusOf,
  type InboxEntry,
  type V2Event,
  type V2SessionStatus,
} from '@dltech/atlas-core'
import { V2_INBOX_KIND_MESSAGE, v2InboxMessageSchema } from '@dltech/atlas-protocol'
import type {
  V2SessionEventsOutput,
  V2SessionListOutput,
  V2SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { db } from '@dltech/atlas-db'
import { V2WakePublisher } from './v2-wake.publisher'

export type LeaseView = { epoch: number; holderId: string | null; live: boolean }

const STATUS_EVENT_LIMIT = 1000

const toSummary = (row: V2SessionRow) => ({
  sessionId: row.sessionId,
  projectId: row.projectId,
  title: row.title,
  mainThreadId: row.mainThreadId,
  createdAt: row.createdAt,
})

@Injectable()
export class V2SessionsService {
  private readonly logger = new Logger(V2SessionsService.name)

  constructor(
    private readonly plane: ControlPlane,
    private readonly wakes: V2WakePublisher,
  ) {}

  async accessibleProjectId(args: { userId: string; projectId: string }): Promise<string> {
    const project = await db.orm.public.Project.select('id', 'ownerUserId').first({
      id: args.projectId,
    })
    if (project === null || project.ownerUserId !== args.userId) {
      throw new NotFoundException('project not found')
    }
    return project.id
  }

  async create(args: { userId: string; projectId: string; title?: string | undefined }) {
    await this.accessibleProjectId({ userId: args.userId, projectId: args.projectId })
    const sessionId = randomUUID()
    const mainThreadId = randomUUID()
    await this.plane.createSession({
      sessionId,
      userId: args.userId,
      projectId: args.projectId,
      title: args.title,
      mainThreadId,
    })
    return { sessionId, mainThreadId }
  }

  async list(args: {
    userId: string
    projectId?: string | undefined
    limit?: number | undefined
  }): Promise<V2SessionListOutput> {
    const sessions = await this.plane.listSessions({
      userId: args.userId,
      projectId: args.projectId,
      limit: args.limit ?? 100,
    })
    return { sessions: sessions.map(toSummary) }
  }

  async post(args: { userId: string; sessionId: string; text: string }) {
    await this.requireOwnedSession(args)
    const payload = JSON.stringify(v2InboxMessageSchema.parse({ text: args.text }))
    const { inboxId } = await this.plane.post({
      sessionId: args.sessionId,
      kind: V2_INBOX_KIND_MESSAGE,
      payload,
    })
    try {
      await this.wakes.publish({ sessionId: args.sessionId })
    } catch (failure) {
      this.logger.warn(`publishing the v2 wake for ${args.sessionId} failed: ${String(failure)}`)
    }
    return { inboxId }
  }

  async events(args: {
    userId: string
    sessionId: string
    afterSeq?: number | undefined
    limit?: number | undefined
  }): Promise<V2SessionEventsOutput> {
    const session = await this.requireOwnedSession(args)
    const page = await this.plane.readEvents({
      threadId: session.mainThreadId,
      afterSeq: args.afterSeq ?? 0,
      limit: args.limit ?? STATUS_EVENT_LIMIT,
      visible: true,
    })
    return {
      events: page.events.map((event) => event as Record<string, unknown>),
      ...(page.next === undefined ? {} : { next: page.next }),
    }
  }

  async status(args: { userId: string; sessionId: string }): Promise<V2SessionStatusOutput> {
    const session = await this.requireOwnedSession(args)
    const [page, inbox, { lease, live }] = await Promise.all([
      this.plane.readEvents({
        threadId: session.mainThreadId,
        afterSeq: 0,
        limit: STATUS_EVENT_LIMIT,
        visible: true,
      }),
      this.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 1 }),
      this.plane.currentLease({ sessionId: args.sessionId }),
    ])
    const unconsumed = inbox.some((entry: InboxEntry) => entry.consumedSeq === null)
    const current: V2SessionStatus = sessionStatusOf({
      events: page.events,
      live,
      unconsumedInbox: unconsumed,
      now: new Date().toISOString(),
    })
    return {
      state: current.state,
      ...(current.reason === undefined ? {} : { reason: current.reason }),
      ...(current.since === undefined ? {} : { since: current.since }),
      lease: { epoch: lease.epoch, holderId: lease.holderId, live },
    }
  }

  private async requireOwnedSession(args: {
    userId: string
    sessionId: string
  }): Promise<V2SessionRow> {
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined || session.userId !== args.userId) {
      throw new NotFoundException('session not found')
    }
    return session
  }
}
