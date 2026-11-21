import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import type { CommandRegistry } from '@dltech/atlas-commands'
import { resize } from '@dltech/atlas-native-commands'
import {
  ControlPlane,
  emptyDigestTimings,
  pricedView,
  readSessionStatus,
  sessionSummaryOf,
  STATUS_EVENT_LIMIT,
} from '@dltech/atlas-control'
import type { ControlSessionRow } from '@dltech/atlas-control'
import {
  EMessageOrigin,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  type Attachment,
  type SaidUpload,
} from '@dltech/atlas-core'
import { MediaStore } from '@dltech/atlas-media'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import {
  DEFAULT_SANDBOX_PROVIDER,
  ECredentialSource,
  ESandboxProvider,
  EWithdrawRefusal,
  INBOX_KIND_MESSAGE,
  inboxMessageSchema,
  type SessionArchiveOutput,
  type SessionBlobOutput,
  type SessionCommandInput,
  type SessionCommandOutput,
  type SessionEventsOutput,
  type SessionListOutput,
  type SessionMarkReadOutput,
  type SessionMessageDraft,
  type SessionPostMedia,
  type SessionRetryOutput,
  type SessionStatusOutput,
  type SessionStopOutput,
  type SessionViewOutput,
  type SessionWakeOutput,
  type SessionHoldPodOutput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'
import type { SessionPageOutput } from '@dltech/atlas-wire'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SessionTitler } from '../../../_core/ports/session-titler'
import {
  POD_OPS,
  PRODUCT_ANALYTICS,
  digestTimingProperties,
  sandboxComputeFor,
  type PodOps,
} from '../../../agent'
import { sandboxLiveCpuMs } from '../../../agent/sandbox/sandbox-live-cpu'
import { PodSizingService, type PodSizing } from './pod-sizing.service'
import { pageSessions, type PageBucket } from '../sessions/session-pages'
import { COMMAND_REGISTRY, postCommand } from './command-registry'
import { modelSet, modelSetArgs, modelSetHandlers } from './model-set'
import { MediaRegistry } from './media-registry'
import { ProjectAccess } from './project-access'
import { nameSession } from './session-naming'
import {
  BLOB_READ_DEFAULT_LENGTH,
  EVENTS_DEFAULT_MAX_BYTES,
  toPageEvent,
} from './session-events-page'
import { postedAttachmentsOf } from './post-attachments'

