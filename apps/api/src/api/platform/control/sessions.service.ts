import { randomUUID } from 'node:crypto'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
  ControlPlane,
  fallbackTitleOf,
  pricedView,
  readSessionStatus,
  sessionSummaryOf,
  STATUS_EVENT_LIMIT,
} from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import { INBOX_KIND_RETRY, type SaidUpload } from '@dltech/atlas-core'
import { MediaStore } from '@dltech/atlas-media'
import {
  EWithdrawRefusal,
  INBOX_KIND_MESSAGE,
  inboxMessageSchema,
  type SessionArchiveOutput,
  type SessionBlobOutput,
  type SessionEventsOutput,
  type SessionListOutput,
  type SessionPostMedia,
  type SessionRetryOutput,
  type SessionStatusOutput,
  type SessionViewOutput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SessionTitler } from '../../../_core/ports/session-titler'
import { attachedMedia, imagesForNaming, type AttachedMedia } from './media-attachments'
import { MediaRegistry } from './media-registry'
import { ProjectAccess } from './project-access'
import {
  BLOB_READ_DEFAULT_LENGTH,
  EVENTS_DEFAULT_MAX_BYTES,
  toPageEvent,
} from './session-events-page'
import { attachedUploads } from './upload-attachments'

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name)

  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(ProjectAccess) private readonly projects: ProjectAccess,
    @Inject(SessionTitler) private readonly titler: SessionTitler,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    @Inject(MediaRegistry) private readonly media: MediaRegistry,
    @Inject(MediaStore) private readonly store: MediaStore,
  ) {}

  async accessibleProjectId(args: { userId: string; projectId: string }): Promise<string> {
    const owner = await this.projects.ownerOf({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException('project not found')
    return args.projectId
  }

  async create(args: { userId: string; projectId: string; title?: string | undefined }) {
    await this.accessibleProjectId({
      userId: args.userId,
      projectId: args.projectId,
    })
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
    const sessions = await this.plane.listSessionDigests({
      userId: args.userId,
      projectId: args.projectId,
      limit: args.limit ?? 100,
      withView: true,
    })
    const now = Date.now()
    return {
      sessions: sessions.map((digest) => sessionSummaryOf({ digest, now })),
    }
  }

  async post(args: {
    userId: string
    sessionId: string
    text: string
    media?: readonly SessionPostMedia[] | undefined
    uploads?: readonly SaidUpload[] | undefined
  }) {
    const session = await this.requireOwnedSession(args)
    const media = await attachedMedia({
      registry: this.media,
      userId: args.userId,
      media: args.media ?? [],
    })
    const uploads = await attachedUploads({
      store: this.store,
      userId: args.userId,
      uploads: args.uploads ?? [],
    })
    const payload = JSON.stringify(
      inboxMessageSchema.parse({
        text: args.text,
        ...(media.length === 0 ? {} : { media }),
        ...(uploads.length === 0 ? {} : { uploads }),
      }),
    )
    const { inboxId } = await this.plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload,
    })
    if (session.title === null) {
      this.background.keepAlive(
        this.nameSession({
          userId: args.userId,
          sessionId: args.sessionId,
          projectId: session.projectId,
          text: args.text,
          media,
          inboxId,
        }),
      )
    }
    return { inboxId }
  }

  private async nameSession(args: {
    userId: string
    sessionId: string
    projectId: string
    text: string
    media: readonly AttachedMedia[]
    inboxId: number
  }): Promise<void> {
    try {
      const images = await imagesForNaming({
        store: this.store,
        userId: args.userId,
        media: args.media,
      })
      const generated = await this.titler
        .nameOf({
          userId: args.userId,
          projectId: args.projectId,
          text: args.text,
          ...(images.length === 0 ? {} : { images }),
        })
        .catch((failure: unknown) => {
          this.logger.warn(`naming ${args.sessionId} failed: ${String(failure)}`)
          return null
        })
      const title = generated ?? fallbackTitleOf(args.text)
      if (title === null) return
      await this.plane.titleUntitledSession({
        sessionId: args.sessionId,
        title,
        fromInboxId: args.inboxId,
      })
    } catch (failure) {
      this.logger.warn(`storing the name of ${args.sessionId} failed: ${String(failure)}`)
    }
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

  async archive(args: {
    userId: string
    sessionId: string
    archived: boolean
  }): Promise<SessionArchiveOutput> {
    await this.requireOwnedSession(args)
    const archivedAt = args.archived ? new Date().toISOString() : null
    await this.plane.setSessionArchived({
      sessionId: args.sessionId,
      archivedAt,
    })
    return { archivedAt }
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
    return {
      size: blob.size,
      offset,
      bytes: Buffer.from(blob.bytes).toString('base64'),
    }
  }

  async status(args: { userId: string; sessionId: string }): Promise<SessionStatusOutput> {
    const session = await this.requireOwnedSession(args)
    const { value } = await readSessionStatus({
      plane: this.plane,
      sessionId: args.sessionId,
      threadId: session.mainThreadId,
    })
    return value
  }

  async view(args: { userId: string; sessionId: string }): Promise<SessionViewOutput> {
    const session = await this.requireOwnedSession(args)
    return pricedView(
      await this.plane.readSessionView({
        sessionId: args.sessionId,
        threadId: session.mainThreadId,
      }),
    )
  }

  async retry(args: { userId: string; sessionId: string }): Promise<SessionRetryOutput> {
    await this.requireOwnedSession(args)
    return this.plane.post({ sessionId: args.sessionId, kind: INBOX_KIND_RETRY, payload: '{}' })
  }

  async requireOwnedSession(args: {
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
