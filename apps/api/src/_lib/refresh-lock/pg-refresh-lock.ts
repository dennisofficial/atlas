import { db } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { InProcessRefreshLock, RefreshLock } from './refresh-lock'

@Injectable()
export class PgRefreshLock implements RefreshLock {
  private readonly local = new InProcessRefreshLock()

  run<T>(args: { key: string; work: () => Promise<T> }): Promise<T> {
    return this.local.run({
      key: args.key,
      work: () =>
        db.transaction(async (tx) => {
          const statement = tx.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${args.key}))`
            .affectedCount()
            .build()
          await tx.execute(statement)
          return args.work()
        }),
    })
  }
}
