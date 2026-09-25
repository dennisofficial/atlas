import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'

/**
 * A wake may be driven by two instances at once for the whole of a rolling deploy, so the guard
 * cannot live in process memory. A Postgres advisory lock serializes on the database instead: the
 * lock is held by the session and released automatically when the connection or transaction dies,
 * which is exactly the semantics an OOM-killed or replaced container needs — kill the instance and
 * the next one (or the boot scan) picks the work item straight back up.
 */
export const WAKE_LOCK_NAMESPACE = 0x7a6b

/**
 * The 64-bit lock key is the low 60 bits of the work item id's sha256, derived in-process so the
 * lock needs no extra round trip and stays clear of the driver's raw-query quirks. The namespace
 * keeps these locks disjoint from any other advisory-lock user.
 */
export function wakeLockKeyOf(args: { workItemId: string }): bigint {
  const digest = createHash('sha256').update(args.workItemId).digest()
  let key = 0n
  for (let index = 0; index < 8; index += 1) {
    key = (key << 8n) | BigInt(digest[index] ?? 0)
  }
  return key & 0x0fffffffffffffffn
}

@Injectable()
export class WakeLockService {
  private readonly logger = new Logger(WakeLockService.name)

  /**
   * Runs `drive` holding the advisory lock for the work item, in a transaction so the lock is held
   * for the whole drive and dropped the moment it returns or the connection dies. A second instance
   * that finds the lock taken skips rather than double-driving; the boot scan is what re-picks a
   * wake whose driver died holding it.
   */
  async runExclusive<T>(args: {
    workItemId: string
    drive: () => Promise<T>
  }): Promise<{ ran: boolean; result?: T }> {
    const key = wakeLockKeyOf({ workItemId: args.workItemId })

    return db.$transaction(
      async (tx) => {
        const acquired = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          'SELECT pg_try_advisory_xact_lock($1, $2) AS locked',
          WAKE_LOCK_NAMESPACE,
          key,
        )
        if (acquired[0]?.locked !== true) {
          this.logger.log(`wake for work item ${args.workItemId} is already being driven elsewhere`)
          return { ran: false }
        }
        return { ran: true, result: await args.drive() }
      },
      { timeout: 120_000 },
    )
  }
}
