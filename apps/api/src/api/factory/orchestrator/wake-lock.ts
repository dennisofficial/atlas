import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'

/**
 * A wake may be driven by two instances at once for the whole of a rolling deploy, so the guard
 * cannot live in process memory. A Postgres advisory lock serializes on the database instead: the
 * lock is held by the session and released automatically when the connection or transaction dies,
 * which is exactly the semantics an OOM-killed or replaced container needs — kill the instance and
 * the next one (or the boot scan) picks the work item straight back up.
 *
 * The key is derived from the work item id rather than the id itself so the 64-bit lock space is
 * stable for this purpose without trusting an arbitrary string to hash well.
 */
export const WAKE_LOCK_NAMESPACE = 0x7a6b

export async function wakeLockKeyOf(args: {
  queryRaw: (query: string, id: string) => Promise<readonly { key: string }[]>
  workItemId: string
}): Promise<bigint> {
  const rows = await args.queryRaw(
    'SELECT (("x" || substr(md5($1), 1, 15))::bit(60)::bigint) AS key',
    args.workItemId,
  )
  const row = rows[0]
  if (row === undefined) throw new Error('could not derive a wake lock key')
  return BigInt(row.key)
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
    const key = await wakeLockKeyOf({
      workItemId: args.workItemId,
      queryRaw: (query, id) => db.$queryRawUnsafe<{ key: string }[]>(query, id),
    })

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
