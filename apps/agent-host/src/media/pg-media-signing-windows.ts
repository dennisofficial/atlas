import type { Db } from '@dltech/atlas-db'

import type { MediaSigningWindows, SigningWindowRow } from './media-signing-windows'

export class PgMediaSigningWindows implements MediaSigningWindows {
  constructor(private readonly db: Db) {}

  async find(windowStart: number): Promise<SigningWindowRow | null> {
    const row = await this.db.orm.v2.MediaSigningWindow.select('validUntil', 'sealed').first({
      windowStart: new Date(windowStart),
    })
    if (row === null) return null
    return { validUntil: row.validUntil.getTime(), sealed: row.sealed }
  }

  async insertIfAbsent(args: {
    windowStart: number
    validUntil: number
    sealed: string
  }): Promise<void> {
    const statement = this.db.raw.sql`INSERT INTO "v2"."MediaSigningWindow"
      ("windowStart", "validUntil", "sealed")
      VALUES (${new Date(args.windowStart).toISOString()}::timestamptz,
        ${new Date(args.validUntil).toISOString()}::timestamptz, ${args.sealed})
      ON CONFLICT ("windowStart") DO NOTHING`
      .affectedCount()
      .build()
    await this.db.execute(statement)
  }
}
