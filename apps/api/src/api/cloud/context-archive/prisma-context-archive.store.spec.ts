import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
import { PrismaContextArchiveStore } from './prisma-context-archive.store'

interface CloudSandboxRow {
  threadId: string
  workspaceContext: string | null
  workspaceContextArchive: Buffer | null
}

const fake = vi.hoisted(() => {
  const sandboxes: CloudSandboxRow[] = []

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
  }

  return { db, sandboxes }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const THREAD = 'brn_thread_1'

describe('PrismaContextArchiveStore', () => {
  let store: PrismaContextArchiveStore

  beforeEach(() => {
    fake.sandboxes.length = 0
    fake.db.cloudSandbox.findUnique.mockClear()
    fake.db.cloudSandbox.update.mockClear()
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
})
