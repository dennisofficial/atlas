import {
  projectIdInputSchema,
  projectMcpServerKeySchema,
  projectMcpServerPutSchema,
  projectSandboxSaveSchema,
  projectSandboxSchema,
  projectSecretKeySchema,
  projectSecretListSchema,
  projectSecretSetSchema,
  projectSecretValueSchema,
  projectSettingsPatchSchema,
  resourceMcpServerListSchema,
  settingListSchema,
  type ProjectIdInput,
  type ProjectMcpServerKey,
  type ProjectMcpServerPut,
  type ProjectSandbox,
  type ProjectSandboxSave,
  type ProjectSecretKey,
  type ProjectSecretList,
  type ProjectSecretSet,
  type ProjectSecretValue,
  type ProjectSettingsPatch,
  type ResourceMcpServerList,
  type SettingList,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { assertFreshSession } from '../../../_module/session/fresh-session'
import { ProjectResourcesService } from './project-resources.service'
import { ProjectSettingsService } from './project-settings.service'

@Router({ alias: 'projectResources' })
@UseMiddlewares(SessionMiddleware)
export class ProjectResourcesRouter {
  constructor(
    private readonly resources: ProjectResourcesService,
    private readonly settings: ProjectSettingsService,
  ) {}

  @Query({ input: projectIdInputSchema, output: settingListSchema })
  async listSettings(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SettingList> {
    const settings = await this.settings.list({ userId: ctx.auth.userId, ...input })
    return { settings }
  }

  @Mutation({ input: projectSettingsPatchSchema, output: z.void() })
  async patchSettings(
    @Input() input: ProjectSettingsPatch,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.settings.patch({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: projectIdInputSchema, output: projectSandboxSchema })
  getSandbox(@Input() input: ProjectIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<ProjectSandbox> {
    return this.resources.readSandbox({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: projectSandboxSaveSchema, output: projectSandboxSchema })
  saveSandbox(
    @Input() input: ProjectSandboxSave,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectSandbox> {
    const { projectId, ...sandbox } = input
    return this.resources.writeSandbox({ userId: ctx.auth.userId, projectId, sandbox })
  }

  @Query({ input: projectIdInputSchema, output: projectSecretListSchema })
  async listSecrets(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectSecretList> {
    const secrets = await this.resources.listSecrets({ userId: ctx.auth.userId, ...input })
    return { secrets }
  }

  @Query({ input: projectSecretKeySchema, output: projectSecretValueSchema })
  async revealSecret(
    @Input() input: ProjectSecretKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectSecretValue> {
    assertFreshSession({ auth: ctx.auth })
    const value = await this.resources.revealSecret({ userId: ctx.auth.userId, ...input })
    return { value }
  }

  @Mutation({ input: projectSecretSetSchema, output: z.void() })
  async setSecret(@Input() input: ProjectSecretSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.resources.setSecret({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: projectSecretKeySchema, output: z.void() })
  async removeSecret(@Input() input: ProjectSecretKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.resources.removeSecret({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: projectIdInputSchema, output: resourceMcpServerListSchema })
  async listMcpServers(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ResourceMcpServerList> {
    const servers = await this.resources.listMcpServers({ userId: ctx.auth.userId, ...input })
    return { servers }
  }

  @Mutation({ input: projectMcpServerPutSchema, output: z.void() })
  async putMcpServer(
    @Input() input: ProjectMcpServerPut,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    const { projectId, name, ...spec } = input
    await this.resources.putMcpServer({ userId: ctx.auth.userId, projectId, name, spec })
  }

  @Mutation({ input: projectMcpServerKeySchema, output: z.void() })
  async removeMcpServer(
    @Input() input: ProjectMcpServerKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.resources.removeMcpServer({ userId: ctx.auth.userId, ...input })
  }
}
