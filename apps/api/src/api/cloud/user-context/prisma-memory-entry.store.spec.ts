import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
import { PrismaUserMemoryEntryStore } from './prisma-memory-entry.store'

interface UserMemoryEntryRow {
  userId: string
  key: string
  content: Buffer
  mtimeMs: bigint
  updatedAt: Date
}

interface UpsertCall {
  where: { userId_key: { userId: string; key: string } }
  create: { userId: string; key: string; content: Uint8Array; mtimeMs: bigint }
  update: { content: Uint8Array; mtimeMs: bigint }
}

const fake = vi.hoisted(() => {
  const rows: UserMemoryEntryRow[] = []

  const applyUpsert = (args: UpsertCall) => {
    const existing = rows.find(
      (row) => row.userId === args.where.userId_key.userId && row.key === args.where.userId_key.key,
    )
    if (existing === undefined) {
      const row: UserMemoryEntryRow = {
        ...args.create,
        content: Buffer.from(args.create.content),
        updatedAt: new Date(),
      }
      rows.push(row)
      return row
    }
    existing.content = Buffer.from(args.update.content)
    existing.mtimeMs = args.update.mtimeMs
    existing.updatedAt = new Date()
    return existing
  }

  const db = {
    userMemoryEntry: {
      findMany: async (args: { where: { userId: string; key?: { in: string[] } } }) =>
        rows.filter(
          (row) =>
            row.userId === args.where.userId &&
            (args.where.key === undefined || args.where.key.in.includes(row.key)),
        ),
      upsert: vi.fn(async (args: UpsertCall) => applyUpsert(args)),
      deleteMany: async (args: { where: { userId: string } }) => {
        const kept = rows.filter((row) => row.userId !== args.where.userId)
        const count = rows.length - kept.length
        rows.splice(0, rows.length, ...kept)
        return { count }
      },
    },
    $transaction: vi.fn(async (promises: readonly Promise<unknown>[]) => Promise.all(promises)),
  }

  return { db, rows }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER = 'user-a'
const OTHER = 'user-b'

describe('PrismaUserMemoryEntryStore', () => {
  let store: PrismaUserMemoryEntryStore

  beforeEach(() => {
    fake.rows.length = 0
    store = new PrismaUserMemoryEntryStore()
  })

  it('creates rows for keys it has never seen', async () => {
    await store.mergeEntries({
      userId: USER,
      entries: [{ key: 'user/a.md', content: Buffer.from('alpha'), mtimeMs: 1000 }],
    })

    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]?.key).toBe('user/a.md')
    expect(fake.rows[0]?.mtimeMs).toBe(1000n)
  })

  it('keeps the stored row when the incoming mtime is older, replaces it when newer', async () => {
    fake.rows.push({
      userId: USER,
      key: 'user/a.md',
      content: Buffer.from('stored'),
      mtimeMs: 2000n,
      updatedAt: new Date(),
    })

    await store.mergeEntries({
      userId: USER,
      entries: [{ key: 'user/a.md', content: Buffer.from('older'), mtimeMs: 1000 }],
    })
    expect(fake.rows[0]?.content.toString()).toBe('stored')

    await store.mergeEntries({
      userId: USER,
      entries: [{ key: 'user/a.md', content: Buffer.from('newer'), mtimeMs: 3000 }],
    })
    expect(fake.rows[0]?.content.toString()).toBe('newer')
    expect(fake.rows[0]?.mtimeMs).toBe(3000n)
    expect(fake.rows).toHaveLength(1)
  })

  it('lists only the entries of the owning user', async () => {
    const base = { content: Buffer.from('x'), updatedAt: new Date() }
    fake.rows.push({ ...base, userId: USER, key: 'user/a.md', mtimeMs: 1n })
    fake.rows.push({ ...base, userId: OTHER, key: 'user/b.md', mtimeMs: 2n })

    const entries = await store.listEntries({ userId: USER })

    expect(entries.map((entry) => entry.key)).toEqual(['user/a.md'])
  })

  it('deleteEntries removes every row of the user and no others', async () => {
    const base = { content: Buffer.from('x'), updatedAt: new Date() }
    fake.rows.push({ ...base, userId: USER, key: 'user/a.md', mtimeMs: 1n })
    fake.rows.push({ ...base, userId: USER, key: 'user/b.md', mtimeMs: 2n })
    fake.rows.push({ ...base, userId: OTHER, key: 'user/c.md', mtimeMs: 3n })

    await store.deleteEntries({ userId: USER })

    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]?.userId).toBe(OTHER)
  })
})
