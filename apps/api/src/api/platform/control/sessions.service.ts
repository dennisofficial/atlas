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
import { cancelResize, resize } from '@dltech/atlas-native-commands'
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
  clearMomentSeqOf,
  ESessionStatus,
  ESubscriptionActor,
  ESubscriptionEnd,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  type Attachment,
} from '@dltech/atlas-core'
import { MediaStore } from '@dltech/atlas-media'
import type { ProductAnalytics, TracePort } from '@dltech/atlas-observability'
import {
  DEFAULT_SANDBOX_PROVIDER,
  ECredentialSource,
  ESandboxProvider,
  EWithdrawRefusal,
  INBOX_KIND_MESSAGE,
  type SessionArchiveOutput,
  type SessionBlobOutput,
  type SessionCommandInput,
  type SessionCommandOutput,
  type SessionSubscribeInput,
  type SessionUnsubscribeInput,
  type SessionEventsOutput,
  type SessionListOutput,
  type SessionMarkReadOutput,
  type SessionMessageDraft,
  type SessionRetryOutput,
  type SessionStatusOutput,
  type SessionStopOutput,
  type SessionSubscribeOutput,
  type SessionUnsubscribeOutput,
  type SessionViewOutput,
  type SessionWakeOutput,
  type SessionHoldPodOutput,
  type SessionSleepPodOutput,
  type SessionWithdrawOutput,
} from '@dltech/atlas-protocol'
import { notifyClearIdempotencyKey } from '@dltech/atlas-jobs/notify'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { notifyClearTaskContract } from '../../../_lib/trigger/notify-clear.contract'
import { SessionTitler } from '../../../_core/ports/session-titler'
import {
  POD_OPS,
  PRODUCT_ANALYTICS,
  TRACE_FOR,
  digestTimingProperties,
  sandboxComputeFor,
  sandboxLiveCpuMs,
  type PodOps,
} from '../../../agent'
import { PreviewTeardownService } from '../sandboxes/preview-teardown.service'
import { PodPowerService, type PodPower } from './pod-power.service'
import { PodSizingService, type PodSizing } from './pod-sizing.service'
import { COMMAND_REGISTRY, postCommand } from './command-registry'
import { refuseArchivedCommand, requireLiveSession } from './session-archived'
import { SubscriptionTargetError, resolvedSubscriptionTargetOf } from './subscription-target'
import { modelSet, modelSetArgs, modelSetHandlers } from './model-set'
import { MediaRegistry } from './media-registry'
import { badRequestOnUnknownModelRef } from './unknown-model-ref'
import { ProjectAccess } from './project-access'
import { nameSession } from './session-naming'
import {
  BLOB_READ_DEFAULT_LENGTH,
  EVENTS_DEFAULT_MAX_BYTES,
  toPageEvent,
} from './session-events-page'
import { postMessageOf, type MessageDraftInput } from './post-message'
import { withPromptPostSpan, type PromptPostSpan } from './prompt-post-span'

