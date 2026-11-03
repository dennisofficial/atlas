import { randomUUID } from 'node:crypto'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { EMcpServerSource } from '@dltech/atlas-wire'
import { EGrantRowStatus, McpOauthStore } from './mcp-oauth.types'
import type { AttemptFence, PendingRow, ServerGrantRow } from './mcp-oauth.types'

const REPO_SEEN_BUMP_MS = 3_600_000

const CLEARED_ATTEMPT = {
  oauthRefreshAttempt: null,
  oauthRefreshStartedAt: null,
} as const

const fenceWhere = (fence: AttemptFence) => ({
  id: fence.id,
  oauthGeneration: fence.generation,
  oauthRefreshAttempt: fence.attemptId,
})

const SERVER_COLUMNS = [
  'id',
  'userId',
  'projectId',
  'name',
  'source',
  'sealedSpec',
  'repoUrl',
  'lastSeenAt',
  'oauthServerUrl',
  'oauthSealed',
  'oauthStatus',
  'oauthGeneration',
  'oauthRefreshAttempt',
  'oauthRefreshStartedAt',
  'oauthUpdatedAt',
] as const

const toServerGrantRow = <
  R extends { source: string; oauthStatus: string | null } & Omit<
    ServerGrantRow,
    'source' | 'oauthStatus'
  >,
>(
  row: R,
): ServerGrantRow => ({
  ...row,
  source: row.source === 'repo' ? EMcpServerSource.Repo : EMcpServerSource.Cloud,
  oauthStatus:
    row.oauthStatus === EGrantRowStatus.Active
      ? EGrantRowStatus.Active
      : row.oauthStatus === EGrantRowStatus.Expired
        ? EGrantRowStatus.Expired
        : null,
})

const scopeOf = (args: {
  userId?: string | undefined
  projectId?: string | undefined
}): { userId: string } | { projectId: string } =>
  args.projectId === undefined ? { userId: args.userId ?? '' } : { projectId: args.projectId }

@Injectable()
export class PrismaMcpOauthStore implements McpOauthStore {
  async insertPending(row: PendingRow): Promise<void> {
    await db.orm.public.McpOauthPending.create({
      id: row.id,
      userId: row.userId,
      serverUrl: row.serverUrl,
      sealed: row.sealed,
      returnTo: row.returnTo,
      expiresAt: row.expiresAt,
      ...(row.mcpServerId === null ? {} : { mcpServerId: row.mcpServerId }),
    })
  }

  async takePending(args: { id: string }): Promise<PendingRow | null> {
    const row = await db.orm.public.McpOauthPending.select(
      'id',
      'userId',
      'serverUrl',
      'sealed',
      'returnTo',
      'expiresAt',
      'mcpServerId',
    ).first({ id: args.id })
    if (row === null) return null
    const count = await db.orm.public.McpOauthPending.where({
      id: args.id,
    }).deleteAndCount()
    return count === 1 ? row : null
  }

  async findServer(args: { id: string }): Promise<ServerGrantRow | null> {
    const row = await db.orm.public.McpServer.select(...SERVER_COLUMNS).first({ id: args.id })
    return row === null ? null : toServerGrantRow(row)
  }

  async listServers(args: {
    userId?: string | undefined
    projectId?: string | undefined
  }): Promise<ServerGrantRow[]> {
    const rows = await db.orm.public.McpServer.select(...SERVER_COLUMNS)
      .where(scopeOf(args))
      .orderBy((row) => row.source.asc())
      .orderBy((row) => row.name.asc())
      .all()
    return rows.map((row) => toServerGrantRow(row))
  }

  async findByName(args: {
    userId?: string | undefined
    projectId?: string | undefined
    source: EMcpServerSource
    name: string
  }): Promise<ServerGrantRow | null> {
    const row = await db.orm.public.McpServer.select(...SERVER_COLUMNS).first({
      ...scopeOf(args),
      source: args.source,
      name: args.name,
    })
    return row === null ? null : toServerGrantRow(row)
  }

