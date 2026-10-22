import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  EBootStep,
  EBootStepState,
  EThreadMessageState,
  type RecordedBootStep,
  type ThreadMessageReply,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { latestAttemptOf, readBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { appendWithin, nextRunId } from '../../platform/sessions/append'
import { ownedThread } from '../../platform/sessions/ownership'
import { lockThread, retreatHead } from '../../platform/sessions/thread-head'
import { failureText } from '../github/github-sandbox-wake-boot'
import { findUserSaid, userSaidDraftOf } from './first-message'
import { PodLaunchService } from './pod-launch.service'
import { standingStateOf } from './sandbox-provisioning-rows'
import { SERVE_SEND, type ServeSend } from './serve-send'

const agentStarted = (step: RecordedBootStep): boolean =>
  step.step === EBootStep.Agent &&
  (step.state === EBootStepState.Running || step.state === EBootStepState.Done)

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
  ) {}

  async send(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
  }): Promise<ThreadMessageReply> {
    const { userId, threadId, sendId, text } = args
    const thread = await ownedThread({ reader: db, userId, threadId })

    const endpoint = await this.endpoints.runningEndpoint({ userId, threadId })
    if (endpoint !== null) {
      await this.serve({ ...endpoint, threadId, sendId, text }).catch((failure: unknown) => {
        this.logger.warn(
          `delivering a message to thread ${threadId} failed: ${failureText(failure)}`,
        )
        throw new BadGatewayException(DELIVERY_FAILED_MESSAGE)
      })
      return { state: EThreadMessageState.Delivered }
    }

    await this.appendOnce({ userId, threadId, sendId, text })
    const existing = await db.orm.public.CloudSandbox.first({ threadId })
    const standing = existing === null ? undefined : standingStateOf(existing)
    if (standing === undefined) await this.pod.launch({ thread, existing })
    return { state: EThreadMessageState.Queued }
  }

  async takeBack(args: { userId: string; threadId: string; sendId: string }): Promise<void> {
    const { userId, threadId, sendId } = args
    await ownedThread({ reader: db, userId, threadId })
    if ((await this.endpoints.runningEndpoint({ userId, threadId })) !== null) {
      throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
    }
    await db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      const event = await findUserSaid({ reader: tx, threadId, sendId })
      if (event === null) throw new NotFoundException(TAKE_BACK_NOT_FOUND_MESSAGE)
      const thread = await tx.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
      if (event.seq !== thread.head) throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
      const attempt = latestAttemptOf(await readBootSteps({ reader: tx, threadId }))
      if (attempt.some(agentStarted)) throw new ConflictException(TAKE_BACK_TOO_LATE_MESSAGE)
      await tx.orm.public.Event.where({ id: event.id }).delete()
      await retreatHead({ tx, threadId, at: new Date() })
    })
  }

  private appendOnce(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
  }): Promise<void> {
    const { userId, threadId, sendId, text } = args
    return db.transaction(async (tx) => {
      await lockThread({ tx, threadId })
      if ((await findUserSaid({ reader: tx, threadId, sendId })) !== null) return
      await appendWithin({
        tx,
        threadId,
        userId,
        runId: nextRunId(),
        drafts: [userSaidDraftOf({ sendId, text })],
      })
    })
  }
}
