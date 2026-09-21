import { Injectable } from '@nestjs/common'
import { db } from '../../db'
import type { ContextArchiveStore } from './context-archive.store'

/**
 * `UserContextSync.memoryBundle` predates the archive column and is `NOT NULL`. A brand-new row
 * created by an archive-only write (a client that has never sent the legacy JSON bundle) still
 * needs a value there; `'{}'` is a valid empty bundle in that JSON shape, so a legacy reader
 * sees "no entries yet" rather than failing to parse.
 */
const EMPTY_MEMORY_BUNDLE = '{}'

/**
 * Prisma 7's generated types declare a `Bytes` column as a plain `Uint8Array<ArrayBuffer>`,
 * not Node's `Buffer` — but the pg driver adapter hands back a real `Buffer` at runtime, and
 * `Buffer.from`/`new Uint8Array` copy without caring which one they started from.
 */
const toBytesInput = (buffer: Buffer): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return bytes
}
const toBuffer = (bytes: Uint8Array | null): Buffer | null => (bytes === null ? null : Buffer.from(bytes))

@Injectable()
export class PrismaContextArchiveStore implements ContextArchiveStore {
  async readSandboxArchive(args: { threadId: string }): Promise<Buffer | null> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { workspaceContextArchive: true },
    })
    return toBuffer(row?.workspaceContextArchive ?? null)
  }

  async writeSandboxArchive(args: { threadId: string; archive: Buffer }): Promise<void> {
    await db.cloudSandbox.update({
      where: { threadId: args.threadId },
      data: { workspaceContextArchive: toBytesInput(args.archive) },
    })
  }

  async readUserArchive(args: { userId: string }): Promise<Buffer | null> {
    const row = await db.userContextSync.findUnique({
      where: { userId: args.userId },
      select: { memoryArchive: true },
    })
    return toBuffer(row?.memoryArchive ?? null)
  }

  async writeUserArchive(args: { userId: string; archive: Buffer }): Promise<void> {
    await db.userContextSync.upsert({
      where: { userId: args.userId },
      create: {
        userId: args.userId,
        memoryBundle: EMPTY_MEMORY_BUNDLE,
        memoryArchive: toBytesInput(args.archive),
      },
      update: { memoryArchive: toBytesInput(args.archive) },
    })
  }
}
