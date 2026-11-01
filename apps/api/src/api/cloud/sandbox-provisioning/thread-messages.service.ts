import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  EThreadMessageState,
  type SaidImageWire,
  type SaidUploadWire,
  type ThreadMessageReply,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { podSessionOf, sessionOfThread } from '../../platform/sessions/session-of-thread'
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ownedThread } from '../../platform/sessions/ownership'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { lockThread, retreatHead } from '../../platform/sessions/thread-head'
import { bumpHistoryRevision } from '../../platform/sessions/history-revision'
import { failureText } from '../github/github-sandbox-wake-boot'
import { findUserSaid } from './first-message'
import { DISPATCH_FAILED_MESSAGE, PodLaunchService } from './pod-launch.service'
import {
  appendableOf,
  LOCAL_POD_MESSAGE,
  NOT_RUNNING_MESSAGE,
  relaunchableOf,
  SANDBOX_BUSY_MESSAGE,
} from './sandbox-provisioning-rows'
import { SERVE_SEND, ServeProtocolRefusedError, type ServeSend } from './serve-send'
import {
  agentStartedIn,
  appendUserSaid,
  servesLiveIn,
  type QueuedAppend,
} from './thread-message-queue'

export const DELIVERY_FAILED_MESSAGE = "Couldn't hand the message to the sandbox. Try again."
const OUTDATED_SERVE_PARK_REASON = "the sandbox is restarting to pick up this Atlas's serve"
const STOPPED_SILENTLY_PARK_REASON = 'the sandbox stopped without reporting it'
export const TAKE_BACK_TOO_LATE_MESSAGE =
  'The sandbox already picked this message up, so it cannot be taken back.'
export const TAKE_BACK_NOT_FOUND_MESSAGE = 'message not found'

@Injectable()
export class ThreadMessagesService {
  private readonly logger = new Logger(ThreadMessagesService.name)

  constructor(
    private readonly endpoints: SandboxEndpointService,
    @Inject(SERVE_SEND) private readonly serve: ServeSend,
    private readonly pod: PodLaunchService,
    private readonly signals: ThreadSignalsService,
    private readonly sandboxes: SandboxesService,
  ) {}

