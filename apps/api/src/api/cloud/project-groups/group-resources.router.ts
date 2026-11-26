import {
  groupFileMountKeySchema,
  groupFileMountSetSchema,
  groupIdInputSchema,
  groupInstructionSaveSchema,
  groupInstructionSchema,
  groupSecretKeySchema,
  groupSecretSetSchema,
  groupSettingsPatchSchema,
  layeredSettingsSchema,
  projectFileMountContentsSchema,
  projectFileMountListSchema,
  projectSecretListSchema,
  projectSecretValueSchema,
  settingListSchema,
  type GroupFileMountKey,
  type GroupFileMountSetInput,
  type GroupIdInput,
  type GroupInstruction,
  type GroupInstructionSave,
  type GroupSecretKey,
  type GroupSecretSet,
  type GroupSettingsPatch,
  type LayeredSettings,
  type ProjectFileMountContents,
  type ProjectFileMountList,
  type ProjectSecretList,
  type ProjectSecretValue,
  type SettingList,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { assertFreshSession } from '../../../_module/session/fresh-session'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { GroupInstructionsService } from './group-instructions.service'
import { GroupResourcesService } from './group-resources.service'
import { GroupSettingsService } from './group-settings.service'

@Router({ alias: 'groupResources' })
@UseMiddlewares(SessionMiddleware)
export class GroupResourcesRouter {
  constructor(
    private readonly resources: GroupResourcesService,
    private readonly settings: GroupSettingsService,
    private readonly groupInstructions: GroupInstructionsService,
  ) {}

  @Query({ input: groupIdInputSchema, output: projectSecretListSchema })
  async listSecrets(
    @Input() input: GroupIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectSecretList> {
    const secrets = await this.resources.listSecrets({ userId: ctx.auth.userId, ...input })
    return { secrets }
  }

  @Query({ input: groupSecretKeySchema, output: projectSecretValueSchema })
  async revealSecret(
    @Input() input: GroupSecretKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectSecretValue> {
    assertFreshSession({ auth: ctx.auth })
    const value = await this.resources.revealSecret({ userId: ctx.auth.userId, ...input })
    return { value }
  }

  @Mutation({ input: groupSecretSetSchema, output: z.void() })
  async setSecret(@Input() input: GroupSecretSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.resources.setSecret({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: groupSecretKeySchema, output: z.void() })
  async removeSecret(@Input() input: GroupSecretKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.resources.removeSecret({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: groupIdInputSchema, output: projectFileMountListSchema })
  async listFileMounts(
    @Input() input: GroupIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectFileMountList> {
    const mounts = await this.resources.listFileMounts({ userId: ctx.auth.userId, ...input })
    return { mounts }
  }

  @Query({ input: groupFileMountKeySchema, output: projectFileMountContentsSchema })
  async revealFileMount(
    @Input() input: GroupFileMountKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ProjectFileMountContents> {
    assertFreshSession({ auth: ctx.auth })
    const contents = await this.resources.revealFileMount({ userId: ctx.auth.userId, ...input })
    return { contents }
  }

  @Mutation({ input: groupFileMountSetSchema, output: z.void() })
  async setFileMount(
    @Input() input: GroupFileMountSetInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.resources.setFileMount({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: groupFileMountKeySchema, output: z.void() })
  async removeFileMount(
    @Input() input: GroupFileMountKey,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.resources.removeFileMount({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: groupIdInputSchema, output: settingListSchema })
  async listSettings(
    @Input() input: GroupIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SettingList> {
    const settings = await this.settings.list({ userId: ctx.auth.userId, ...input })
    return { settings }
  }

  @Mutation({ input: groupSettingsPatchSchema, output: z.void() })
  async patchSettings(
    @Input() input: GroupSettingsPatch,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.settings.patch({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: groupIdInputSchema, output: groupInstructionSchema })
  async instructions(
    @Input() input: GroupIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<GroupInstruction> {
    return this.groupInstructions.read({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: groupInstructionSaveSchema, output: z.void() })
  async saveInstructions(
    @Input() input: GroupInstructionSave,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.groupInstructions.save({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: groupIdInputSchema, output: layeredSettingsSchema })
  async layeredSettings(
    @Input() input: GroupIdInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<LayeredSettings> {
    return this.settings.layered({ userId: ctx.auth.userId, ...input })
  }
}
