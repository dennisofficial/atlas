import { Injectable } from '@nestjs/common'
import {
  SandboxCredentials,
  type ThreadSandboxCredentials,
  type UserSandboxCredentials,
} from '../../../_core/ports/sandbox-credentials'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from '../../platform/sessions/session-of-thread'
import { pinnedProjectOf } from '../../platform/sandboxes/pod-project'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'

@Injectable()
export class ScopedSandboxCredentialsService extends SandboxCredentials {
  constructor(private readonly scoped: ScopedConfigService) {
    super()
  }

  async forThread(args: { threadId: string }): Promise<ThreadSandboxCredentials> {
    const credentials = await this.scoped.vercelCredentials()
    const thread = await db.orm.public.Thread.select('userId').first({ id: args.threadId })
    if (thread === null) return { ...credentials, ownerCredential: true, userId: undefined }
    const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
    const pinned = await pinnedProjectOf({ sessionId })
    return {
      ...credentials,
      projectId: pinned ?? credentials.projectId,
      ownerCredential: true,
      userId: thread.userId,
    }
  }

  async forUser(args: { userId: string }): Promise<UserSandboxCredentials> {
    return { ...(await this.scoped.vercelCredentials()), userId: args.userId }
  }
}
