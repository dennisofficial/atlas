import { ConflictException, Inject, Injectable } from '@nestjs/common'
import {
  EBootStepState,
  ESandboxProvisionState,
  type SandboxProvisionReply,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import {
  ThreadLauncher,
  type ThreadLaunch,
  type ThreadLaunchReply,
} from '../../../_core/ports/thread-launcher'
import { appendStoredWithin, nextRunId } from '../../platform/sessions/append'
import { podSessionOf, sessionOfThread } from '../../platform/sessions/session-of-thread'
import { toThreadDto } from '../../platform/sessions/rows'
import { threadProjectColumn } from '../../platform/sessions/thread-project'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { ThreadTitlingService } from '../thread-titling/thread-titling.service'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { findFirstMessageThread, lockFirstMessage, userSaidDraftOf } from './first-message'
import {
  DISPATCH_FAILED_MESSAGE,
  dispatchFailedReply,
  notConfiguredReplyOf,
  PodLaunchService,
} from './pod-launch.service'
import { readBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { standingStateOf, type RowClaim } from './sandbox-provisioning-rows'

@Injectable()
export class ThreadLaunchService extends ThreadLauncher {
  constructor(
    private readonly threads: ThreadsService,
    private readonly pod: PodLaunchService,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    private readonly titling: ThreadTitlingService,
  ) {
    super()
  }

  async launch(args: ThreadLaunch): Promise<ThreadLaunchReply> {
    const { userId, draft, firstMessage } = args
    const [project, gap] = await Promise.all([
      threadProjectColumn({ userId, projectId: draft.projectId }),
      this.pod.credentialsOf({ userId }),
    ])

    const { threadId, claim, existing, appended } = await db.transaction(async (tx) => {
      await lockFirstMessage({ tx, userId, sendId: firstMessage.sendId })
      const prior = await findFirstMessageThread({
        reader: tx,
        userId,
        sendId: firstMessage.sendId,
      })
      if (prior !== null) {
        if (draft.id !== undefined && draft.id !== prior.id) {
          throw new ConflictException('sendId already launched a different thread')
        }
        return { threadId: prior.id, claim: null, existing: true }
      }
      if (draft.id !== undefined) {
        const taken = await tx.orm.public.Thread.where({ id: draft.id }).select('id').first()
        if (taken !== null) throw new ConflictException('thread id is already in use')
      }
      const thread = await this.threads.createWithin({ tx, userId, draft, project })
      const { appended } = await appendStoredWithin({
        tx,
        threadId: thread.id,
        userId,
        runId: nextRunId(),
        drafts: [userSaidDraftOf(firstMessage)],
      })
      if (gap !== null) {
        await this.pod.reportGap({ writer: tx, threadId: thread.id, failure: gap })
        return { threadId: thread.id, claim: null, existing: false, appended }
      }
      const claimed: RowClaim | null = await this.pod.claim({ writer: tx, thread, existing: null })
      return { threadId: thread.id, claim: claimed, existing: false, appended }
    })

    const dispatching =
      existing || gap !== null || claim === null
        ? Promise.resolve(true)
        : this.pod.dispatch({ threadId, claim })
    dispatching.catch(() => undefined)
    const [row, session] = await Promise.all([
      db.orm.public.Thread.where({ id: threadId }).all().firstOrThrow(),
      sessionOfThread({ reader: db, threadId }),
    ])
    const thread = toThreadDto({ thread: row, session })
    if (!existing) {
      await this.threads.announceCreated({ userId, threadId, appended })
      this.background.keepAlive(
        this.titling.titleFirstMessage({
          userId,
          threadId,
          projectId: session.projectId,
          text: firstMessage.text,
          images: firstMessage.images,
        }),
      )
    }
    if (existing) return { thread, provision: await this.provisionOf(threadId) }
    if (gap !== null) return { thread, provision: notConfiguredReplyOf(gap) }
    if (!(await dispatching)) return { thread, provision: dispatchFailedReply }
    return { thread, provision: { state: ESandboxProvisionState.Booting } }
  }

  private async provisionOf(threadId: string): Promise<SandboxProvisionReply> {
    const sessionId = await podSessionOf({ reader: db, threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    const standing = row === null ? undefined : standingStateOf(row)
    if (standing !== undefined) return { state: standing }
    const last = (await readBootSteps({ threadId })).at(-1)
    if (last?.state !== EBootStepState.Error) return { state: ESandboxProvisionState.Booting }
    if (last.gap !== undefined) {
      return { state: ESandboxProvisionState.NotConfigured, error: last.error ?? '', gap: last.gap }
    }
    return { ...dispatchFailedReply, error: last.error ?? DISPATCH_FAILED_MESSAGE }
  }
}
