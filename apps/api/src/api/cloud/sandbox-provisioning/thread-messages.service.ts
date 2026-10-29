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
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
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
import { SERVE_SEND, type ServeSend } from './serve-send'
import { agentStartedIn, appendUserSaid, servesLiveIn } from './thread-message-queue'

export const DELIVERY_FAILED_MESSAGE = "Couldn't hand the message to the sandbox. Try again."
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
    if (thread.archivedAt !== null) await this.unarchive({ userId, threadId })

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
      await this.serve({ ...endpoint, threadId, sendId, text, images }).catch(
        (failure: unknown) => {
          this.logger.warn(
            `delivering a message to thread ${threadId} failed: ${failureText(failure)}`,
          )
          throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
        },
      )
      return { state: EThreadMessageState.Delivered }
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

  private async unarchive(args: { userId: string; threadId: string }): Promise<void> {
    await db.orm.public.Thread.where({ id: args.threadId }).update({ archivedAt: null })
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
      const existing = await tx.orm.public.CloudSandbox.first({ threadId })
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
