import { ConflictException, Injectable } from '@nestjs/common'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import { hashSessionToken } from '../sandboxes/sandbox-tokens'

const TAKEN_MESSAGE = 'this pod token is already in use by another credential'

@Injectable()
export class PodLeasesService {
  async register(args: { userId: string; threadId: string; token: string }): Promise<void> {
    const tokenHash = hashSessionToken(args.token)
    const sandbox = await db.orm.public.CloudSandbox.where({ tokenHash }).select('id').first()
    if (sandbox !== null) throw new ConflictException(TAKEN_MESSAGE)
    try {
      await db.orm.public.LocalPodLease.upsert({
        create: { userId: args.userId, threadId: args.threadId, tokenHash },
        update: { tokenHash },
        conflictOn: { userId: args.userId, threadId: args.threadId },
      })
    } catch (failure) {
      if (isUniqueViolation(failure)) {
        throw new ConflictException(TAKEN_MESSAGE)
      }
      throw failure
    }
  }

  async release(args: { userId: string; threadId: string }): Promise<void> {
    await db.orm.public.LocalPodLease.where({
      userId: args.userId,
      threadId: args.threadId,
    }).deleteAndCount()
  }
}
