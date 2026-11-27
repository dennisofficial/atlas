import type { Db } from '@dltech/atlas-db'

import { PENDING_COLUMNS, pendingOf } from './store'
import type { McpReturnSurface, PendingRow } from './types'

export class PendingSurfaceStore {
  constructor(private readonly db: Db) {}

  async findOpen(args: { id: string }): Promise<PendingRow | null> {
    const row = await this.db.orm.public.McpOauthPending.select(
      ...PENDING_COLUMNS,
      'completedAt',
    ).first({ id: args.id })
    return row === null || row.completedAt !== null ? null : pendingOf(row)
  }

  async record(args: { id: string; surface: McpReturnSurface }): Promise<void> {
    const statement = this.db.raw.sql`UPDATE "McpOauthPending"
      SET "returnSurface" = ${args.surface}
      WHERE "id" = ${args.id}
        AND "completedAt" IS NULL`
      .affectedCount()
      .build()
    await this.db.execute(statement)
  }
}
