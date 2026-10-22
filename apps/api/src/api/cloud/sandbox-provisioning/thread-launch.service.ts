import { Injectable } from '@nestjs/common'
import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import {
  ThreadLauncher,
  type ThreadLaunch,
  type ThreadLaunchReply,
} from '../../../_core/ports/thread-launcher'
import { appendWithin, nextRunId } from '../../platform/sessions/append'
import { toThreadDto } from '../../platform/sessions/rows'
import { threadProjectColumn } from '../../platform/sessions/thread-project'
import { ThreadsService } from '../../platform/sessions/threads.service'
import { userSaidDraftOf } from './first-message'
import { notConfiguredReplyOf, PodLaunchService } from './pod-launch.service'
import type { RowClaim } from './sandbox-provisioning-rows'

@Injectable()
export class ThreadLaunchService extends ThreadLauncher {
  constructor(
    private readonly threads: ThreadsService,
    private readonly pod: PodLaunchService,
  ) {
    super()
  }

  async launch(args: ThreadLaunch): Promise<ThreadLaunchReply> {
    const { userId, draft, firstMessage } = args
    const project = await threadProjectColumn({ userId, projectId: draft.projectId })
    const gap = await this.pod.credentialsOf({
      userId,
      organizationId: project.organizationId ?? null,
    })

    const { threadId, claim } = await db.transaction(async (tx) => {
      const thread = await this.threads.createWithin({ tx, userId, draft, project })
      await appendWithin({
        tx,
        threadId: thread.id,
        userId,
        runId: nextRunId(),
        drafts: [userSaidDraftOf(firstMessage)],
      })
      if (gap !== null) {
        await this.pod.reportGap({ writer: tx, threadId: thread.id, failure: gap })
        return { threadId: thread.id, claim: null }
      }
      const claimed: RowClaim | null = await this.pod.claim({ writer: tx, thread, existing: null })
      return { threadId: thread.id, claim: claimed }
    })

    const row = await db.orm.public.Thread.where({ id: threadId }).all().firstOrThrow()
    const thread = toThreadDto(row)
    if (gap !== null) return { thread, provision: notConfiguredReplyOf(gap) }
    if (claim !== null) await this.pod.dispatch({ threadId, claim })
    return { thread, provision: { state: ESandboxProvisionState.Booting } }
  }
}
