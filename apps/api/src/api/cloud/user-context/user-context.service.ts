import { Inject, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { assertArchiveWithinLimit } from '../context-archive/context-archive-limits'
import { CONTEXT_ARCHIVE_STORE } from '../context-archive/context-archive.store'
import type { ContextArchiveStore } from '../context-archive/context-archive.store'
import { assertContextBundleWithinLimit } from '../../platform/sandboxes/workspace-spec'
import { USER_MEMORY_ENTRY_STORE } from './memory-entry.store'
import type { UserMemoryEntryStore } from './memory-entry.store'
import { buildMemoryArchive, extractMemoryArchive } from './memory-archive'

@Injectable()
export class UserContextService {
  constructor(
    @Inject(CONTEXT_ARCHIVE_STORE) private readonly archives: ContextArchiveStore,
    @Inject(USER_MEMORY_ENTRY_STORE) private readonly memoryEntries: UserMemoryEntryStore,
  ) {}

  async getMemory(args: { userId: string }): Promise<string | null> {
    const row = await db.userContextSync.findUnique({ where: { userId: args.userId } })
    return row?.memoryBundle ?? null
  }

  async putMemory(args: { userId: string; bundle: string }): Promise<void> {
    assertContextBundleWithinLimit({ bundle: args.bundle })
    await db.userContextSync.upsert({
      where: { userId: args.userId },
      create: { userId: args.userId, memoryBundle: args.bundle },
      update: { memoryBundle: args.bundle },
    })
  }

  async deleteMemory(args: { userId: string }): Promise<void> {
    await this.memoryEntries.deleteEntries({ userId: args.userId })
    await this.archives.deleteUserArchive({ userId: args.userId })
    await db.userContextSync.deleteMany({ where: { userId: args.userId } })
  }

  async getMemoryArchive(args: { userId: string }): Promise<Buffer | null> {
    const entries = await this.memoryEntries.listEntries({ userId: args.userId })
    if (entries.length > 0) return buildMemoryArchive({ entries })
    return this.archives.readUserArchive({ userId: args.userId })
  }

  async putMemoryArchive(args: { userId: string; archive: Buffer }): Promise<void> {
    assertArchiveWithinLimit({ bytes: args.archive.byteLength })
    const entries = await extractMemoryArchive({ archive: args.archive })
    await this.memoryEntries.mergeEntries({ userId: args.userId, entries })
  }
}
