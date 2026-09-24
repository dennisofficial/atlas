import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
import { SettingsService } from './settings.service'

interface CloudSettingRow {
  id: string
  key: string
  value: string
  createdAt: Date
  updatedAt: Date
  userId: string
}

type SettingCreate = Omit<CloudSettingRow, 'createdAt' | 'updatedAt'>

const fake = vi.hoisted(() => {
  const settings: CloudSettingRow[] = []

  const findByKey = (key: { userId: string; key: string }) =>
    settings.find((row) => row.userId === key.userId && row.key === key.key)

  const db = {
    cloudSetting: {
      findMany: async (args: { where: { userId: string } }) =>
        settings
          .filter((row) => row.userId === args.where.userId)
          .sort((a, b) => a.key.localeCompare(b.key)),
      upsert: async (args: {
        where: { userId_key: { userId: string; key: string } }
        create: SettingCreate
        update: { value: string }
      }) => {
        const existing = findByKey(args.where.userId_key)
        if (existing) {
          existing.value = args.update.value
          existing.updatedAt = new Date()
          return existing
        }
        const row = { ...args.create, createdAt: new Date(), updatedAt: new Date() }
        settings.push(row)
        return row
      },
      deleteMany: async (args: { where: { userId: string; key: string } }) => {
        const kept = settings.filter(
          (row) => !(row.userId === args.where.userId && row.key === args.where.key),
        )
        const count = settings.length - kept.length
        settings.splice(0, settings.length, ...kept)
        return { count }
      },
    },
  }

  return { db, settings }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('SettingsService', () => {
  let service: SettingsService

  beforeEach(() => {
    fake.settings.length = 0
    service = new SettingsService()
  })

  it('set stores the value in plain text and list returns it', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })

    const stored = fake.settings[0]
    expect(stored?.id).toMatch(/^set_/)
    expect(stored?.value).toBe('img-1')

    expect(await service.list({ userId: USER_A })).toEqual([
      {
        key: 'sandbox.image',
        value: 'img-1',
        updatedAt: stored?.updatedAt.toISOString(),
      },
    ])
  })

  it('set upserts an existing key and bumps updatedAt', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'old-value' })
    const updatedAtBefore = fake.settings[0]?.updatedAt

    await new Promise((resolve) => setTimeout(resolve, 5))
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'new-value' })

    expect(fake.settings).toHaveLength(1)
    expect(fake.settings[0]?.updatedAt.getTime()).toBeGreaterThan(
      updatedAtBefore?.getTime() ?? 0,
    )
    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('new-value')
  })

  it('list scopes to the owning user', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })

    expect(await service.list({ userId: USER_B })).toEqual([])
  })

  it('the same key under different users stays independent', async () => {
    await service.set({ userId: USER_A, key: 'shared', value: 'value-a' })
    await service.set({ userId: USER_B, key: 'shared', value: 'value-b' })

    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('value-a')
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('value-b')
  })

  it('remove deletes only the caller’s own entry and tolerates unknown keys', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.image', value: 'img-1' })
    await service.set({ userId: USER_B, key: 'sandbox.image', value: 'img-2' })

    await service.remove({ userId: USER_A, key: 'sandbox.image' })
    await service.remove({ userId: USER_A, key: 'never.existed' })

    expect(fake.settings).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('img-2')
  })

  it('rejects empty and over-long keys', async () => {
    await expect(service.set({ userId: USER_A, key: '', value: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      service.set({ userId: USER_A, key: 'k'.repeat(201), value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.remove({ userId: USER_A, key: 'k'.repeat(201) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.settings).toHaveLength(0)
  })

  it('rejects keys that are not dot-separated segments', async () => {
    const invalid = ['sandbox..image', '-sandbox', 'sandbox.', '1sandbox', 'a b', '.sandbox']
    for (const key of invalid) {
      await expect(service.set({ userId: USER_A, key, value: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    }
    expect(fake.settings).toHaveLength(0)
  })

  it('accepts dotted keys with camelCase, digits and dashes in later segments', async () => {
    await service.set({ userId: USER_A, key: 'sandbox.vercelTeamId', value: 'x' })
    await service.set({ userId: USER_A, key: 'sandbox.team-2.project3', value: 'y' })

    expect((await service.list({ userId: USER_A })).map((row) => row.key)).toEqual([
      'sandbox.team-2.project3',
      'sandbox.vercelTeamId',
    ])
  })
})