type PostArgs = MessageDraftInput & {
  userId: string
  sessionId: string
  sentAt?: string | undefined
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
    @Inject(PodPowerService) private readonly podPower: PodPower,
    @Inject(JobsProjectDispatcher) private readonly dispatcher: JobsProjectDispatcher,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
    @Optional()
    @Inject(PRODUCT_ANALYTICS)
    private readonly analytics: ProductAnalytics | null = null,
    @Optional()
    @Inject(TRACE_FOR)
    private readonly traceFor: ((distinctId: string) => TracePort) | null = null,
    @Optional()
    @Inject(PreviewTeardownService)
    private readonly previews: PreviewTeardownService | null = null,
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
      const { modelRef } = await badRequestOnUnknownModelRef(() =>
        this.plane.createSession(session),
      )
      this.captureSessionCreated({ sessionId, modelRef, args, provider: sandboxProvider })
      return { sessionId, mainThreadId }
    }
    const message = await postMessageOf({
      registry: this.media,
      store: this.store,
      userId: args.userId,
      draft: args.firstMessage,
    })
    const { inboxId, modelRef } = await badRequestOnUnknownModelRef(() =>
      this.plane.createSessionWithMessage({
        ...session,
        message: { kind: INBOX_KIND_MESSAGE, payload: message.payload },
      }),
    )
    this.captureSessionCreated({ sessionId, modelRef, args, provider: sandboxProvider })
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
    modelRef: string
    provider: ESandboxProvider
    args: {
      userId: string
      projectId?: string | null | undefined
      firstMessage?: SessionMessageDraft | undefined
    }
  }): void {
    this.analytics?.capture({
      userId: args.args.userId,
      event: 'session_created',
      properties: {
        session_id: args.sessionId,
        project_id: args.args.projectId ?? null,
        model: args.modelRef,
        provider: args.provider,
        has_first_message: args.args.firstMessage !== undefined,
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

  async post(args: PostArgs) {
    return await withPromptPostSpan({
      trace: this.traceFor?.(args.userId),
      sessionId: args.sessionId,
      sentAt: args.sentAt,
      serverNow: Date.now(),
      run: (post) => this.posted({ input: args, post }),
    })
  }

  private async posted(args: { input: PostArgs; post: PromptPostSpan }) {
    const { input, post } = args
    const session = requireLiveSession(await this.requireOwnedSession(input))
    const message = await postMessageOf({
      registry: this.media,
      store: this.store,
      userId: input.userId,
      draft: input,
    })
    const { inboxId } = await this.plane.post({
      sessionId: input.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: message.payload,
    })
    post.delivered({ inboxId, hasMedia: message.attachments.length > 0 })
    this.nameIfUntitled({
      userId: input.userId,
      sessionId: input.sessionId,
      projectId: session.projectId,
      title: session.title,
      text: input.text,
      attachments: message.attachments,
      inboxId,
      modelRef: session.modelRef,
    })
    return { inboxId }
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
    const session = await this.requireOwnedSession(args)
    const archivedAt = args.archived ? new Date().toISOString() : null
    await this.plane.setSessionArchived({
      sessionId: args.sessionId,
      archivedAt,
    })
    if (args.archived) await this.podPower.parkArchived({ session })
    await this.markPreviewTunnel({ session, archived: args.archived })
    this.analytics?.capture({
      userId: args.userId,
      event: args.archived ? 'session_archived' : 'session_unarchived',
      properties: { session_id: args.sessionId },
    })
    return { archivedAt }
  }

  private async markPreviewTunnel(args: {
    session: ControlSessionRow
    archived: boolean
  }): Promise<void> {
    if (this.previews === null) return
    const podSessionId = args.session.podSessionId ?? args.session.sessionId
    if (args.archived) await this.previews.markDeleting({ podSessionId })
    else await this.previews.clearDeleting({ podSessionId })
  }

  async markRead(args: {
    userId: string
    sessionId: string
    seq: number
  }): Promise<SessionMarkReadOutput> {
    await this.requireOwnedSession(args)
    const notify = await this.notifyStateOf(args)
    const readSeq = await this.plane.markSessionRead({ sessionId: args.sessionId, seq: args.seq })
    const momentSeq = clearMomentSeqOf({
      previousReadSeq: notify.readSeq,
      readSeq,
      lastTurnSeq: notify.lastTurnSeq,
      headSeq: notify.headSeq,
      waiting: notify.waiting,
    })
    if (momentSeq !== null) {
      this.captureNotificationCleared({
        userId: args.userId,
        sessionId: args.sessionId,
        momentSeq,
      })
      this.background.keepAlive(
        this.dispatchClear({ userId: args.userId, sessionId: args.sessionId, momentSeq }),
      )
    }
    return { readSeq }
  }

  private captureNotificationCleared(args: {
    userId: string
    sessionId: string
    momentSeq: number
  }): void {
    try {
      this.analytics?.capture({
        userId: args.userId,
        event: 'notification_cleared',
        properties: { session_id: args.sessionId, moment_seq: args.momentSeq },
      })
    } catch {
      // Metrics must never fault a read.
    }
  }

  private async notifyStateOf(args: { userId: string; sessionId: string }): Promise<{
    readSeq: number | null
    lastTurnSeq: number | null
    headSeq: number
    waiting: boolean
  }> {
    const [digest] = await this.plane.listSessionDigests({
      userId: args.userId,
      sessionId: args.sessionId,
      limit: 1,
      withView: true,
    })
    if (digest === undefined) {
      return { readSeq: null, lastTurnSeq: null, headSeq: 0, waiting: false }
    }
    const status = digest.view?.status.state
    return {
      readSeq: digest.readSeq,
      lastTurnSeq: digest.lastTurn?.seq ?? null,
      headSeq: digest.headSeq,
      waiting:
        status === ESessionStatus.WaitingForOperator ||
        status === ESessionStatus.WaitingForCredentials,
    }
  }

  private async dispatchClear(args: {
    userId: string
    sessionId: string
    momentSeq: number
  }): Promise<void> {
    try {
      await this.dispatcher.dispatch({
        task: notifyClearTaskContract,
        payload: { userId: args.userId, sessionId: args.sessionId },
        idempotencyKey: notifyClearIdempotencyKey(args),
      })
    } catch (failure) {
      this.logger.warn(
        `clearing the notifications of session ${args.sessionId} failed: ${String(failure)}`,
      )
    }
  }

  async events(args: {
    userId: string
    sessionId: string
    threadId?: string | undefined
    afterSeq?: number | undefined
    limit?: number | undefined
    maxBytes?: number | undefined
  }): Promise<SessionEventsOutput> {
    const session = await this.requireOwnedSession(args)
    const threadId = await this.threadOf({ session, threadId: args.threadId })
    const page = await this.plane.readEvents({
      threadId,
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

  private async threadOf(args: {
    session: ControlSessionRow
    threadId: string | undefined
  }): Promise<string> {
    const { session, threadId } = args
    if (threadId === undefined || threadId === session.mainThreadId) return session.mainThreadId
    const thread = await this.plane.readThread({ threadId })
    if (thread === undefined || thread.sessionId !== session.sessionId) {
      throw new NotFoundException('thread not found')
    }
    return threadId
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

  async retry(args: {
    userId: string
    sessionId: string
    agentId?: string | undefined
  }): Promise<SessionRetryOutput> {
    const session = requireLiveSession(await this.requireOwnedSession(args))
    const agentId = await this.agentOf({ session, agentId: args.agentId })
    return this.plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_RETRY,
      payload: agentId === undefined ? '{}' : JSON.stringify({ agentId }),
    })
  }

  private async agentOf(args: {
    session: ControlSessionRow
    agentId: string | undefined
  }): Promise<string | undefined> {
    if (args.agentId === undefined) return undefined
    const thread =
      args.agentId === args.session.mainThreadId
        ? undefined
        : await this.plane.readThread({ threadId: args.agentId })
    if (thread === undefined || thread.sessionId !== args.session.sessionId) {
      throw new NotFoundException('agent not found')
    }
    return args.agentId
  }

  async stop(args: { userId: string; sessionId: string }): Promise<SessionStopOutput> {
    await this.requireOwnedSession(args)
    return this.plane.post({ sessionId: args.sessionId, kind: INBOX_KIND_STOP, payload: '{}' })
  }

  async wake(args: { userId: string; sessionId: string }): Promise<SessionWakeOutput> {
    requireLiveSession(await this.requireOwnedSession(args))
    const { lease, live } = await this.plane.currentLease({ sessionId: args.sessionId })
    if (lease.holderHostId !== null && live) return { state: 'elsewhere' }
    await this.plane.revoke({ sessionId: args.sessionId, wantsHolder: true })
    return { state: 'waking' }
  }

  async sleepPod(args: {
    userId: string
    sessionId: string
    force?: boolean | undefined
  }): Promise<SessionSleepPodOutput> {
    const session = await this.requireOwnedSession(args)
    return this.podPower.sleep({ session, force: args.force === true })
  }

  async wakePod(args: { userId: string; sessionId: string }): Promise<SessionWakeOutput> {
    return this.wake(args)
  }

  async holdPod(args: { userId: string; sessionId: string }): Promise<SessionHoldPodOutput> {
    requireLiveSession(await this.requireOwnedSession(args))
    if (this.ops === null) return { held: false }
    return { held: this.ops.hold({ sessionId: args.sessionId }) }
  }

  async command(args: { userId: string } & SessionCommandInput): Promise<SessionCommandOutput> {
    const session = await this.requireOwnedSession(args)
    refuseArchivedCommand({ session, name: args.name })
    const output = await postCommand({
      plane: this.plane,
      registry: this.commands,
      controlHandlers: new Map([
        ...modelSetHandlers({ plane: this.plane, session }),
        [resize.spec.name, this.podSizing.resizeHandler()],
        [cancelResize.spec.name, this.podSizing.cancelHandler()],
      ]),
      ...args,
    })
    if (args.name === modelSet.spec.name) this.captureModelChanged(args)
    return output
  }

  async subscribe(
    args: { userId: string } & SessionSubscribeInput,
  ): Promise<SessionSubscribeOutput> {
    const session = await this.requireOwnedSession(args)
    const resolved = this.resolvedTargetOf({ provider: args.provider, target: args.target })
    return await this.plane.subscribe({
      sessionId: args.sessionId,
      threadId: session.mainThreadId,
      provider: args.provider,
      target: resolved.target,
      label: resolved.label,
      events: args.events,
      expiresAt: args.expiresAt,
      lease: resolved.lease,
      by: ESubscriptionActor.Operator,
    })
  }

  async unsubscribe(
    args: { userId: string } & SessionUnsubscribeInput,
  ): Promise<SessionUnsubscribeOutput> {
    await this.requireOwnedSession(args)
    return await this.plane.unsubscribe({
      sessionId: args.sessionId,
      subscriptionId: args.subscriptionId,
      by: ESubscriptionActor.Operator,
      reason: ESubscriptionEnd.Unsubscribed,
    })
  }

  private resolvedTargetOf(args: { provider: string; target: string }) {
    try {
      return resolvedSubscriptionTargetOf(args)
    } catch (failure) {
      if (failure instanceof SubscriptionTargetError) {
        throw new BadRequestException(failure.message)
      }
      throw failure
    }
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
