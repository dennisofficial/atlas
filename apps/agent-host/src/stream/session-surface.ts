import type { Db } from '@dltech/atlas-db'

import type { SurfaceRecord } from './follow-types'

export const recordSessionSurface = (args: { db: Db; log?: (error: unknown) => void }) => {
  return (record: SurfaceRecord): void => {
    const statement = args.db.raw.sql`UPDATE "v2"."V2Session"
      SET "lastSurface" = ${record.surface}
      WHERE "id" = ${record.sessionId}
        AND "userId" = ${record.userId}
        AND "lastSurface" IS DISTINCT FROM ${record.surface}`
      .affectedCount()
      .build()
    args.db.execute(statement).catch((error: unknown) => args.log?.(error))
  }
}
