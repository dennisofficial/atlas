import { ConflictException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import { hashSessionToken } from '../sandboxes/sandbox-tokens'

const UNIQUE_VIOLATION = 'P2002'
const TAKEN_MESSAGE = 'this pod token is already in use by another credential'

const isUniqueViolation = (failure: unknown): boolean =>
  failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === UNIQUE_VIOLATION

@Injectable()
export class PodLeasesService {
  async register(args: { userId: string; threadId: string; token: string }): Promise<void> {
    const tokenHash = hashSessionToken(args.token)
    const sandbox = await db.cloudSandbox.findFirst({ where: { tokenHash }, select: { id: true } })
    if (sandbox !== null) throw new ConflictException(TAKEN_MESSAGE)
    try {
      await db.localPodLease.upsert({
        where: { userId_threadId: { userId: args.userId, threadId: args.threadId } },
        create: { userId: args.userId, threadId: args.threadId, tokenHash },
        update: { tokenHash },
      })
    } catch (failure) {
      if (isUniqueViolation(failure)) {
        throw new ConflictException(TAKEN_MESSAGE)
      }
      throw failure
    }
  }

  async release(args: { userId: string; threadId: string }): Promise<void> {
    await db.localPodLease.deleteMany({
      where: { userId: args.userId, threadId: args.threadId },
    })
  }
}
