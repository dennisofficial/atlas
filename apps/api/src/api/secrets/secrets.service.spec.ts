import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '@core/config/env/env.service'
import { SecretCipherService } from '@lib/crypto/secret-cipher.service'
import type { PrismaClient } from '../../generated/prisma/client'
import { SecretsService } from './secrets.service'

const HEX_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

interface SecretEntryRow {
  id: string
  name: string
  sealedValue: string
  createdAt: Date
  updatedAt: Date
  userId: string
}

type SecretCreate = Omit<SecretEntryRow, 'createdAt' | 'updatedAt'>

const fake = vi.hoisted(() => {
  const secrets: SecretEntryRow[] = []

  const findByKey = (key: { userId: string; name: string }) =>
    secrets.find((row) => row.userId === key.userId && row.name === key.name)

  const db = {
    secretEntry: {
      findMany: async (args: { where: { userId: string } }) =>
        secrets
          .filter((row) => row.userId === args.where.userId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      upsert: async (args: {
        where: { userId_name: { userId: string; name: string } }
        create: SecretCreate
        update: { sealedValue: string }
      }) => {
        const existing = findByKey(args.where.userId_name)
        if (existing) {
          existing.sealedValue = args.update.sealedValue
          existing.updatedAt = new Date()
          return existing
        }
        const row = { ...args.create, createdAt: new Date(), updatedAt: new Date() }
        secrets.push(row)
        return row
      },
      deleteMany: async (args: { where: { userId: string; name: string } }) => {
        const kept = secrets.filter(
          (row) => !(row.userId === args.where.userId && row.name === args.where.name),
        )
        const count = secrets.length - kept.length
        secrets.splice(0, secrets.length, ...kept)
        return { count }
      },
    },
  }

  return { db, secrets }
})

vi.mock('@db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('SecretsService', () => {
  let service: SecretsService

  beforeEach(() => {
    fake.secrets.length = 0
    service = new SecretsService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    )
  })

  it('set seals the value and list returns it decrypted', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })

    const stored = fake.secrets[0]
    expect(stored?.id).toMatch(/^sec_/)
    expect(stored?.sealedValue).not.toContain('sk-search-1')

    expect(await service.list({ userId: USER_A })).toEqual([
      {
        name: 'web.searchKey',
        value: 'sk-search-1',
        updatedAt: stored?.updatedAt.toISOString(),
      },
    ])
  })

  it('set upserts an existing name and bumps updatedAt', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'old-value' })
    const sealedBefore = fake.secrets[0]?.sealedValue

    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'new-value' })

    expect(fake.secrets).toHaveLength(1)
    expect(fake.secrets[0]?.sealedValue).not.toBe(sealedBefore)
    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('new-value')
  })

  it('list scopes to the owning user', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })

    expect(await service.list({ userId: USER_B })).toEqual([])
  })

  it('the same name under different users stays independent', async () => {
    await service.set({ userId: USER_A, name: 'shared', value: 'value-a' })
    await service.set({ userId: USER_B, name: 'shared', value: 'value-b' })

    expect((await service.list({ userId: USER_A }))[0]?.value).toBe('value-a')
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('value-b')
  })

  it('remove deletes only the caller’s own entry and tolerates unknown names', async () => {
    await service.set({ userId: USER_A, name: 'web.searchKey', value: 'sk-search-1' })
    await service.set({ userId: USER_B, name: 'web.searchKey', value: 'sk-search-2' })

    await service.remove({ userId: USER_A, name: 'web.searchKey' })
    await service.remove({ userId: USER_A, name: 'never-existed' })

    expect(fake.secrets).toHaveLength(1)
    expect((await service.list({ userId: USER_B }))[0]?.value).toBe('sk-search-2')
  })

  it('rejects empty and over-long names', async () => {
    await expect(service.set({ userId: USER_A, name: '', value: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(
      service.set({ userId: USER_A, name: 'n'.repeat(201), value: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.remove({ userId: USER_A, name: 'n'.repeat(201) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(fake.secrets).toHaveLength(0)
  })
})