  async touchRepoServer(args: {
    userId?: string | undefined
    projectId?: string | undefined
    name: string
    url: string
    now: Date
  }): Promise<ServerGrantRow> {
    const key = { ...scopeOf(args), source: EMcpServerSource.Repo, name: args.name }
    let existing = await db.orm.public.McpServer.first(key)
    if (existing === null) {
      try {
        const row = await db.orm.public.McpServer.create({
          id: `rmcp_${randomUUID()}`,
          ...key,
          repoUrl: args.url,
          lastSeenAt: args.now,
        })
        const selected = await this.findServer({ id: row.id })
        if (selected === null) throw new Error('repo server vanished after create')
        return selected
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        existing = await db.orm.public.McpServer.first(key)
        if (existing === null) throw error
      }
    }
    const seenStale =
      existing.lastSeenAt !== null &&
      existing.lastSeenAt.getTime() < args.now.getTime() - REPO_SEEN_BUMP_MS
    const update = {
      ...(existing.repoUrl === args.url ? {} : { repoUrl: args.url }),
      ...(seenStale ? { lastSeenAt: args.now } : {}),
    }
    if (Object.keys(update).length > 0) {
      await db.orm.public.McpServer.where({ id: existing.id }).updateAndCount(update)
    }
    const selected = await this.findServer({ id: existing.id })
    if (selected === null) throw new Error('repo server vanished after touch')
    return selected
  }

  async projectOwner(args: { projectId: string }): Promise<string | null> {
    const row = await db.orm.public.Project.select('ownerUserId').first({ id: args.projectId })
    return row?.ownerUserId ?? null
  }

  async writeGrant(args: { id: string; serverUrl: string; sealed: string }): Promise<void> {
    const statement = db.raw.sql`UPDATE "McpServer"
      SET "oauthServerUrl" = ${args.serverUrl},
          "oauthSealed" = ${args.sealed},
          "oauthStatus" = ${EGrantRowStatus.Active},
          "oauthGeneration" = "oauthGeneration" + 1,
          "oauthRefreshAttempt" = NULL,
          "oauthRefreshStartedAt" = NULL,
          "oauthUpdatedAt" = now()
      WHERE "id" = ${args.id}`
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
    const statement = db.raw.sql`UPDATE "McpServer"
      SET "oauthRefreshAttempt" = ${args.attemptId}, "oauthRefreshStartedAt" = ${args.startedAt.toISOString()}::timestamptz
      WHERE "id" = ${args.id}
        AND "oauthGeneration" = ${args.generation}
        AND "oauthStatus" = ${EGrantRowStatus.Active}
        AND ("oauthRefreshAttempt" IS NULL OR "oauthRefreshStartedAt" < ${args.staleBefore.toISOString()}::timestamptz)`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }

  async complete(args: AttemptFence & { sealed: string }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "McpServer"
      SET "oauthSealed" = ${args.sealed},
          "oauthGeneration" = "oauthGeneration" + 1,
          "oauthRefreshAttempt" = NULL,
          "oauthRefreshStartedAt" = NULL,
          "oauthUpdatedAt" = now()
      WHERE "id" = ${args.id}
        AND "oauthGeneration" = ${args.generation}
        AND "oauthRefreshAttempt" = ${args.attemptId}`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }

  async release(args: AttemptFence): Promise<boolean> {
    const count = await db.orm.public.McpServer.where(fenceWhere(args)).updateAndCount(
      CLEARED_ATTEMPT,
    )
    return count === 1
  }

  async reject(args: AttemptFence): Promise<boolean> {
    const count = await db.orm.public.McpServer.where(fenceWhere(args)).updateAndCount({
      oauthStatus: EGrantRowStatus.Expired,
      ...CLEARED_ATTEMPT,
    })
    return count === 1
  }

  async clearGrant(args: { id: string }): Promise<void> {
    await db.orm.public.McpServer.where({ id: args.id }).updateAndCount({
      oauthServerUrl: null,
      oauthSealed: null,
      oauthStatus: null,
      oauthRefreshAttempt: null,
      oauthRefreshStartedAt: null,
      oauthUpdatedAt: null,
    })
  }

  async deleteRepoServer(args: { id: string }): Promise<void> {
    await db.orm.public.McpServer.where({
      id: args.id,
      source: EMcpServerSource.Repo,
    }).deleteAndCount()
  }
}
