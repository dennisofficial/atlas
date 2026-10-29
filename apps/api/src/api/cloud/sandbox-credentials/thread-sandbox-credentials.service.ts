import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  SandboxCredentials,
  type ThreadSandboxCredentials,
} from '../../../_core/ports/sandbox-credentials'
import { db } from '@dltech/atlas-db'
import { podSessionOf } from '../../platform/sessions/session-of-thread'
import { ScopedConfigService } from '../scoped-config/scoped-config.service'

@Injectable()
export class ThreadSandboxCredentialsService extends SandboxCredentials {
  constructor(
    private readonly scoped: ScopedConfigService,
    private readonly env: EnvService,
  ) {
    super()
  }

  async forThread(args: { threadId: string }): Promise<ThreadSandboxCredentials> {
    const thread = await db.orm.public.Thread.select('userId', 'sessionId').first({
      id: args.threadId,
    })
    if (thread === null) return this.legacyCredentials()
    const session = await db.orm.public.Session.select('projectId').first({ id: thread.sessionId })
    if (session?.projectId == null && !(await this.apiProvisioned(args.threadId))) {
      return this.legacyCredentials()
    }
    const credentials = await this.scoped.vercelCredentials({ thread: { userId: thread.userId } })
    return { ...credentials, ownerCredential: true, userId: thread.userId }
  }

  private async apiProvisioned(threadId: string): Promise<boolean> {
    const sessionId = await podSessionOf({ reader: db, threadId })
    const step = await db.orm.public.SandboxBootStep.where({ sessionId }).select('id').first()
    return step !== null
  }

  private legacyCredentials(): ThreadSandboxCredentials {
    const token = this.env.get('VERCEL_TOKEN')
    const teamId = this.env.get('VERCEL_TEAM_ID')
    const projectId = this.env.get('VERCEL_PROJECT_ID')
    if (token === undefined || teamId === undefined || projectId === undefined) {
      throw new ServiceUnavailableException(
        'Atlas Cloud sandboxes are not configured on this deployment',
      )
    }
    return { token, teamId, projectId, ownerCredential: false, userId: undefined }
  }
}
