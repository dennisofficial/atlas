import {
  projectFileMountContentsSchema,
  projectFileMountKeySchema,
  projectFileMountListSchema,
  projectFileMountSetSchema,
  projectRepoTreeSchema,
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
  type ProjectFileMountContents,
  type ProjectFileMountKey,
  type ProjectFileMountList,
  type ProjectFileMountSetInput,
  type ProjectRepoTree,
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
import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import type { SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { EGithubCallSource } from '../github/github-call-log'
import { GithubRepoReads } from '../github/github-repo-reads'
import { GithubUserReadFailed } from '../github/github-user-reads'
import { ProjectFileMountsService } from './project-file-mounts.service'
import { ProjectResourcesService } from './project-resources.service'
import { assertProjectReach, assertRevealAllowed } from './project-reach'
import { ProjectSettingsService } from './project-settings.service'
import { ProjectsService } from './projects.service'

@Router({ alias: 'projectResources' })
@UseMiddlewares(SessionOrSandboxMiddleware)
export class ProjectResourcesRouter {
  constructor(
    private readonly resources: ProjectResourcesService,
    private readonly settings: ProjectSettingsService,
    private readonly fileMounts: ProjectFileMountsService,
    private readonly projects: ProjectsService,
    private readonly githubReads: GithubRepoReads,
  ) {}

  @Query({
    input: projectIdInputSchema,
    output: settingListSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async listSettings(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<SettingList> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    const settings = await this.settings.list({ userId: ctx.auth.userId, ...input })
    return { settings }
  }

  @Mutation({
    input: projectSettingsPatchSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async patchSettings(
    @Input() input: ProjectSettingsPatch,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
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

  @Query({
    input: projectIdInputSchema,
    output: projectSecretListSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async listSecrets(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ProjectSecretList> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    const secrets = await this.resources.listSecrets({ userId: ctx.auth.userId, ...input })
    return { secrets }
  }

  @Query({
    input: projectSecretKeySchema,
    output: projectSecretValueSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async revealSecret(
    @Input() input: ProjectSecretKey,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ProjectSecretValue> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    assertRevealAllowed({ ctx })
    const value = await this.resources.revealSecret({ userId: ctx.auth.userId, ...input })
    return { value }
  }

  @Mutation({
    input: projectSecretSetSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async setSecret(
    @Input() input: ProjectSecretSet,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    await this.resources.setSecret({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: projectSecretKeySchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async removeSecret(
    @Input() input: ProjectSecretKey,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    await this.resources.removeSecret({ userId: ctx.auth.userId, ...input })
  }

  @Query({
    input: projectIdInputSchema,
    output: projectFileMountListSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async listFileMounts(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ProjectFileMountList> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    const mounts = await this.fileMounts.list({ userId: ctx.auth.userId, ...input })
    return { mounts }
  }

  @Query({
    input: projectFileMountKeySchema,
    output: projectFileMountContentsSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async revealFileMount(
    @Input() input: ProjectFileMountKey,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ProjectFileMountContents> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    assertRevealAllowed({ ctx })
    const contents = await this.fileMounts.reveal({ userId: ctx.auth.userId, ...input })
    return { contents }
  }

  @Mutation({
    input: projectFileMountSetSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async setFileMount(
    @Input() input: ProjectFileMountSetInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    await this.fileMounts.set({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({
    input: projectFileMountKeySchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async removeFileMount(
    @Input() input: ProjectFileMountKey,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    await this.fileMounts.remove({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: projectIdInputSchema, output: projectRepoTreeSchema })
  async repoTree(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectRepoTree> {
    const workspace = await this.projects.workspace({ userId: ctx.auth.userId, ...input })
    const [owner, repo] = workspace.repo?.split('/') ?? []
    if (owner === undefined || repo === undefined || workspace.githubToken === null) {
      return { entries: [], truncated: false }
    }
    try {
      return await this.githubReads.listTree({
        source: EGithubCallSource.RepoTree,
        token: workspace.githubToken,
        owner,
        repo,
        ref: workspace.baseBranch ?? 'HEAD',
      })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && failure.status === 404) {
        throw new NotFoundException('repository not found')
      }
      throw new BadGatewayException('github could not list the repository tree')
    }
  }

  @Query({
    input: projectIdInputSchema,
    output: resourceMcpServerListSchema,
    meta: meta({ sandboxReachable: true }),
  })
  async listMcpServers(
    @Input() input: ProjectIdInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<ResourceMcpServerList> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    const servers = await this.resources.listMcpServers({ userId: ctx.auth.userId, ...input })
    return { servers }
  }

  @Mutation({
    input: projectMcpServerPutSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async putMcpServer(
    @Input() input: ProjectMcpServerPut,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    const { projectId, name, ...spec } = input
    await this.resources.putMcpServer({ userId: ctx.auth.userId, projectId, name, spec })
  }

  @Mutation({
    input: projectMcpServerKeySchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true }),
  })
  async removeMcpServer(
    @Input() input: ProjectMcpServerKey,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await assertProjectReach({ ctx, projectId: input.projectId })
    await this.resources.removeMcpServer({ userId: ctx.auth.userId, ...input })
  }
}
