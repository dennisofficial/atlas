import type { ResolvedSandboxConfig, VercelProvisioningCredentials } from '@dltech/atlas-wire/web'
import {
  EMPTY_SCOPE_LAYER,
  EVercelCredentialGap,
  podFacingConfig,
  resolveScopedConfig,
} from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { openSecretValue } from '../secrets/sealed-secret'
import { VercelNotConfiguredError } from './scoped-config.errors'
import { loadProjectLayer, loadUserLayer } from './scoped-config.layers'

export type ScopedConfigTarget = { userId: string; projectId: string | null }

export type ThreadOwner = { userId: string }

@Injectable()
export class ScopedConfigService {
  constructor(private readonly cipher: SecretCipherService) {}

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

  async vercelCredentials(args: { thread: ThreadOwner }): Promise<VercelProvisioningCredentials> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.thread.userId })
    if (row === null) throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    return {
      token: openSecretValue({ cipher: this.cipher, sealed: row.sealedToken }),
      teamId: row.teamId,
      projectId: row.vercelProjectId,
    }
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
