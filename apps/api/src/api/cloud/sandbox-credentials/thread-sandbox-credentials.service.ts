import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  SandboxCredentials,
  type ThreadSandboxCredentials,
} from '../../../_core/ports/sandbox-credentials'
import { db } from '@dltech/atlas-db'
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
    const thread = await db.orm.public.Thread.select('projectId').first({ id: args.threadId })
    if (thread?.projectId == null) return this.legacyCredentials()
    const credentials = await this.scoped.vercelCredentials({ projectId: thread.projectId })
    return { ...credentials, workspaceOwned: true }
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
    return { token, teamId, projectId, workspaceOwned: false }
  }
}
