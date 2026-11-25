import { randomUUID } from 'node:crypto'
import { EConfigLayer, type LayeredSettings } from '@dltech/atlas-wire'
import { isProjectSettingKey, validateProjectSetting } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { PERSONAL_LAYER_OWNER } from '../../../_lib/config-layers/layer-owner'
import { layeredSettingsOf } from '../../../_lib/config-layers/layered-settings'
import type { SettingDto } from '../settings/settings.types'
import { GroupsService } from './project-groups.service'

const MAX_PATCH_KEYS = 100

type Scope = { userId: string; groupId: string }

const assertPatch = (values: Record<string, string | null>): [string, string | null][] => {
  const entries = Object.entries(values)
  if (entries.length === 0 || entries.length > MAX_PATCH_KEYS) {
    throw new BadRequestException(`a patch carries between 1 and ${MAX_PATCH_KEYS} keys`)
  }
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== 'string') {
      throw new BadRequestException(`the value for ${key} must be a string or null`)
    }
    if (!isProjectSettingKey(key)) throw new BadRequestException(`unknown setting key: ${key}`)
    if (value === null) continue
    const verdict = validateProjectSetting({ key, stored: value })
    if (!verdict.ok) throw new BadRequestException(verdict.reason)
  }
  return entries
}

@Injectable()
export class GroupSettingsService {
  constructor(private readonly groups: GroupsService) {}

  async list(args: Scope): Promise<SettingDto[]> {
    await this.groups.owned(args)
    const rows = await db.orm.public.GroupSetting.where({ groupId: args.groupId })
      .orderBy((row) => row.key.asc())
      .all()
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async patch(args: Scope & { values: Record<string, string | null> }): Promise<void> {
    const entries = assertPatch(args.values)
    await this.groups.owned(args)
    const { groupId } = args
    await db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        if (value === null) {
          await tx.orm.public.GroupSetting.where({ groupId, key }).deleteAndCount()
          continue
        }
        await tx.orm.public.GroupSetting.upsert({
          create: { id: `gset_${randomUUID()}`, groupId, key, value },
          update: { value },
          conflictOn: { groupId, key },
        })
      }
    })
  }

  async layered(args: Scope): Promise<LayeredSettings> {
    const group = await this.groups.owned(args)
    const [user, settings] = await Promise.all([
      db.orm.public.UserSetting.where({ userId: args.userId })
        .orderBy((row) => row.key.asc())
        .all(),
      db.orm.public.GroupSetting.where({ groupId: args.groupId })
        .orderBy((row) => row.key.asc())
        .all(),
    ])
    return layeredSettingsOf([
      { layer: EConfigLayer.Personal, owner: PERSONAL_LAYER_OWNER, values: user },
      { layer: EConfigLayer.Group, owner: { id: group.id, name: group.name }, values: settings },
    ])
  }
}
