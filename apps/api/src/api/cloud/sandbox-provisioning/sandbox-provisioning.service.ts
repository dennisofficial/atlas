import { ConflictException, Injectable } from '@nestjs/common'
import type { SandboxProvisionReply } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { hasBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { ownedThread } from '../../platform/sessions/ownership'
import { dispatchFailure, PodLaunchService } from './pod-launch.service'
import {
  LOCAL_POD_MESSAGE,
  NOT_RUNNING_MESSAGE,
  standingStateOf,
} from './sandbox-provisioning-rows'

@Injectable()
export class SandboxProvisioningService {
  constructor(private readonly pod: PodLaunchService) {}

  async provision(args: { userId: string; threadId: string }): Promise<SandboxProvisionReply> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const podLease = await db.orm.public.LocalPodLease.where({ threadId: thread.id })
      .select('id')
      .first()
    if (podLease !== null) throw new ConflictException(LOCAL_POD_MESSAGE)
    const existing = await db.orm.public.CloudSandbox.first({ threadId: thread.id })
    const standing = existing === null ? undefined : standingStateOf(existing)
    if (standing !== undefined) return { state: standing }
    if (existing !== null && !(await hasBootSteps({ threadId: thread.id }))) {
      throw new ConflictException(NOT_RUNNING_MESSAGE)
    }

    const { reply, dispatchFailed } = await this.pod.launch({ thread, existing })
    if (dispatchFailed) throw dispatchFailure()
    return reply
  }
}