type MessageDraftInput = {
  text: string
  clientId?: string | undefined
  media?: readonly SessionPostMedia[] | undefined
  uploads?: readonly SaidUpload[] | undefined
  attachments?: readonly Attachment[] | undefined
}

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
    @Inject(COMMAND_REGISTRY) private readonly commands: CommandRegistry,
    @Inject(PodSizingService) private readonly podSizing: PodSizing,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
    @Optional()
    @Inject(PRODUCT_ANALYTICS)
    private readonly analytics: ProductAnalytics | null = null,
  ) {}

  async accessibleProjectId(args: { userId: string; projectId: string }): Promise<string> {
    const owner = await this.projects.ownerOf({ projectId: args.projectId })
    if (owner !== args.userId) throw new NotFoundException('project not found')
    return args.projectId
  }

  async create(args: {
    userId: string
    projectId?: string | null | undefined
    title?: string | undefined
    model?: string | undefined
    effort?: string | undefined
    fast?: boolean | undefined
    provider?: string | undefined
    firstMessage?: SessionMessageDraft | undefined
  }) {
    if (args.projectId !== null && args.projectId !== undefined) {
      await this.accessibleProjectId({
        userId: args.userId,
        projectId: args.projectId,
      })
    }
    const sessionId = randomUUID()
    const mainThreadId = randomUUID()
    const sandboxProvider = this.sandboxProviderOf(args.provider)
    const session = {
      sessionId,
      userId: args.userId,
      projectId: args.projectId ?? null,
      title: args.title,
      mainThreadId,
      model: { ref: args.model, effort: args.effort, fast: args.fast },
      sandboxProvider,
      credentialSource: ECredentialSource.Platform,
    }
    if (args.firstMessage === undefined) {
      await this.plane.createSession(session)
      this.captureSessionCreated({ sessionId, args, provider: sandboxProvider })
      return { sessionId, mainThreadId }
    }
    const message = await this.messageOf({ userId: args.userId, draft: args.firstMessage })
    const { inboxId, modelRef } = await this.plane.createSessionWithMessage({
      ...session,
      message: { kind: INBOX_KIND_MESSAGE, payload: message.payload },
    })
    this.captureSessionCreated({ sessionId, args, provider: sandboxProvider })
    this.nameIfUntitled({
      userId: args.userId,
      sessionId,
      projectId: args.projectId ?? null,
      title: args.title,
      text: args.firstMessage.text,
      attachments: message.attachments,
      inboxId,
      modelRef,
    })
    return { sessionId, mainThreadId }
  }

  private captureSessionCreated(args: {
    sessionId: string
    provider: ESandboxProvider
    args: {
      userId: string
      projectId?: string | null | undefined
      model?: string | undefined
      firstMessage?: SessionMessageDraft | undefined
    }
  }): void {
    this.analytics?.capture({
      userId: args.args.userId,
      event: 'session_created',
      properties: {
        session_id: args.sessionId,
        project_id: args.args.projectId ?? null,
        model: args.args.model ?? null,
        provider: args.provider,
        has_first_message: args.args.firstMessage !== undefined,
        spawned: false,
      },
    })
  }

  private sandboxProviderOf(provider: string | undefined): ESandboxProvider {
    const picked = provider ?? DEFAULT_SANDBOX_PROVIDER
    const known = Object.values(ESandboxProvider).find((value) => value === picked)
    if (known === undefined) throw new BadRequestException(`unknown sandbox provider ${picked}`)
    return known
  }

  async list(args: {
    userId: string
    projectId?: string | undefined
    limit?: number | undefined
  }): Promise<SessionListOutput> {
    const startedAt = performance.now()
    const timings = emptyDigestTimings()
    const sessions = await this.plane.listSessionDigests({
      userId: args.userId,
      projectId: args.projectId,
      limit: args.limit ?? 100,
      withView: true,
      timings,
    })
    const durationMs = Math.round(performance.now() - startedAt)
    this.logger.log({
      source: 'sessions.list',
      rows: sessions.length,
      durationMs,
      ...timings,
    })
    this.analytics?.capture({
      userId: args.userId,
      event: 'sessions_list_timed',
      properties: {
        source: 'trpc',
        rows: sessions.length,
        duration_ms: durationMs,
        ...digestTimingProperties(timings),
      },
    })
    const now = Date.now()
    return {
      sessions: sessions.map((digest) => sessionSummaryOf({ digest, now })),
    }
  }

  async page(args: {
    userId: string
    bucket: PageBucket
    cursor?: string | undefined
    limit?: number | undefined
    search?: string | undefined
  }): Promise<SessionPageOutput> {
    return pageSessions(args)
  }

  async post(args: {
    userId: string
    sessionId: string
    text: string
    media?: readonly SessionPostMedia[] | undefined
    uploads?: readonly SaidUpload[] | undefined
    attachments?: readonly Attachment[] | undefined
  }) {
    const session = await this.requireOwnedSession(args)
    const message = await this.messageOf({ userId: args.userId, draft: args })
    const { inboxId } = await this.plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: message.payload,
    })
    this.nameIfUntitled({
      userId: args.userId,
      sessionId: args.sessionId,
      projectId: session.projectId,
      title: session.title,
      text: args.text,
      attachments: message.attachments,
      inboxId,
      modelRef: session.modelRef,
    })
    return { inboxId }
  }

  private async messageOf(args: {
    userId: string
    draft: MessageDraftInput
  }): Promise<{ payload: string; attachments: readonly Attachment[] }> {
    const attachments = await postedAttachmentsOf({
      registry: this.media,
      store: this.store,
      userId: args.userId,
      media: args.draft.media,
      uploads: args.draft.uploads,
      attachments: args.draft.attachments,
    })
    return {
      payload: JSON.stringify(
        inboxMessageSchema.parse({
          text: args.draft.text,
          via: EMessageOrigin.Operator,
          ...(args.draft.clientId === undefined ? {} : { clientId: args.draft.clientId }),
          ...(attachments.length === 0 ? {} : { attachments }),
        }),
      ),
      attachments,
    }
  }

  private nameIfUntitled(args: {
    userId: string
    sessionId: string
    projectId: string | null
    title: string | null | undefined
    text: string
    attachments: readonly Attachment[]
    inboxId: number
    modelRef: string | null
  }): void {
    if (args.title !== null && args.title !== undefined) return
    this.background.keepAlive(
      nameSession({
        store: this.store,
        titler: this.titler,
        plane: this.plane,
        logger: this.logger,
        userId: args.userId,
        sessionId: args.sessionId,
        projectId: args.projectId,
        text: args.text,
        attachments: args.attachments,
        inboxId: args.inboxId,
        modelRef: args.modelRef,
      }),
    )
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
    await this.plane.withdraw({ sessionId: args.sessionId, inboxId: args.inboxId })
    return { ok: true }
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
    this.analytics?.capture({
      userId: args.userId,
      event: args.archived ? 'session_archived' : 'session_unarchived',
      properties: { session_id: args.sessionId },
    })
    return { archivedAt }
  }

  async markRead(args: {
    userId: string
    sessionId: string
    seq: number
  }): Promise<SessionMarkReadOutput> {
    await this.requireOwnedSession(args)
    const readSeq = await this.plane.markSessionRead({ sessionId: args.sessionId, seq: args.seq })
    return { readSeq }
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
    const [view, cumulativeCpuMs] = await Promise.all([
      this.plane.readSessionView({
        sessionId: args.sessionId,
        threadId: session.mainThreadId,
      }),
      sandboxLiveCpuMs({ sessionId: args.sessionId }),
    ])
    return pricedView({
      ...view,
      compute: await sandboxComputeFor({
        sessionId: args.sessionId,
        ...(cumulativeCpuMs === undefined ? {} : { cumulativeCpuMs }),
      }),
    })
  }

  async retry(args: { userId: string; sessionId: string }): Promise<SessionRetryOutput> {
    await this.requireOwnedSession(args)
    return this.plane.post({ sessionId: args.sessionId, kind: INBOX_KIND_RETRY, payload: '{}' })
  }

  async stop(args: { userId: string; sessionId: string }): Promise<SessionStopOutput> {
    await this.requireOwnedSession(args)
    return this.plane.post({ sessionId: args.sessionId, kind: INBOX_KIND_STOP, payload: '{}' })
  }

  async wake(args: { userId: string; sessionId: string }): Promise<SessionWakeOutput> {
    await this.requireOwnedSession(args)
    const { lease, live } = await this.plane.currentLease({ sessionId: args.sessionId })
    if (lease.holderHostId !== null && live) return { state: 'elsewhere' }
    await this.plane.revoke({ sessionId: args.sessionId, wantsHolder: true })
    return { state: 'waking' }
  }

  async holdPod(args: { userId: string; sessionId: string }): Promise<SessionHoldPodOutput> {
    await this.requireOwnedSession(args)
    if (this.ops === null) return { held: false }
    return { held: this.ops.hold({ sessionId: args.sessionId }) }
  }

  async command(args: { userId: string } & SessionCommandInput): Promise<SessionCommandOutput> {
    const session = await this.requireOwnedSession(args)
    const output = await postCommand({
      plane: this.plane,
      registry: this.commands,
      controlHandlers: new Map([
        ...modelSetHandlers({ plane: this.plane, session }),
        [resize.spec.name, this.podSizing.resizeHandler({ userId: args.userId, session })],
      ]),
      ...args,
    })
    if (args.name === modelSet.spec.name) this.captureModelChanged(args)
    return output
  }

  private captureModelChanged(args: {
    userId: string
    sessionId: string
    name: string
    args: unknown
  }): void {
    const parsed = modelSetArgs.safeParse(args.args)
    if (!parsed.success) return
    this.analytics?.capture({
      userId: args.userId,
      event: 'model_changed',
      properties: {
        session_id: args.sessionId,
        model: parsed.data.model,
        effort: parsed.data.effort ?? null,
        fast: parsed.data.fast ?? null,
      },
    })
  }

  async requireOwnedSession(args: {
    userId: string
    sessionId: string
  }): Promise<ControlSessionRow> {
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined || session.userId !== args.userId || session.deletedAt !== null) {
      throw new NotFoundException('session not found')
    }
    return session
  }
}
