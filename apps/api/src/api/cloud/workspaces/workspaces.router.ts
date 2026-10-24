import {
  organizationIdInputSchema,
  resourceMcpServerListSchema,
  settingListSchema,
  workspaceMcpServerKeySchema,
  workspaceMcpServerPutSchema,
  workspaceSecretKeySchema,
  workspaceSecretListSchema,
  workspaceSecretSetSchema,
  workspaceSettingsPatchSchema,
  workspaceVercelCredentialSchema,
  workspaceVercelSaveSchema,
  type OrganizationIdInput,
  type ResourceMcpServerList,
  type SettingList,
  type WorkspaceMcpServerKey,
  type WorkspaceMcpServerPut,
  type WorkspaceSecretKey,
  type WorkspaceSecretList,
  type WorkspaceSecretSet,
  type WorkspaceSettingsPatch,
  type WorkspaceVercelCredential,
  type WorkspaceVercelSave,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'

@Router({ alias: 'workspaces' })
@UseMiddlewares(SessionMiddleware)
export class WorkspacesRouter {
  constructor(
    private readonly resources: WorkspaceResourcesService,
    private readonly settings: WorkspaceSettingsService,
    private readonly vercel: WorkspaceVercelService,
  ) {}

  @Query({ input: organizationIdInputSchema, output: workspaceSecretListSchema })
  async listSecrets(
    @Input() input: OrganizationIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<WorkspaceSecretList> {
    const secrets = await this.resources.listSecrets({ userId: ctx.auth.userId, ...input })
    return { secrets }
  }

  @Mutation({ input: workspaceSecretSetSchema, output: z.void() })
  async setSecret(@Input() input: WorkspaceSecretSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.resources.setSecret({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: workspaceSecretKeySchema, output: z.void() })
  async removeSecret(
    @Input() input: WorkspaceSecretKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.resources.removeSecret({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: organizationIdInputSchema, output: resourceMcpServerListSchema })
  async listMcpServers(
    @Input() input: OrganizationIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ResourceMcpServerList> {
    const servers = await this.resources.listMcpServers({ userId: ctx.auth.userId, ...input })
    return { servers }
  }

  @Mutation({ input: workspaceMcpServerPutSchema, output: z.void() })
  async putMcpServer(
    @Input() input: WorkspaceMcpServerPut,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    const { organizationId, name, ...spec } = input
    await this.resources.putMcpServer({ userId: ctx.auth.userId, organizationId, name, spec })
  }

  @Mutation({ input: workspaceMcpServerKeySchema, output: z.void() })
  async removeMcpServer(
    @Input() input: WorkspaceMcpServerKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.resources.removeMcpServer({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: organizationIdInputSchema, output: settingListSchema })
  async listSettings(
    @Input() input: OrganizationIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SettingList> {
    const settings = await this.settings.list({ userId: ctx.auth.userId, ...input })
    return { settings }
  }

  @Mutation({ input: workspaceSettingsPatchSchema, output: z.void() })
  async patchSettings(
    @Input() input: WorkspaceSettingsPatch,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.settings.patch({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: organizationIdInputSchema, output: workspaceVercelCredentialSchema })
  getVercel(
    @Input() input: OrganizationIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<WorkspaceVercelCredential> {
    return this.vercel.read({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: workspaceVercelSaveSchema, output: z.void() })
  async saveVercel(@Input() input: WorkspaceVercelSave, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    const { organizationId, ...body } = input
    await this.vercel.write({ userId: ctx.auth.userId, organizationId, body })
  }

  @Mutation({ input: organizationIdInputSchema, output: z.void() })
  async removeVercel(
    @Input() input: OrganizationIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.vercel.remove({ userId: ctx.auth.userId, ...input })
  }
}
