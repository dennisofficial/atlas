import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import type {
  NewMemoryEntry,
  StoredMemoryEntry,
  UserMemoryEntryStore,
} from './memory-entry.store'

const toBytesInput = (buffer: Buffer): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return bytes
}

@Injectable()
export class PrismaUserMemoryEntryStore implements UserMemoryEntryStore {
  async listEntries(args: { userId: string }): Promise<readonly StoredMemoryEntry[]> {
    const rows = await db.userMemoryEntry.findMany({
      where: { userId: args.userId },
      select: { key: true, content: true, mtimeMs: true },
    })
    return rows.map((row) => ({
      key: row.key,
      content: Buffer.from(row.content),
      mtimeMs: row.mtimeMs,
    }))
  }

  async mergeEntries(args: { userId: string; entries: readonly NewMemoryEntry[] }): Promise<void> {
    if (args.entries.length === 0) return
    const keys = args.entries.map((entry) => entry.key)
    const stored = await db.userMemoryEntry.findMany({
      where: { userId: args.userId, key: { in: keys } },
      select: { key: true, mtimeMs: true },
    })
    const storedMtimeByKey = new Map(stored.map((row) => [row.key, row.mtimeMs]))

    const winners = args.entries.filter((entry) => {
      const storedMtime = storedMtimeByKey.get(entry.key)
      return storedMtime === undefined || storedMtime <= BigInt(entry.mtimeMs)
    })
    if (winners.length === 0) return

    await db.$transaction(
      winners.map((entry) =>
        db.userMemoryEntry.upsert({
          where: { userId_key: { userId: args.userId, key: entry.key } },
          create: {
            userId: args.userId,
            key: entry.key,
            content: toBytesInput(entry.content),
            mtimeMs: BigInt(entry.mtimeMs),
          },
          update: { content: toBytesInput(entry.content), mtimeMs: BigInt(entry.mtimeMs) },
        }),
      ),
    )
  }

  async deleteEntries(args: { userId: string }): Promise<void> {
    await db.userMemoryEntry.deleteMany({ where: { userId: args.userId } })
  }
}
