import { randomUUID } from 'node:crypto'
import { validateCloudSetting } from '@dltech/atlas-wire/web'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { CloudSettingModel } from '../../../db'
import { db } from '../../../db'
import type { SettingDto } from './settings.types'

const MAX_KEY_LENGTH = 200
const MAX_PATCH_KEYS = 100
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)*$/

function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new BadRequestException(
      `a setting key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`,
    )
  }
  if (!KEY_PATTERN.test(key)) {
    throw new BadRequestException(
      'a setting key must be dot-separated segments like `sandbox.image`',
    )
  }
}

function assertValidValue(args: { key: string; value: string }): void {
  const verdict = validateCloudSetting({ key: args.key, stored: args.value })
  if (!verdict.ok) throw new BadRequestException(verdict.reason)
}

function assertPatchShape(values: Record<string, string | null>): [string, string | null][] {
  const entries = Object.entries(values)
  if (entries.length === 0 || entries.length > MAX_PATCH_KEYS) {
    throw new BadRequestException(`a patch carries between 1 and ${MAX_PATCH_KEYS} keys`)
  }
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== 'string') {
      throw new BadRequestException(`the value for ${key} must be a string or null`)
    }
    assertValidKey(key)
    if (value !== null) assertValidValue({ key, value })
  }
  return entries
}

@Injectable()
export class SettingsService {
  async list(args: { userId: string }): Promise<SettingDto[]> {
    const rows = await db.cloudSetting.findMany({
      where: { userId: args.userId },
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => toSettingDto(row))
  }

  async set(args: { userId: string; key: string; value: string }): Promise<void> {
    assertValidKey(args.key)
    await db.cloudSetting.upsert({
      where: { userId_key: { userId: args.userId, key: args.key } },
      create: {
        id: `set_${randomUUID()}`,
        key: args.key,
        value: args.value,
        userId: args.userId,
      },
      update: { value: args.value },
    })
  }

  async patch(args: { userId: string; values: Record<string, string | null> }): Promise<void> {
    const entries = assertPatchShape(args.values)
    await db.$transaction(
      entries.map(([key, value]) =>
        value === null
          ? db.cloudSetting.deleteMany({ where: { userId: args.userId, key } })
          : db.cloudSetting.upsert({
              where: { userId_key: { userId: args.userId, key } },
              create: { id: `set_${randomUUID()}`, key, value, userId: args.userId },
              update: { value },
            }),
      ),
    )
  }

  async remove(args: { userId: string; key: string }): Promise<void> {
    assertValidKey(args.key)
    await db.cloudSetting.deleteMany({
      where: { userId: args.userId, key: args.key },
    })
  }
}

function toSettingDto(row: CloudSettingModel): SettingDto {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  }
}
