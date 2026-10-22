import { BadGatewayException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common'
import {
  ESandboxProvisionState,
  EThreadMessageState,
  threadMessageRequestSchema,
  type ThreadMessageReply,
  type ThreadMessageRequest,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { SandboxEndpointService } from '../../platform/sandboxes/sandbox-endpoint'
import { ownedThread } from '../../platform/sessions/ownership'
import { failureText } from '../github/github-sandbox-wake-boot'
import { standingStateOf } from './sandbox-provisioning-rows'
import { SERVE_SEND, type ServeSend } from './serve-send'

export const NOT_RUNNING_MESSAGE = "The sandbox isn't running. Start it first."
export const SEND_PENDING_MESSAGE = 'A message is already waiting for the sandbox to start.'
export const DELIVERY_FAILED_MESSAGE = "Couldn't hand the message to the sandbox. Try again."

const pendingOf = (row: Row<'CloudSandbox'>): ThreadMessageRequest | undefined => {
  const parsed = threadMessageRequestSchema.safeParse(row.pendingSend)
  return parsed.success ? parsed.data : undefined
}

@Injectable()
export class ThreadMessagesService {
  private readonly logger = new Logger(ThreadMessagesService.name)

  constructor(
    private readonly endpoints: SandboxEndpointService,
    @Inject(SERVE_SEND) private readonly serve: ServeSend,
  ) {}

  async send(args: {
    userId: string
    threadId: string
    sendId: string
    text: string
  }): Promise<ThreadMessageReply> {
    const { userId, threadId, sendId, text } = args
    await ownedThread({ reader: db, userId, threadId })

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

    const row = await db.orm.public.CloudSandbox.first({ threadId })
    if (row === null || standingStateOf(row) !== ESandboxProvisionState.Booting) {
      throw new ConflictException(NOT_RUNNING_MESSAGE)
    }
    const held = pendingOf(row)
    if (held !== undefined && held.sendId !== sendId)
      throw new ConflictException(SEND_PENDING_MESSAGE)
    if (held === undefined) {
      await db.orm.public.CloudSandbox.where({ threadId }).update({ pendingSend: { sendId, text } })
    }
    await this.drain({ threadId })
    return { state: EThreadMessageState.Queued }
  }

  async drain(args: { threadId: string }): Promise<void> {
    const { threadId } = args
    try {
      const row = await db.orm.public.CloudSandbox.first({ threadId })
      const pending = row === null ? undefined : pendingOf(row)
      if (row === null || pending === undefined) return
      const endpoint = await this.endpoints.runningEndpoint({ userId: row.userId, threadId })
      if (endpoint === null) return
      await this.serve({ ...endpoint, threadId, ...pending })
      const clear = db.raw.sql`UPDATE "CloudSandbox"
        SET "pendingSend" = NULL
        WHERE "threadId" = ${threadId} AND "pendingSend"->>'sendId' = ${pending.sendId}`
        .affectedCount()
        .build()
      await db.execute(clear)
    } catch (failure) {
      this.logger.warn(
        `draining the pending message of thread ${threadId} failed: ${failureText(failure)}`,
      )
    }
  }
}
