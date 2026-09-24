import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { CloudSettingModel } from '../../../db'
import { db } from '../../../db'
import type { SettingDto } from './settings.types'

const MAX_KEY_LENGTH = 200
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
