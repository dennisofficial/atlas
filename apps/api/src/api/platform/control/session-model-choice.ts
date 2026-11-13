import { BadRequestException } from '@nestjs/common'
import { parseRef } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'

const SETTING_VALUE_PREFIX = 'atlas-setting:v1:'

export const SESSION_MODEL_SETTING_KEYS = {
  id: 'model.id',
  effort: 'model.effort',
  fast: 'model.fast',
} as const

export type SessionModel = {
  modelRef: string
  modelEffort?: string | undefined
  modelFast?: boolean | undefined
  modelAccountId?: string | undefined
}

export type SessionModelDefault = Partial<SessionModel>

export type SessionModelInput = {
  userId: string
  projectId: string
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
  accountId?: string | undefined
}

export type AccountRef = { id: string; provider: string }

const decodeSetting = (stored: string): unknown => {
  if (!stored.startsWith(SETTING_VALUE_PREFIX)) return stored
  try {
    return JSON.parse(stored.slice(SETTING_VALUE_PREFIX.length))
  } catch {
    return stored
  }
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

export abstract class SessionModelChoice {
  protected abstract settingValue(args: {
    userId: string
    projectId: string
    key: string
  }): Promise<unknown>

  protected abstract accountOf(args: {
    userId: string
    accountId: string
  }): Promise<AccountRef | undefined>

  protected abstract activeAccountOf(args: {
    userId: string
    provider: string
  }): Promise<string | undefined>

  abstract write(args: { sessionId: string } & SessionModelDefault): Promise<boolean>

  async resolve(args: SessionModelInput): Promise<SessionModelDefault> {
    const setting = (key: string): Promise<unknown> =>
      this.settingValue({ userId: args.userId, projectId: args.projectId, key })
    const modelRef = args.model ?? stringOf(await setting(SESSION_MODEL_SETTING_KEYS.id))
    const modelEffort = args.effort ?? stringOf(await setting(SESSION_MODEL_SETTING_KEYS.effort))
    const modelFast = args.fast ?? booleanOf(await setting(SESSION_MODEL_SETTING_KEYS.fast))
    const modelAccountId = await this.accountFor({
      userId: args.userId,
      modelRef,
      accountId: args.accountId,
    })
    return {
      ...(modelRef === undefined ? {} : { modelRef }),
      ...(modelEffort === undefined ? {} : { modelEffort }),
      ...(modelFast === undefined ? {} : { modelFast }),
      ...(modelAccountId === undefined ? {} : { modelAccountId }),
    }
  }

  private async accountFor(args: {
    userId: string
    modelRef: string | undefined
    accountId: string | undefined
  }): Promise<string | undefined> {
    if (args.accountId === undefined) {
      const provider = args.modelRef === undefined ? undefined : providerOf(args.modelRef)
      if (provider === undefined) return undefined
      return this.activeAccountOf({ userId: args.userId, provider })
    }
    const account = await this.accountOf({ userId: args.userId, accountId: args.accountId })
    if (account === undefined) throw new BadRequestException('account not found')
    if (args.modelRef === undefined) {
      throw new BadRequestException('an account needs the model it runs')
    }
    const provider = providerOf(args.modelRef)
    if (provider !== account.provider) {
      throw new BadRequestException(`account ${account.id} is not a ${provider} account`)
    }
    return account.id
  }
}

const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

const providerOf = (modelRef: string): string | undefined => parseRef(modelRef)?.providerId

export class DbSessionModelChoice extends SessionModelChoice {
  protected async settingValue(args: {
    userId: string
    projectId: string
    key: string
  }): Promise<unknown> {
    const [project, user] = await Promise.all([
      db.orm.public.ProjectSetting.first({ projectId: args.projectId, key: args.key }),
      db.orm.public.UserSetting.first({ userId: args.userId, key: args.key }),
    ])
    const stored = project?.value ?? user?.value
    return stored === undefined ? undefined : decodeSetting(stored)
  }

  protected async accountOf(args: {
    userId: string
    accountId: string
  }): Promise<AccountRef | undefined> {
    const row = await db.orm.public.AgentAccount.first({ id: args.accountId, userId: args.userId })
    return row === null ? undefined : { id: row.id, provider: row.provider }
  }

  protected async activeAccountOf(args: {
    userId: string
    provider: string
  }): Promise<string | undefined> {
    const row = await db.orm.public.ActiveAccount.first({
      userId: args.userId,
      provider: args.provider,
    })
    return row?.accountId
  }

  async write(args: { sessionId: string } & SessionModelDefault): Promise<boolean> {
    const changed = await db.orm.v2.V2Session.where({ id: args.sessionId }).updateAndCount({
      modelRef: args.modelRef ?? null,
      modelEffort: args.modelEffort ?? null,
      modelFast: args.modelFast ?? null,
      modelAccountId: args.modelAccountId ?? null,
    })
    return changed === 1
  }
}
