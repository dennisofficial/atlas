import { randomUUID } from 'node:crypto'
import { validateWorkspaceSetting, WORKSPACE_SETTING_REGISTRY } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import type { SettingDto } from '../settings/settings.types'
import { WorkspaceAccessService } from './workspace-access.service'

const MAX_PATCH_KEYS = 100

@Injectable()
export class WorkspaceSettingsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  async list(args: { userId: string; organizationId: string }): Promise<SettingDto[]> {
    await this.access.require({ ...args, write: false })
    const rows = await db.workspaceSetting.findMany({
      where: { organizationId: args.organizationId },
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  async patch(args: {
    userId: string
    organizationId: string
    values: Record<string, string | null>
  }): Promise<void> {
    await this.access.require({ userId: args.userId, organizationId: args.organizationId, write: true })
    const entries = Object.entries(args.values)
    if (entries.length === 0 || entries.length > MAX_PATCH_KEYS) {
      throw new BadRequestException(`a patch carries between 1 and ${MAX_PATCH_KEYS} keys`)
    }
    for (const [key, value] of entries) {
      if (value !== null && typeof value !== 'string') {
        throw new BadRequestException(`the value for ${key} must be a string or null`)
      }
      const verdict = validateWorkspaceSetting({ key, stored: value ?? '' })
      if (!verdict.ok && (value !== null || !WORKSPACE_SETTING_REGISTRY.has(key))) {
        throw new BadRequestException(verdict.reason)
      }
    }
    const { organizationId } = args
    await db.$transaction(
      entries.map(([key, value]) =>
        value === null
          ? db.workspaceSetting.deleteMany({ where: { organizationId, key } })
          : db.workspaceSetting.upsert({
              where: { organizationId_key: { organizationId, key } },
              create: { id: `wset_${randomUUID()}`, organizationId, key, value },
              update: { value },
            }),
      ),
    )
  }
}
