import type { ResolvedSandboxConfig, VercelProvisioningCredentials } from '@dltech/atlas-wire/web'
import { EMPTY_SCOPE_LAYER, podFacingConfig, resolveScopedConfig } from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { loadProjectLayer, loadUserLayer } from './scoped-config.layers'

export const NOT_CONFIGURED_MESSAGE = 'Atlas Cloud sandboxes are not configured on this deployment'

export type ScopedConfigTarget = { userId: string; projectId: string | null }

@Injectable()
export class ScopedConfigService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly env: EnvService,
  ) {}

  async resolveForPod(args: ScopedConfigTarget): Promise<ResolvedSandboxConfig> {
    return podFacingConfig(await this.resolveWithProvisioning(args))
  }

  async resolveWithProvisioning(args: ScopedConfigTarget): Promise<ResolvedSandboxConfig> {
    const projectId =
      args.projectId === null
        ? null
        : await this.accessibleProject({ ...args, projectId: args.projectId })
    const { cipher } = this
    const [user, project] = await Promise.all([
      loadUserLayer({ cipher, userId: args.userId }),
      projectId === null ? null : loadProjectLayer({ cipher, projectId }),
    ])
    return resolveScopedConfig({ defaults: EMPTY_SCOPE_LAYER, user, project })
  }

  async vercelCredentials(): Promise<VercelProvisioningCredentials> {
    const token = this.env.get('PLATFORM_VERCEL_TOKEN')
    const teamId = this.env.get('PLATFORM_VERCEL_TEAM_ID')
    const projectId = this.env.get('PLATFORM_VERCEL_PROJECT_ID')
    if (token === undefined || teamId === undefined || projectId === undefined) {
      throw new ServiceUnavailableException(NOT_CONFIGURED_MESSAGE)
    }
    return { token, teamId, projectId }
  }

  async accessibleProject(args: { userId: string; projectId: string }): Promise<string> {
    const project = await db.orm.public.Project.select('id', 'ownerUserId').first({
      id: args.projectId,
    })
    if (project === null || project.ownerUserId !== args.userId) {
      throw new NotFoundException('project not found')
    }
    return project.id
  }
}
