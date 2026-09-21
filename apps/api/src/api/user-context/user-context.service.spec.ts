import { PayloadTooLargeException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'
import { MAX_CONTEXT_BUNDLE_BYTES } from '../sandboxes/workspace-spec'
import { UserContextService } from './user-context.service'

interface UserContextSyncRow {
  userId: string
  memoryBundle: string
  updatedAt: Date
}

const fake = vi.hoisted(() => {
  const rows: UserContextSyncRow[] = []

  const db = {
    userContextSync: {
      findUnique: async (args: { where: { userId: string } }) =>
        rows.find((row) => row.userId === args.where.userId) ?? null,
      upsert: async (args: {
        where: { userId: string }
        create: UserContextSyncRow
        update: { memoryBundle: string }
      }) => {
        const existing = rows.find((row) => row.userId === args.where.userId)
        if (existing) {
          existing.memoryBundle = args.update.memoryBundle
          existing.updatedAt = new Date()
          return existing
        }
        const row = { ...args.create, updatedAt: new Date() }
        rows.push(row)
        return row
      },
    },
  }

  return { db, rows }
})

vi.mock('../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('UserContextService', () => {
  let service: UserContextService

  beforeEach(() => {
    fake.rows.length = 0
    service = new UserContextService()
  })

  it('answers null when nothing has ever synced for the user', async () => {
    expect(await service.getMemory({ userId: USER_A })).toBeNull()
  })

  it('put upserts a bundle and get reads it back', async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"user/MEMORY.md":{"content":"x","mtime":1}}' })

    expect(await service.getMemory({ userId: USER_A })).toBe(
      '{"user/MEMORY.md":{"content":"x","mtime":1}}',
    )
    expect(fake.rows).toHaveLength(1)
  })

  it('put replaces an existing bundle rather than creating a second row', async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"a":1}' })
    await service.putMemory({ userId: USER_A, bundle: '{"a":2}' })

    expect(fake.rows).toHaveLength(1)
    expect(await service.getMemory({ userId: USER_A })).toBe('{"a":2}')
  })

  it('rejects a bundle over the shared context cap', async () => {
    const oversized = 'x'.repeat(MAX_CONTEXT_BUNDLE_BYTES + 1)

    await expect(
      service.putMemory({ userId: USER_A, bundle: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(fake.rows).toHaveLength(0)
  })

  it('scopes every operation to the owning user', async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"a":1}' })

    expect(await service.getMemory({ userId: USER_B })).toBeNull()

    await service.putMemory({ userId: USER_B, bundle: '{"b":1}' })

    expect(await service.getMemory({ userId: USER_A })).toBe('{"a":1}')
    expect(await service.getMemory({ userId: USER_B })).toBe('{"b":1}')
    expect(fake.rows).toHaveLength(2)
  })
})
