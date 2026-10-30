import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { EGrantRowStatus, McpOauthStore } from './mcp-oauth.types'
import type { AttemptFence, GrantRow, PendingRow } from './mcp-oauth.types'

const CLEARED_ATTEMPT = {
  refreshAttempt: null,
  refreshStartedAt: null,
} as const

const fenceWhere = (fence: AttemptFence) => ({
  id: fence.id,
  generation: fence.generation,
  refreshAttempt: fence.attemptId,
})

const GRANT_COLUMNS = [
  'id',
  'userId',
  'serverUrl',
  'status',
  'sealed',
  'generation',
  'refreshAttempt',
  'refreshStartedAt',
  'updatedAt',
] as const

const toGrantRow = <R extends { status: string }>(row: R): R & { status: EGrantRowStatus } => ({
  ...row,
  status: row.status === EGrantRowStatus.Active ? EGrantRowStatus.Active : EGrantRowStatus.Expired,
})

@Injectable()
export class PrismaMcpOauthStore implements McpOauthStore {
  async insertPending(row: PendingRow): Promise<void> {
    await db.orm.public.McpOauthPending.create(row)
  }

  async takePending(args: { id: string }): Promise<PendingRow | null> {
    const row = await db.orm.public.McpOauthPending.select(
      'id',
      'userId',
      'serverUrl',
      'sealed',
      'returnTo',
      'expiresAt',
    ).first({ id: args.id })
    if (row === null) return null
    const count = await db.orm.public.McpOauthPending.where({
      id: args.id,
    }).deleteAndCount()
    return count === 1 ? row : null
  }

  async findGrant(args: { userId: string; serverUrl: string }): Promise<GrantRow | null> {
    const row = await db.orm.public.McpOauthGrant.select(...GRANT_COLUMNS).first({
      userId: args.userId,
      serverUrl: args.serverUrl,
    })
    return row === null ? null : toGrantRow(row)
  }

  async findGrants(args: { userId: string; serverUrls: string[] }): Promise<GrantRow[]> {
    const rows = await db.orm.public.McpOauthGrant.where({ userId: args.userId })
      .select(...GRANT_COLUMNS)
      .all()
    const wanted = new Set(args.serverUrls)
    return rows.filter((row) => wanted.has(row.serverUrl)).map(toGrantRow)
  }

  async upsertGrant(args: { userId: string; serverUrl: string; sealed: string }): Promise<void> {
    const statement = db.raw.sql`INSERT INTO "McpOauthGrant"
        ("id", "userId", "serverUrl", "status", "sealed", "generation", "updatedAt")
      VALUES (${randomUUID()}, ${args.userId}, ${args.serverUrl}, ${EGrantRowStatus.Active}, ${args.sealed}, 0, now())
      ON CONFLICT ("userId", "serverUrl") DO UPDATE
      SET "sealed" = EXCLUDED."sealed",
          "status" = ${EGrantRowStatus.Active},
          "generation" = "McpOauthGrant"."generation" + 1,
          "refreshAttempt" = NULL,
          "refreshStartedAt" = NULL,
          "updatedAt" = now()`
      .affectedCount()
      .build()
    await db.execute(statement)
  }

  async claim(args: {
    id: string
    generation: number
    attemptId: string
    startedAt: Date
    staleBefore: Date
  }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "McpOauthGrant"
      SET "refreshAttempt" = ${args.attemptId}, "refreshStartedAt" = ${args.startedAt.toISOString()}::timestamptz
      WHERE "id" = ${args.id}
        AND "generation" = ${args.generation}
        AND "status" = ${EGrantRowStatus.Active}
        AND ("refreshAttempt" IS NULL OR "refreshStartedAt" < ${args.staleBefore.toISOString()}::timestamptz)`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }

  async complete(args: AttemptFence & { sealed: string }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "McpOauthGrant"
      SET "sealed" = ${args.sealed},
          "generation" = "generation" + 1,
          "refreshAttempt" = NULL,
          "refreshStartedAt" = NULL,
          "updatedAt" = now()
      WHERE "id" = ${args.id}
        AND "generation" = ${args.generation}
        AND "refreshAttempt" = ${args.attemptId}`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }

  async release(args: AttemptFence): Promise<boolean> {
    const count = await db.orm.public.McpOauthGrant.where(fenceWhere(args)).updateAndCount(
      CLEARED_ATTEMPT,
    )
    return count === 1
  }

  async reject(args: AttemptFence): Promise<boolean> {
    const count = await db.orm.public.McpOauthGrant.where(fenceWhere(args)).updateAndCount({
      status: EGrantRowStatus.Expired,
      ...CLEARED_ATTEMPT,
    })
    return count === 1
  }

  async deleteGrant(args: { userId: string; serverUrl: string }): Promise<void> {
    await db.orm.public.McpOauthGrant.where(args).deleteAndCount()
  }
}
