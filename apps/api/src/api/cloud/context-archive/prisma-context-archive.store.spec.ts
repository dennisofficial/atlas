import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
import { PrismaContextArchiveStore } from './prisma-context-archive.store'

interface CloudSandboxRow {
  threadId: string
  workspaceContext: string | null
  workspaceContextArchive: Buffer | null
}

interface UserContextSyncRow {
  userId: string
  memoryBundle: string
  memoryArchive: Buffer | null
}

const fake = vi.hoisted(() => {
  const sandboxes: CloudSandboxRow[] = []
  const users: UserContextSyncRow[] = []

  const db = {
    cloudSandbox: {
      findUnique: vi.fn(async (args: { where: { threadId: string } }) =>
        sandboxes.find((row) => row.threadId === args.where.threadId) ?? null,
      ),
      update: vi.fn(async (args: { where: { threadId: string }; data: Record<string, unknown> }) => {
        const row = sandboxes.find((one) => one.threadId === args.where.threadId)
        if (row === undefined) throw new Error('record not found')
        Object.assign(row, args.data)
        return row
      }),
    },
    userContextSync: {
      findUnique: vi.fn(async (args: { where: { userId: string } }) =>
        users.find((row) => row.userId === args.where.userId) ?? null,
      ),
      upsert: vi.fn(
        async (args: {
          where: { userId: string }
          create: UserContextSyncRow
          update: Record<string, unknown>
        }) => {
          const existing = users.find((row) => row.userId === args.where.userId)
          if (existing === undefined) {
            users.push(args.create)
            return args.create
          }
          Object.assign(existing, args.update)
          return existing
        },
      ),
    },
  }

  return { db, sandboxes, users }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const THREAD = 'brn_thread_1'
const USER = 'user-a'

describe('PrismaContextArchiveStore', () => {
  let store: PrismaContextArchiveStore

  beforeEach(() => {
    fake.sandboxes.length = 0
    fake.users.length = 0
    fake.db.cloudSandbox.findUnique.mockClear()
    fake.db.cloudSandbox.update.mockClear()
    fake.db.userContextSync.findUnique.mockClear()
    fake.db.userContextSync.upsert.mockClear()
    store = new PrismaContextArchiveStore()
  })

  it('answers null for a sandbox that has never received an archive', async () => {
    fake.sandboxes.push({ threadId: THREAD, workspaceContext: null, workspaceContextArchive: null })

    await expect(store.readSandboxArchive({ threadId: THREAD })).resolves.toBeNull()
  })

  it('answers null when the sandbox row itself does not exist', async () => {
    await expect(store.readSandboxArchive({ threadId: THREAD })).resolves.toBeNull()
  })

  it('round-trips the sandbox archive bytes', async () => {
    fake.sandboxes.push({ threadId: THREAD, workspaceContext: null, workspaceContextArchive: null })
    const archive = Buffer.from('tar-gz-bytes')

    await store.writeSandboxArchive({ threadId: THREAD, archive })

    await expect(store.readSandboxArchive({ threadId: THREAD })).resolves.toEqual(archive)
  })

  it('writes the sandbox archive without touching the legacy workspaceContext column', async () => {
    fake.sandboxes.push({
      threadId: THREAD,
      workspaceContext: '{"legacy":"bundle"}',
      workspaceContextArchive: null,
    })

    await store.writeSandboxArchive({ threadId: THREAD, archive: Buffer.from('fresh') })

    expect(fake.db.cloudSandbox.update).toHaveBeenCalledWith({
      where: { threadId: THREAD },
      data: { workspaceContextArchive: new Uint8Array(Buffer.from('fresh')) },
    })
    expect(fake.sandboxes[0]?.workspaceContext).toBe('{"legacy":"bundle"}')
  })

  it('answers null for a user with no archive yet', async () => {
    await expect(store.readUserArchive({ userId: USER })).resolves.toBeNull()

    fake.users.push({ userId: USER, memoryBundle: '{}', memoryArchive: null })
    await expect(store.readUserArchive({ userId: USER })).resolves.toBeNull()
  })

  it('creates a fresh row with a valid placeholder legacy bundle on the first archive-only write', async () => {
    const archive = Buffer.from('memory-archive-bytes')

    await store.writeUserArchive({ userId: USER, archive })

    expect(fake.users).toHaveLength(1)
    expect(() => JSON.parse(fake.users[0]?.memoryBundle ?? 'not json')).not.toThrow()
    await expect(store.readUserArchive({ userId: USER })).resolves.toEqual(archive)
  })

  it('writes the user archive without touching an existing legacy memoryBundle', async () => {
    fake.users.push({ userId: USER, memoryBundle: '{"a":1}', memoryArchive: null })

    await store.writeUserArchive({ userId: USER, archive: Buffer.from('fresh') })

    expect(fake.db.userContextSync.upsert).toHaveBeenCalledWith({
      where: { userId: USER },
      create: expect.objectContaining({ userId: USER }),
      update: { memoryArchive: new Uint8Array(Buffer.from('fresh')) },
    })
    expect(fake.users[0]?.memoryBundle).toBe('{"a":1}')
  })
})
