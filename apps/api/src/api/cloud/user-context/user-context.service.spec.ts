import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { PayloadTooLargeException } from '@nestjs/common'

const execFileAsync = promisify(execFile)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'
import { MAX_CONTEXT_ARCHIVE_BYTES } from '../context-archive/context-archive-limits'
import type { ContextArchiveStore } from '../context-archive/context-archive.store'
import { MAX_CONTEXT_BUNDLE_BYTES } from '../../platform/sandboxes/workspace-spec'
import { UserContextService } from './user-context.service'
import type { NewMemoryEntry, UserMemoryEntryStore } from './memory-entry.store'
import { extractMemoryArchive } from './memory-archive'

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
      deleteMany: async (args: { where: { userId: string } }) => {
        const kept = rows.filter((row) => row.userId !== args.where.userId)
        const count = rows.length - kept.length
        rows.splice(0, rows.length, ...kept)
        return { count }
      },
    },
  }

  return { db, rows }
})

vi.mock('../../../db', () => ({ db: fake.db as unknown as PrismaClient }))

const USER_A = 'user-a'
const USER_B = 'user-b'

const makeArchive = async (
  files: readonly { key: string; content: string; mtimeMs: number }[],
): Promise<Buffer> => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-memory-spec-'))
  try {
    for (const file of files) {
      const path = join(dir, file.key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, file.content)
      const mtime = new Date(file.mtimeMs)
      await utimes(path, mtime, mtime)
    }
    const archivePath = join(dir, 'archive.tar.gz')
    await execFileAsync('tar', ['-czf', archivePath, '-C', dir, ...files.map((file) => file.key)])
    return await readFile(archivePath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const stubArchives = () => {
  const archives = new Map<string, Buffer>()
  return {
    readUserArchive: vi.fn(async (args: { userId: string }) => archives.get(args.userId) ?? null),
    writeUserArchive: vi.fn(async (args: { userId: string; archive: Buffer }) => {
      archives.set(args.userId, args.archive)
    }),
    deleteUserArchive: vi.fn(async (args: { userId: string }) => {
      archives.delete(args.userId)
    }),
    readSandboxArchive: vi.fn(async () => null),
    writeSandboxArchive: vi.fn(async () => undefined),
  }
}

const stubMemoryEntries = () => {
  const entries = new Map<
    string,
    { userId: string; key: string; content: Buffer; mtimeMs: bigint }
  >()
  const store: UserMemoryEntryStore = {
    listEntries: async (args: { userId: string }) =>
      [...entries.values()].filter((entry) => entry.userId === args.userId),
    mergeEntries: async (args: { userId: string; entries: readonly NewMemoryEntry[] }) => {
      for (const entry of args.entries) {
        const stored = entries.get(`${args.userId}:${entry.key}`)
        if (stored !== undefined && stored.mtimeMs > BigInt(entry.mtimeMs)) continue
        entries.set(`${args.userId}:${entry.key}`, {
          userId: args.userId,
          key: entry.key,
          content: entry.content,
          mtimeMs: BigInt(entry.mtimeMs),
        })
      }
    },
    deleteEntries: async (args: { userId: string }) => {
      for (const [mapKey, entry] of [...entries.entries()]) {
        if (entry.userId === args.userId) entries.delete(mapKey)
      }
    },
  }
  return { store, entries }
}

describe('UserContextService', () => {
  let archives: ReturnType<typeof stubArchives>
  let memoryEntries: ReturnType<typeof stubMemoryEntries>
  let service: UserContextService

  beforeEach(() => {
    fake.rows.length = 0
    archives = stubArchives()
    memoryEntries = stubMemoryEntries()
    service = new UserContextService(
      archives as unknown as ContextArchiveStore,
      memoryEntries.store,
    )
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

  it('merges an incoming memory archive per key, newer mtime winning', async () => {
    memoryEntries.entries.set(`${USER_A}:user/older.md`, {
      userId: USER_A,
      key: 'user/older.md',
      content: Buffer.from('stored-newer'),
      mtimeMs: 2000n,
    })
    memoryEntries.entries.set(`${USER_A}:user/newer.md`, {
      userId: USER_A,
      key: 'user/newer.md',
      content: Buffer.from('stored-older'),
      mtimeMs: 1000n,
    })
    const archive = await makeArchive([
      { key: 'user/older.md', content: 'incoming-older', mtimeMs: 1000 },
      { key: 'user/newer.md', content: 'incoming-newer', mtimeMs: 3000 },
      { key: 'project/atlas/fresh.md', content: 'incoming-fresh', mtimeMs: 1500 },
    ])

    await service.putMemoryArchive({ userId: USER_A, archive })

    expect(memoryEntries.entries.get(`${USER_A}:user/older.md`)?.content.toString()).toBe(
      'stored-newer',
    )
    expect(memoryEntries.entries.get(`${USER_A}:user/newer.md`)?.content.toString()).toBe(
      'incoming-newer',
    )
    expect(memoryEntries.entries.get(`${USER_A}:project/atlas/fresh.md`)?.content.toString()).toBe(
      'incoming-fresh',
    )
    expect(archives.writeUserArchive).not.toHaveBeenCalled()
  })

  it('never deletes stored keys the incoming archive does not carry', async () => {
    memoryEntries.entries.set(`${USER_A}:project/other/kept.md`, {
      userId: USER_A,
      key: 'project/other/kept.md',
      content: Buffer.from('kept'),
      mtimeMs: 1000n,
    })
    const archive = await makeArchive([{ key: 'user/one.md', content: 'one', mtimeMs: 1000 }])

    await service.putMemoryArchive({ userId: USER_A, archive })

    expect(memoryEntries.entries.get(`${USER_A}:project/other/kept.md`)).toBeDefined()
    expect(memoryEntries.entries.get(`${USER_A}:user/one.md`)).toBeDefined()
  })

  it('builds an archive from stored entries with their keys and mtimes when any exist', async () => {
    memoryEntries.entries.set(`${USER_A}:user/a.md`, {
      userId: USER_A,
      key: 'user/a.md',
      content: Buffer.from('alpha'),
      mtimeMs: 1710000000000n,
    })
    memoryEntries.entries.set(`${USER_A}:project/atlas/b.md`, {
      userId: USER_A,
      key: 'project/atlas/b.md',
      content: Buffer.from('beta'),
      mtimeMs: 1710000001000n,
    })

    const built = await service.getMemoryArchive({ userId: USER_A })

    expect(built).not.toBeNull()
    const roundTripped = await extractMemoryArchive({ archive: built ?? Buffer.alloc(0) })
    const byKey = new Map(roundTripped.map((entry) => [entry.key, entry]))
    expect(byKey.get('user/a.md')?.content.toString()).toBe('alpha')
    expect(byKey.get('project/atlas/b.md')?.content.toString()).toBe('beta')
    expect(Math.floor((byKey.get('user/a.md')?.mtimeMs ?? 0) / 1000)).toBe(1710000000)
    expect(Math.floor((byKey.get('project/atlas/b.md')?.mtimeMs ?? 0) / 1000)).toBe(1710000001)
    expect(archives.readUserArchive).not.toHaveBeenCalled()
  })

  it('falls back to the legacy archive blob when the entry table is empty', async () => {
    const legacy = Buffer.from('legacy-tar-gz-bytes')
    await archives.writeUserArchive({ userId: USER_A, archive: legacy })

    await expect(service.getMemoryArchive({ userId: USER_A })).resolves.toEqual(legacy)
  })

  it('answers null from getMemoryArchive when nothing has ever been archived', async () => {
    await expect(service.getMemoryArchive({ userId: USER_A })).resolves.toBeNull()
  })

  it('rejects a memory archive over the sanity cap', async () => {
    await expect(
      service.putMemoryArchive({
        userId: USER_A,
        archive: { byteLength: MAX_CONTEXT_ARCHIVE_BYTES + 1 } as unknown as Buffer,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException)
    expect(archives.writeUserArchive).not.toHaveBeenCalled()
  })

  it('delete removes the row outright', async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"a":1}' })

    await service.deleteMemory({ userId: USER_A })

    expect(await service.getMemory({ userId: USER_A })).toBeNull()
    expect(fake.rows).toHaveLength(0)
  })

  it('delete tolerates a user who never synced', async () => {
    await expect(service.deleteMemory({ userId: USER_A })).resolves.toBeUndefined()
    expect(fake.rows).toHaveLength(0)
  })

  it('delete clears the entry rows and nulls the legacy archive alongside the sync row', async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"a":1}' })
    await archives.writeUserArchive({ userId: USER_A, archive: Buffer.from('legacy') })
    memoryEntries.entries.set(`${USER_A}:user/a.md`, {
      userId: USER_A,
      key: 'user/a.md',
      content: Buffer.from('alpha'),
      mtimeMs: 1000n,
    })

    await service.deleteMemory({ userId: USER_A })

    expect(memoryEntries.entries.size).toBe(0)
    await expect(service.getMemoryArchive({ userId: USER_A })).resolves.toBeNull()
    expect(fake.rows).toHaveLength(0)
  })

  it("delete leaves the other users' rows in place", async () => {
    await service.putMemory({ userId: USER_A, bundle: '{"a":1}' })
    await service.putMemory({ userId: USER_B, bundle: '{"b":1}' })

    await service.deleteMemory({ userId: USER_A })

    expect(await service.getMemory({ userId: USER_B })).toBe('{"b":1}')
    expect(fake.rows).toHaveLength(1)
  })
})
