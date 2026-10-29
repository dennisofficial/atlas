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
import { agentStartedIn, appendUserSaid, servesLiveIn } from './thread-message-queue'

export const DELIVERY_FAILED_MESSAGE = "Couldn't hand the message to the sandbox. Try again."
const OUTDATED_SERVE_PARK_REASON = "the sandbox is restarting to pick up this Atlas's serve"
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
  }): Promise<ThreadMessageReply> {
    const { userId, threadId, sendId, text, images } = args
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
      })
      if (queued !== null) {
        if (queued.head !== undefined) await this.signals.headMoved({ threadId, head: queued.head })
        return { state: EThreadMessageState.Queued }
      }
      const refused = await this.serve({ ...endpoint, threadId, sendId, text, images }).then(
        () => false,
        (failure: unknown) => {
          this.logger.warn(
            `delivering a message to thread ${threadId} failed: ${failureText(failure)}`,
          )
          if (failure instanceof ServeProtocolRefusedError) return true
          throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
        },
      )
      if (!refused) return { state: EThreadMessageState.Delivered }
      return this.relaunchOutdated({ thread, userId, sendId, text, images })
    }

    const { existing, relaunch, head } = await this.appendOnce({
      userId,
      threadId,
      sendId,
      text,
      images,
    })
    if (head !== undefined) await this.signals.headMoved({ threadId, head })
    if (!relaunch) return { state: EThreadMessageState.Queued }
    const { dispatchFailed } = await this.pod.launch({ thread, existing })
    if (dispatchFailed) {
      return { state: EThreadMessageState.Queued, error: DISPATCH_FAILED_MESSAGE }
    }
    return { state: EThreadMessageState.Queued }
  }

  private async relaunchOutdated(args: {
    thread: Row<'Thread'>
    userId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
  }): Promise<ThreadMessageReply> {
    const { thread, userId, sendId, text, images } = args
    const threadId = thread.id
    const sessionId = await podSessionOf({ reader: db, threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null) throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
    await this.sandboxes.park({ row, threadId, reason: OUTDATED_SERVE_PARK_REASON })
    const { head } = await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      return appendUserSaid({ tx, threadId, userId, sendId, text, images })
    })
    if (head !== undefined) await this.signals.headMoved({ threadId, head })
    const { dispatchFailed } = await this.pod.launch({ thread, existing: row })
    if (dispatchFailed) {
      return { state: EThreadMessageState.Queued, error: DISPATCH_FAILED_MESSAGE }
    }
    return { state: EThreadMessageState.Queued }
  }

  private async unarchive(args: { userId: string; threadId: string }): Promise<void> {
    const session = await sessionOfThread({ reader: db, threadId: args.threadId })
    await db.orm.public.Session.where({ id: session.id }).update({ archivedAt: null })
    await this.signals.listChanged(args)
  }

  async takeBack(args: { userId: string; threadId: string; sendId: string }): Promise<void> {
    const { userId, threadId, sendId } = args
    await ownedThread({ reader: db, userId, threadId })
    const endpoint = await this.endpoints.runningEndpoint({ userId, threadId })
    const head = await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
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
      return thread.head - 1
    })
    await this.signals.headMoved({ threadId, head })
  }

  private queueUntilAgentStarts(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
    images?: readonly SaidImageWire[] | undefined
  }): Promise<{ head?: number } | null> {
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
  }): Promise<{ existing: Row<'CloudSandbox'> | null; relaunch: boolean; head?: number }> {
    const { userId, threadId, sendId, text, images } = args
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
        ...(await appendUserSaid({ tx, threadId, userId, sendId, text, images })),
      }
    })
  }
}
