import { Injectable } from '@nestjs/common'
import { db } from '../../db'
import { assertContextBundleWithinLimit } from '../sandboxes/workspace-spec'

@Injectable()
export class UserContextService {
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
}
