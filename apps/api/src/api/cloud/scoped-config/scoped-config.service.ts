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
import { loadProjectLayer, loadUserLayer, loadWorkspaceLayer } from './scoped-config.layers'

type ProjectLink = { id: string; organizationId: string | null }

export type ScopedConfigTarget = { userId: string; projectId: string | null }

export type ThreadOwner = { userId: string; organizationId: string | null }

@Injectable()
export class ScopedConfigService {
  constructor(private readonly cipher: SecretCipherService) {}

  async resolveForPod(args: ScopedConfigTarget): Promise<ResolvedSandboxConfig> {
    return podFacingConfig(await this.resolveWithProvisioning(args))
  }

  async resolveWithProvisioning(args: ScopedConfigTarget): Promise<ResolvedSandboxConfig> {
    const project =
      args.projectId === null
        ? null
        : await this.accessibleProject({ ...args, projectId: args.projectId })
    const { cipher } = this
    const [user, workspace, projectLayer] = await Promise.all([
      loadUserLayer({ cipher, userId: args.userId }),
      project?.organizationId
        ? loadWorkspaceLayer({ cipher, organizationId: project.organizationId })
        : null,
      project === null ? null : loadProjectLayer({ cipher, projectId: project.id }),
    ])
    return resolveScopedConfig({
      defaults: EMPTY_SCOPE_LAYER,
      workspace,
      user,
      project: projectLayer,
    })
  }

  async vercelCredentials(args: { thread: ThreadOwner }): Promise<VercelProvisioningCredentials> {
    const { organizationId, userId } = args.thread
    if (organizationId === null) return this.userCredential({ userId })
    const row = await db.orm.public.WorkspaceVercelCredential.first({ organizationId })
    if (row === null) throw new VercelNotConfiguredError(EVercelCredentialGap.WorkspaceCredential)
    const projectId = row.vercelProjectId?.trim() ?? ''
    if (projectId.length === 0) {
      throw new VercelNotConfiguredError(EVercelCredentialGap.CredentialProjectId)
    }
    return { token: this.open(row.sealedToken), teamId: row.teamId, projectId }
  }

  private async userCredential(args: { userId: string }): Promise<VercelProvisioningCredentials> {
    const row = await db.orm.public.UserVercelCredential.first({ userId: args.userId })
    if (row === null) throw new VercelNotConfiguredError(EVercelCredentialGap.UserCredential)
    return { token: this.open(row.sealedToken), teamId: row.teamId, projectId: row.vercelProjectId }
  }

  private open(sealed: string): string {
    return openSecretValue({ cipher: this.cipher, sealed })
  }

  async accessibleProject(args: { userId: string; projectId: string }): Promise<ProjectLink> {
    const project = await db.orm.public.Project.select('id', 'ownerUserId', 'organizationId').first(
      {
        id: args.projectId,
      },
    )
    if (project === null) throw new NotFoundException('project not found')
    if (project.ownerUserId === args.userId)
      return { id: project.id, organizationId: project.organizationId }
    if (project.organizationId === null) throw new NotFoundException('project not found')
    const member = await db.orm.public.Member.first({
      organizationId: project.organizationId,
      userId: args.userId,
    })
    if (member === null) throw new NotFoundException('project not found')
    return { id: project.id, organizationId: project.organizationId }
  }
}