  async send(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
    uploads?: readonly SaidUploadWire[] | undefined
  }): Promise<ThreadMessageReply> {
    const { userId, threadId, sendId, text, images, uploads } = args
    const thread = await ownedThread({ reader: db, userId, threadId })
    const session = await sessionOfThread({ reader: db, threadId })
    if (session.archivedAt !== null) await this.unarchive({ userId, threadId })

    const endpoint = await this.endpoints.runningEndpoint({ userId, threadId })
    if (endpoint !== null) {
      const queued = await this.queueUntilAgentStarts({
        userId,
        threadId,
        sendId,
        text,
        images,
        uploads,
      })
      if (queued !== null) {
        if (queued.appended !== undefined) {
          await this.signals.eventsAppended({ threadId, ...queued.appended })
        }
        return { state: EThreadMessageState.Queued }
      }
      const parkReason = await this.deliver({
        ...endpoint,
        threadId,
        sendId,
        text,
        images,
        uploads,
      })
      if (parkReason === null) return { state: EThreadMessageState.Delivered }
      return this.relaunchParked({ thread, userId, sendId, text, images, uploads, parkReason })
    }

    const { existing, relaunch, appended } = await this.appendOnce({
      userId,
      threadId,
      sendId,
      text,
      images,
      uploads,
    })
    if (appended !== undefined) await this.signals.eventsAppended({ threadId, ...appended })
    if (!relaunch) return { state: EThreadMessageState.Queued }
    const { dispatchFailed } = await this.pod.launch({ thread, existing })
    if (dispatchFailed) {
      return { state: EThreadMessageState.Queued, error: DISPATCH_FAILED_MESSAGE }
    }
    return { state: EThreadMessageState.Queued }
  }

  private async deliver(args: Parameters<ServeSend>[0]): Promise<string | null> {
    try {
      await this.serve(args)
      return null
    } catch (failure) {
      this.logger.warn(
        `delivering a message to thread ${args.threadId} failed: ${failureText(failure)}`,
      )
      if (failure instanceof ServeProtocolRefusedError) return OUTDATED_SERVE_PARK_REASON
      if (await this.stoppedBehindServe(args.threadId)) return STOPPED_SILENTLY_PARK_REASON
      throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
    }
  }

  private async stoppedBehindServe(threadId: string): Promise<boolean> {
    try {
      return !(await this.endpoints.observedRunning({ threadId }))
    } catch (failure) {
      this.logger.warn(
        `could not inspect the sandbox of thread ${threadId}: ${failureText(failure)}`,
      )
      return false
    }
  }

  private async relaunchParked(args: {
    parkReason: string
    thread: Row<'Thread'>
    userId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
    uploads?: readonly SaidUploadWire[] | undefined
  }): Promise<ThreadMessageReply> {
    const { thread, userId, sendId, text, images, uploads, parkReason } = args
    const threadId = thread.id
    const sessionId = await podSessionOf({ reader: db, threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null) throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
    await this.sandboxes.park({ row, threadId, reason: parkReason })
    const { appended } = await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      return appendUserSaid({ tx, threadId, userId, sendId, text, images, uploads })
    })
    if (appended !== undefined) await this.signals.eventsAppended({ threadId, ...appended })
    const { dispatchFailed } = await this.pod.launch({ thread, existing: row })
    if (dispatchFailed) {
      return { state: EThreadMessageState.Queued, error: DISPATCH_FAILED_MESSAGE }
    }
    return { state: EThreadMessageState.Queued }
  }

  private async unarchive(args: { userId: string; threadId: string }): Promise<void> {
    const session = await sessionOfThread({ reader: db, threadId: args.threadId })
    await db.orm.public.Session.where({ id: session.id }).update({ archivedAt: null })
    this.signals.threadChanged({ threadId: args.threadId })
  }

  async takeBack(args: { userId: string; threadId: string; sendId: string }): Promise<void> {
    const { userId, threadId, sendId } = args
    await ownedThread({ reader: db, userId, threadId })
    const endpoint = await this.endpoints.runningEndpoint({ userId, threadId })
    const reset = await db.transaction(async (tx) => {
      const historyRev = await bumpHistoryRevision({ tx, threadId })
      if (endpoint !== null && (await servesLiveIn({ tx, threadId }))) {
        throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
      }
      const event = await findUserSaid({ reader: tx, threadId, sendId })
      if (event === null) throw new NotFoundException(TAKE_BACK_NOT_FOUND_MESSAGE)
      const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
      if (event.seq !== thread.head) throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
      if (await agentStartedIn({ tx, threadId })) {
        throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
      }
      await tx.orm.public.Event.where({ id: event.id }).delete()
      await retreatHead({ tx, threadId, at: new Date() })
      return { head: thread.head - 1, historyRev }
    })
    await this.signals.eventsReset({ threadId, ...reset })
  }

  private queueUntilAgentStarts(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
    uploads?: readonly SaidUploadWire[] | undefined
  }): Promise<QueuedAppend | null> {
    return db.transaction(async (tx) => {
      await lockThread({ tx, threadId: args.threadId })
      if (await servesLiveIn({ tx, threadId: args.threadId })) return null
      return appendUserSaid({ tx, ...args })
    })
  }

  private appendOnce(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
    uploads?: readonly SaidUploadWire[] | undefined
  }): Promise<{ existing: Row<'CloudSandbox'> | null; relaunch: boolean } & QueuedAppend> {
    const { userId, threadId, sendId, text, images, uploads } = args
    return db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      const podLease = await tx.orm.public.LocalPodLease.where({ threadId }).select('id').first()
      if (podLease !== null) throw new ConflictException(LOCAL_POD_MESSAGE)
      const sessionId = await podSessionOf({ reader: tx, threadId })
      const existing = await tx.orm.public.CloudSandbox.first({ sessionId })
      if (existing !== null && !(await hasBootSteps({ reader: tx, threadId }))) {
        throw new ConflictException(NOT_RUNNING_MESSAGE)
      }
      const relaunch = relaunchableOf(existing)
      const delivered = (await findUserSaid({ reader: tx, threadId, sendId })) !== null
      if (delivered) return { existing, relaunch }
      if (!appendableOf(existing)) throw new ConflictException(SANDBOX_BUSY_MESSAGE)
      return {
        existing,
        relaunch,
        ...(await appendUserSaid({ tx, threadId, userId, sendId, text, images, uploads })),
      }
    })
  }
}
