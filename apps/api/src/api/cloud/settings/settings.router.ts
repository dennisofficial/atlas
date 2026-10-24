import {
  personalSettingKeySchema,
  personalSettingSetSchema,
  settingListSchema,
  settingsPatchSchema,
  type PersonalSettingKey,
  type PersonalSettingSet,
  type SettingList,
  type SettingsPatch,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { SettingsService } from './settings.service'

@Router({ alias: 'settings' })
export class SettingsRouter {
  constructor(private readonly settings: SettingsService) {}

  @Query({ output: settingListSchema, meta: meta({ podReachable: true, sandboxReachable: true }) })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async list(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<SettingList> {
    return { settings: await this.settings.list({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: settingsPatchSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async patch(@Input() input: SettingsPatch, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.settings.patch({ userId: ctx.auth.userId, values: input.values })
  }

  @Mutation({ input: personalSettingSetSchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async set(@Input() input: PersonalSettingSet, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.settings.set({ userId: ctx.auth.userId, key: input.key, value: input.value })
  }

  @Mutation({ input: personalSettingKeySchema, output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async remove(@Input() input: PersonalSettingKey, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.settings.remove({ userId: ctx.auth.userId, key: input.key })
  }
}
