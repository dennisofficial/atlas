import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  EThreadMessageState,
  type SaidImageWire,
  type SaidUploadWire,
  type ThreadMessageReply,
} from '@dltech/atlas-wire'
import { db, type Row } from '@dltech/atlas-db'
import { podSessionOf, sessionOfThread } from '../../platform/sessions/session-of-thread'
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ownedThread } from '../../platform/sessions/ownership'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { lockThread, retreatHead } from '../../platform/sessions/thread-head'
import { bumpHistoryRevision } from '../../platform/sessions/history-revision'
import type { StoredAppend } from '../../platform/sessions/append'
import { findUserSaid } from './first-message'
import { DISPATCH_FAILED_MESSAGE, PodLaunchService } from './pod-launch.service'
import {
  appendableOf,
  LOCAL_POD_MESSAGE,
  NOT_RUNNING_MESSAGE,
  relaunchableOf,
  SANDBOX_BUSY_MESSAGE,
  type RowClaim,
} from './sandbox-provisioning-rows'
import { agentStartedIn, appendUserSaid } from './thread-message-queue'

export const TAKE_BACK_TOO_LATE_MESSAGE =
  'The sandbox already picked this message up, so it cannot be taken back.'
export const TAKE_BACK_NOT_FOUND_MESSAGE = 'message not found'

type SendArgs = {
  userId: string
  threadId: string
  sendId: string
  text: string
  images?: readonly SaidImageWire[] | undefined
  uploads?: readonly SaidUploadWire[] | undefined
}

type StagedSend = {
  existing: Row<'CloudSandbox'> | null
  claim: RowClaim | null
  appended?: StoredAppend | undefined
}

@Injectable()
export class ThreadMessagesService {
  constructor(
    private readonly pod: PodLaunchService,
    private readonly signals: ThreadSignalsService,
  ) {}

  async send(args: SendArgs): Promise<ThreadMessageReply> {
    const { userId, threadId } = args
    const thread = await ownedThread({ reader: db, userId, threadId })
    const session = await sessionOfThread({ reader: db, threadId })
    if (session.archivedAt !== null) await this.unarchive({ userId, threadId })

    const gap = await this.pod.credentialsOf({ userId: thread.userId })
    const staged = await this.appendAndClaim({ ...args, thread, claimable: gap === null })
    if (staged.appended !== undefined) {
      await this.signals.eventsAppended({ threadId, ...staged.appended })
    }
    if (gap !== null) {
      await this.pod.reportGap({ threadId, failure: gap })
      await this.signals.podChanged({ threadId })
      return { state: EThreadMessageState.Queued }
    }
    if (staged.claim === null) return { state: EThreadMessageState.Queued }
    const dispatched = await this.pod.dispatchClaimed({ thread, claim: staged.claim })
    if (!dispatched) {
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
    const reset = await db.transaction(async (tx) => {
      const historyRev = await bumpHistoryRevision({ tx, threadId })
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

  private async appendAndClaim(
    args: SendArgs & { thread: Row<'Thread'>; claimable: boolean },
  ): Promise<StagedSend> {
    const { thread, userId, threadId, sendId, text, images, uploads, claimable } = args
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
      const alreadyAppended = (await findUserSaid({ reader: tx, threadId, sendId })) !== null
      if (!alreadyAppended && !appendableOf(existing)) {
        throw new ConflictException(SANDBOX_BUSY_MESSAGE)
      }
      const appended = alreadyAppended
        ? undefined
        : await appendUserSaid({ tx, threadId, userId, sendId, text, images, uploads })
      const claim =
        relaunch && claimable ? await this.pod.claim({ writer: tx, thread, existing }) : null
      return {
        existing,
        claim,
        ...(appended === undefined ? {} : { appended: appended.appended }),
      }
    })
  }
}
