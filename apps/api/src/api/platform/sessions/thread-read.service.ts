import { Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { ownedThread } from './ownership'
import { ThreadSignalsService } from './thread-signals.service'

export const nextReadSeq = (args: {
  existing: number | undefined
  seq: number
  head: number
}): number => {
  const target = Math.min(args.seq, args.head)
  const { existing } = args
  if (existing === undefined) return target
  return existing <= args.head ? Math.max(existing, target) : target
}

@Injectable()
export class ThreadReadService {
  constructor(private readonly signals: ThreadSignalsService) {}

  async markRead(args: { userId: string; threadId: string; seq: number }): Promise<void> {
    const { userId, threadId } = args
    const changed = await db.transaction(async (tx) => {
      const thread = await ownedThread({ reader: tx, userId, threadId })
      const existing = await tx.orm.public.ThreadRead.where({ userId, threadId }).first()
      const seq = nextReadSeq({ existing: existing?.seq, seq: args.seq, head: thread.head })
      await tx.orm.public.ThreadRead.upsert({
        create: { userId, threadId, seq, updatedAt: new Date() },
        update: { seq, updatedAt: new Date() },
        conflictOn: { userId, threadId },
      })
      return seq !== existing?.seq
    })
    if (changed) await this.signals.listChanged({ userId, threadId })
  }
}
