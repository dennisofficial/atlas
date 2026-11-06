import { randomUUID } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ControlPlane, readSessionStatus, STATUS_EVENT_LIMIT } from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import { canonicalEvent, type V2Event } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { EWithdrawRefusal } from '@dltech/atlas-protocol'
import type {
  SessionBlobOutput,
  SessionEventsOutput,
  SessionListOutput,
  SessionStatusOutput,
  SessionWithdrawOutput,
} from '@dltech/atlas-protocol'
import { ProjectAccess } from './project-access'

export type LeaseView = { epoch: number; holderHostId: number | null; live: boolean }

const EVENTS_DEFAULT_MAX_BYTES = 2_000_000
const EVENTS_HARD_CEILING_BYTES = 3_500_000
const BLOB_READ_DEFAULT_LENGTH = 1_000_000

const toSummary = (row: ControlSessionRow) => ({
  sessionId: row.sessionId,
  projectId: row.projectId,
  title: row.title,
  mainThreadId: row.mainThreadId,
  createdAt: row.createdAt,
})

const toPageEvent = (event: V2Event): Record<string, unknown> => {
  const bytes = Buffer.byteLength(canonicalEvent(event), 'utf8')
  if (bytes <= EVENTS_HARD_CEILING_BYTES) return event as Record<string, unknown>
  return { seq: event.seq, type: event.type, oversized: { bytes } }
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name)

  constructor(
    private readonly plane: ControlPlane,
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
    return { inboxId }
  }

  async withdraw(args: {
    userId: string
    sessionId: string
    inboxId: number
  }): Promise<SessionWithdrawOutput> {
    await this.requireOwnedSession(args)
    const entry = await this.plane.readInboxEntry({
      sessionId: args.sessionId,
      inboxId: args.inboxId,
    })
    if (entry === undefined || entry.kind !== INBOX_KIND_MESSAGE) {
      return { ok: false, reason: EWithdrawRefusal.Unknown }
    }
    const result = await this.plane.takeBack({
      sessionId: args.sessionId,
      inboxId: args.inboxId,
    })
    if (result.ok) return { ok: true }
    return {
      ok: false,
      reason:
        result.refusal.kind === 'already-consumed'
          ? EWithdrawRefusal.AlreadyConsumed
          : EWithdrawRefusal.Unknown,
    }
  }

  async events(args: {
    userId: string
    sessionId: string
    afterSeq?: number | undefined
    limit?: number | undefined
    maxBytes?: number | undefined
  }): Promise<SessionEventsOutput> {
    const session = await this.requireOwnedSession(args)
    const page = await this.plane.readEvents({
      threadId: session.mainThreadId,
      afterSeq: args.afterSeq ?? 0,
      limit: args.limit ?? STATUS_EVENT_LIMIT,
      visible: true,
      maxBytes: args.maxBytes ?? EVENTS_DEFAULT_MAX_BYTES,
    })
    return {
      events: page.events.map(toPageEvent),
      ...(page.next === undefined ? {} : { next: page.next }),
    }
  }

  async blob(args: {
    userId: string
    sessionId: string
    hash: string
    offset?: number | undefined
    length?: number | undefined
  }): Promise<SessionBlobOutput> {
    await this.requireOwnedSession(args)
    const referenced = await this.plane.blobReferencedBy({
      sessionId: args.sessionId,
      hash: args.hash,
    })
    if (!referenced) throw new NotFoundException('blob not found')
    const offset = args.offset ?? 0
    const blob = await this.plane.readBlob({
      hash: args.hash,
      offset,
      length: args.length ?? BLOB_READ_DEFAULT_LENGTH,
    })
    if (blob === undefined) throw new NotFoundException('blob not found')
    return { size: blob.size, offset, bytes: Buffer.from(blob.bytes).toString('base64') }
  }

  async status(args: { userId: string; sessionId: string }): Promise<SessionStatusOutput> {
    const session = await this.requireOwnedSession(args)
    const { value } = await readSessionStatus({
      plane: this.plane,
      sessionId: args.sessionId,
      threadId: session.mainThreadId,
      now: new Date().toISOString(),
    })
    return value
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
