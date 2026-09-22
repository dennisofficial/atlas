import { Inject, Injectable } from '@nestjs/common'
import { db } from '../../db'
import { assertArchiveWithinLimit } from '../context-archive/context-archive-limits'
import { CONTEXT_ARCHIVE_STORE } from '../context-archive/context-archive.store'
import type { ContextArchiveStore } from '../context-archive/context-archive.store'
import { assertContextBundleWithinLimit } from '../sandboxes/workspace-spec'

@Injectable()
export class UserContextService {
  constructor(@Inject(CONTEXT_ARCHIVE_STORE) private readonly archives: ContextArchiveStore) {}

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
    await db.userContextSync.deleteMany({ where: { userId: args.userId } })
  }

  getMemoryArchive(args: { userId: string }): Promise<Buffer | null> {
    return this.archives.readUserArchive({ userId: args.userId })
  }

  async putMemoryArchive(args: { userId: string; archive: Buffer }): Promise<void> {
    assertArchiveWithinLimit({ bytes: args.archive.byteLength })
    await this.archives.writeUserArchive({ userId: args.userId, archive: args.archive })
  }
}
