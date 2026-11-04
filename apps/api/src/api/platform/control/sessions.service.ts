import { randomUUID } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import {
  blobValueOf,
  isBlobRef,
  sessionStatusOf,
  type InboxEntry,
  type V2Event,
  type SessionStatus,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import type {
  SessionEventsOutput,
  SessionListOutput,
  SessionStatusOutput,
} from '@dltech/atlas-protocol'
import { ProjectAccess } from './project-access'
import { WakePublisher } from './wake.publisher'

export type LeaseView = { epoch: number; holderId: string | null; live: boolean }

const STATUS_EVENT_LIMIT = 1000

const toSummary = (row: ControlSessionRow) => ({
  sessionId: row.sessionId,
  projectId: row.projectId,
  title: row.title,
  mainThreadId: row.mainThreadId,
  createdAt: row.createdAt,
})

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name)

  constructor(
    private readonly plane: ControlPlane,
    private readonly wakes: WakePublisher,
    private readonly projects: ProjectAccess,
  ) {}

  async accessibleProjectId(args: { userId: string; projectId: string }): Promise<string> {
    const owner = await this.projects.ownerOf({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException('project not found')
    return args.projectId
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
  }): Promise<SessionListOutput> {
    const sessions = await this.plane.listSessions({
      userId: args.userId,
      projectId: args.projectId,
      limit: args.limit ?? 100,
    })
    return { sessions: sessions.map(toSummary) }
  }

  async post(args: { userId: string; sessionId: string; text: string }) {
    await this.requireOwnedSession(args)
    const payload = JSON.stringify(inboxMessageSchema.parse({ text: args.text }))
    const { inboxId } = await this.plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload,
    })
    try {
      await this.wakes.publish({ sessionId: args.sessionId })
    } catch (failure) {
      this.logger.warn(`publishing the wake for ${args.sessionId} failed: ${String(failure)}`)
    }
    return { inboxId }
  }

  async events(args: {
    userId: string
    sessionId: string
    afterSeq?: number | undefined
    limit?: number | undefined
  }): Promise<SessionEventsOutput> {
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

  async status(args: { userId: string; sessionId: string }): Promise<SessionStatusOutput> {
    const session = await this.requireOwnedSession(args)
    const head = await this.plane.head({ threadId: session.mainThreadId })
    const [page, inbox, { lease, live }] = await Promise.all([
      this.plane.readEvents({
        threadId: session.mainThreadId,
        afterSeq: Math.max(0, head.seq - STATUS_EVENT_LIMIT),
        limit: STATUS_EVENT_LIMIT,
        visible: true,
      }),
      this.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 1 }),
      this.plane.currentLease({ sessionId: args.sessionId }),
    ])
    const unconsumed = inbox.some((entry: InboxEntry) => entry.consumedSeq === null)
    const current: SessionStatus = sessionStatusOf({
      events: await this.resolveFactRefs(page.events),
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

  private async resolveFactRefs(events: readonly V2Event[]): Promise<V2Event[]> {
    return Promise.all(
      events.map(async (event) => {
        if (event.type !== 'fact-recorded' || !isBlobRef(event.value)) return event
        const blob = await this.plane.readBlob({ hash: event.value.$blob.hash })
        if (blob === undefined) return event
        return { ...event, value: blobValueOf(blob.bytes) }
      }),
    )
  }

  private async requireOwnedSession(args: {
    userId: string
    sessionId: string
  }): Promise<ControlSessionRow> {
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined || session.userId !== args.userId) {
      throw new NotFoundException('session not found')
    }
    return session
  }
}
