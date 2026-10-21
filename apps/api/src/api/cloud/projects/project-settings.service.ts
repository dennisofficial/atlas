import { randomUUID } from 'node:crypto'
import { PROJECT_SETTING_REGISTRY, validateProjectSetting } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import type { SettingDto } from '../settings/settings.types'
import { ProjectsService } from './projects.service'

const MAX_PATCH_KEYS = 100

type Scope = { userId: string; projectId: string }

const assertPatch = (values: Record<string, string | null>): [string, string | null][] => {
  const entries = Object.entries(values)
  if (entries.length === 0 || entries.length > MAX_PATCH_KEYS) {
    throw new BadRequestException(`a patch carries between 1 and ${MAX_PATCH_KEYS} keys`)
  }
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== 'string') {
      throw new BadRequestException(`the value for ${key} must be a string or null`)
    }
    if (!PROJECT_SETTING_REGISTRY.has(key)) throw new BadRequestException(`unknown setting key: ${key}`)
    if (value === null) continue
    const verdict = validateProjectSetting({ key, stored: value })
    if (!verdict.ok) throw new BadRequestException(verdict.reason)
  }
  return entries
}

@Injectable()
export class ProjectSettingsService {
  constructor(private readonly projects: ProjectsService) {}

  async list(args: Scope): Promise<SettingDto[]> {
    await this.projects.read(args)
    const rows = await db.projectSetting.findMany({
      where: { projectId: args.projectId },
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() }))
  }

  async patch(args: Scope & { values: Record<string, string | null> }): Promise<void> {
    const entries = assertPatch(args.values)
    await this.projects.read(args)
    const { projectId } = args
    await db.$transaction(
      entries.map(([key, value]) =>
        value === null
          ? db.projectSetting.deleteMany({ where: { projectId, key } })
          : db.projectSetting.upsert({
              where: { projectId_key: { projectId, key } },
              create: { id: `pset_${randomUUID()}`, projectId, key, value },
              update: { value },
            }),
      ),
    )
  }
}
