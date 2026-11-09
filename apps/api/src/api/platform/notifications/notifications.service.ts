import { Inject, Injectable, Logger } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { DISMISS_THREAD_DATA_KEY, EPushPlatform } from '@dltech/atlas-wire'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { PresenceService } from '../presence/presence.service'
import { PushLedger } from './push-ledger'
import { pushSendTaskContract } from './push-send.contract'

const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export type TurnEndedOutcome = 'completed' | 'failed'

export const turnEndedBody = (outcome: TurnEndedOutcome): string =>
  outcome === 'completed' ? 'Finished' : 'Failed — open Atlas to see why'

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(
    @Inject(JobDispatcher) private readonly dispatcher: JobDispatcher,
    private readonly presence: PresenceService,
    private readonly ledger: PushLedger,
  ) {}

  async notifyUser(args: {
    userId: string
    title: string
    body: string
    data?: Record<string, string>
    collapseId?: string
    groupId?: string
    idempotencyKey: string
  }): Promise<void> {
    const devices = await db.orm.public.PushDevice.where({ userId: args.userId })
      .select('token')
      .all()
    if (devices.length === 0) return
    try {
      await this.dispatcher.dispatch({
        task: pushSendTaskContract,
        payload: {
          messages: devices.map((device) => ({
            to: device.token,
            title: args.title,
            body: args.body,
            ...(args.data === undefined ? {} : { data: args.data }),
            ...(args.collapseId === undefined ? {} : { collapseId: args.collapseId }),
            ...(args.groupId === undefined ? {} : { threadId: args.groupId }),
          })),
        },
        idempotencyKey: args.idempotencyKey,
      })
    } catch (failure) {
      this.logger.warn(
        `dispatching push-send for user ${args.userId} failed: ${failureText(failure)}`,
      )
    }
  }

  async notifyTurnEnded(args: {
    threadId: string
    outcome: TurnEndedOutcome
    activityAt: string
  }): Promise<void> {
    const thread = await db.orm.public.Thread.where({ id: args.threadId })
      .select('userId', 'sessionId')
      .first()
    if (thread === null) return
    const session = await db.orm.public.Session.where({ id: thread.sessionId })
      .select('mainThreadId', 'title')
      .first()
    if (session === null || session.mainThreadId !== args.threadId) return
    if (await this.presence.isWatching({ userId: thread.userId, threadId: args.threadId })) return
    await this.ledger.noteSent({ userId: thread.userId, threadId: args.threadId })
    await this.notifyUser({
      userId: thread.userId,
      title: session.title ?? 'Atlas',
      body: turnEndedBody(args.outcome),
      data: { threadId: args.threadId, sessionId: thread.sessionId },
      collapseId: args.threadId,
      groupId: thread.sessionId,
      idempotencyKey: `turn-ended:${args.threadId}:${args.activityAt}`,
    })
  }

  async dismissThread(args: { userId: string; threadId: string }): Promise<void> {
    const sentAt = await this.ledger.takeSent(args)
    if (sentAt === undefined) return
    const devices = await db.orm.public.PushDevice.where({
      userId: args.userId,
      platform: EPushPlatform.Ios,
    })
      .select('token')
      .all()
    if (devices.length === 0) return
    try {
      await this.dispatcher.dispatch({
        task: pushSendTaskContract,
        payload: {
          messages: devices.map((device) => ({
            to: device.token,
            contentAvailable: true as const,
            priority: 'normal' as const,
            data: { [DISMISS_THREAD_DATA_KEY]: args.threadId },
          })),
        },
        idempotencyKey: `push-dismiss:${args.threadId}:${sentAt}`,
      })
    } catch (failure) {
      this.logger.warn(
        `dispatching a push dismissal for user ${args.userId} failed: ${failureText(failure)}`,
      )
    }
  }
}
