import { Injectable } from '@nestjs/common'
import type { SandboxProvisionReply } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { ownedThread } from '../../platform/sessions/ownership'
import { dispatchFailure, PodLaunchService } from './pod-launch.service'
import { standingStateOf } from './sandbox-provisioning-rows'

@Injectable()
export class SandboxProvisioningService {
  constructor(private readonly pod: PodLaunchService) {}

  async provision(args: { userId: string; threadId: string }): Promise<SandboxProvisionReply> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const existing = await db.orm.public.CloudSandbox.first({ threadId: thread.id })
    const standing = existing === null ? undefined : standingStateOf(existing)
    if (standing !== undefined) return { state: standing }

    const { reply, dispatchFailed } = await this.pod.launch({ thread, existing })
    if (dispatchFailed) throw dispatchFailure()
    return reply
  }
}
