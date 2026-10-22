import type { ResolvedSandboxConfig, VercelProvisioningCredentials } from '@dltech/atlas-wire/web'
import {
  decodeSettingValue,
  EMPTY_SCOPE_LAYER,
  EVercelCredentialGap,
  podFacingConfig,
  resolveScopedConfig,
  VERCEL_PROJECT_ID_SETTING,
} from '@dltech/atlas-wire/web'
import { Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { WorkspaceVercelService } from '../workspaces/workspace-vercel.service'
import { VercelNotConfiguredError } from './scoped-config.errors'
import { loadProjectLayer, loadUserLayer, loadWorkspaceLayer } from './scoped-config.layers'

type ProjectLink = { id: string; organizationId: string | null }

export type ScopedConfigTarget = { userId: string; projectId: string | null }

@Injectable()
export class ScopedConfigService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly vercel: WorkspaceVercelService,
  ) {}

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

  async vercelCredentials(args: { projectId: string }): Promise<VercelProvisioningCredentials> {
    const project = await db.project.findUnique({
      where: { id: args.projectId },
      select: { id: true, organizationId: true },
    })
    if (project === null) throw new NotFoundException('project not found')
    if (project.organizationId === null) {
      throw new VercelNotConfiguredError(EVercelCredentialGap.ProjectWorkspace)
    }
    const credential = await this.vercel.openToken({ organizationId: project.organizationId })
    if (credential === null)
      throw new VercelNotConfiguredError(EVercelCredentialGap.WorkspaceCredential)
    const setting = await db.projectSetting.findUnique({
      where: { projectId_key: { projectId: project.id, key: VERCEL_PROJECT_ID_SETTING } },
    })
    const projectId = setting === null ? '' : String(decodeSettingValue(setting.value)).trim()
    if (projectId.length === 0) throw new VercelNotConfiguredError(EVercelCredentialGap.ProjectId)
    return { token: credential.token, teamId: credential.teamId, projectId }
  }

  async accessibleProject(args: { userId: string; projectId: string }): Promise<ProjectLink> {
    const project = await db.project.findUnique({
      where: { id: args.projectId },
      select: { id: true, userId: true, organizationId: true },
    })
    if (project === null) throw new NotFoundException('project not found')
    if (project.userId === args.userId) return project
    if (project.organizationId === null) throw new NotFoundException('project not found')
    const member = await db.member.findFirst({
      where: { organizationId: project.organizationId, userId: args.userId },
    })
    if (member === null) throw new NotFoundException('project not found')
    return project
  }
}
