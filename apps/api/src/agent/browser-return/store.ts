import {
  EReturnSurface,
  returnPortOf,
  returnSurfaceOf,
  type ReturnTarget,
} from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

export const BROWSER_RETURN_COLUMNS = [
  'state',
  'flow',
  'userId',
  'surface',
  'port',
  'providerUrlSealed',
  'callbackPath',
  'webPath',
  'expiresAt',
] as const

export type BrowserReturnRow = {
  state: string
  flow: string
  userId: string | null
  surface: string
  port: number | null
  providerUrlSealed: string
  callbackPath: string
  webPath: string
  expiresAt: Date
}

export class BrowserReturnStore {
  constructor(private readonly db: Db) {}

  async insert(row: BrowserReturnRow): Promise<void> {
    const expired = this.db.raw.sql`DELETE FROM "BrowserReturnPending" WHERE "expiresAt" < now()`
      .affectedCount()
      .build()
    await this.db.execute(expired)
    await this.db.orm.public.BrowserReturnPending.create(row)
  }

  async findOpen(args: { state: string; now: Date }): Promise<BrowserReturnRow | null> {
    const row = await this.db.orm.public.BrowserReturnPending.select(
      ...BROWSER_RETURN_COLUMNS,
    ).first({ state: args.state })
    return row === null || row.expiresAt.getTime() <= args.now.getTime() ? null : row
  }

  async recordTarget(args: { state: string; target: ReturnTarget }): Promise<void> {
    await this.db.orm.public.BrowserReturnPending.where({ state: args.state }).updateAndCount({
      surface: args.target.surface,
      port: args.target.port ?? null,
    })
  }

  async take(args: { state: string }): Promise<BrowserReturnRow | null> {
    const row = await this.db.orm.public.BrowserReturnPending.select(
      ...BROWSER_RETURN_COLUMNS,
    ).first({ state: args.state })
    if (row === null) return null
    await this.db.orm.public.BrowserReturnPending.where({ state: args.state }).deleteAndCount()
    return row
  }
}

export const recordedTargetOf = (row: BrowserReturnRow | null): ReturnTarget =>
  row === null
    ? { surface: EReturnSurface.Web }
    : {
        surface: returnSurfaceOf(row.surface) ?? EReturnSurface.Web,
        port: returnPortOf(row.port),
      }
