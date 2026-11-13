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
}

export type SessionModelDefault = Partial<SessionModel>

export type SessionModelInput = {
  userId: string
  projectId: string
  model?: string | undefined
  effort?: string | undefined
  fast?: boolean | undefined
}

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

  abstract write(args: { sessionId: string } & SessionModelDefault): Promise<boolean>

  async resolve(args: SessionModelInput): Promise<SessionModelDefault> {
    const setting = (key: string): Promise<unknown> =>
      this.settingValue({ userId: args.userId, projectId: args.projectId, key })
    const modelRef = args.model ?? stringOf(await setting(SESSION_MODEL_SETTING_KEYS.id))
    const modelEffort = args.effort ?? stringOf(await setting(SESSION_MODEL_SETTING_KEYS.effort))
    const modelFast = args.fast ?? booleanOf(await setting(SESSION_MODEL_SETTING_KEYS.fast))
    return {
      ...(modelRef === undefined ? {} : { modelRef }),
      ...(modelEffort === undefined ? {} : { modelEffort }),
      ...(modelFast === undefined ? {} : { modelFast }),
    }
  }
}

const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

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

  async write(args: { sessionId: string } & SessionModelDefault): Promise<boolean> {
    const changed = await db.orm.v2.V2Session.where({ id: args.sessionId }).updateAndCount({
      modelRef: args.modelRef ?? null,
      modelEffort: args.modelEffort ?? null,
      modelFast: args.modelFast ?? null,
    })
    return changed === 1
  }
}
