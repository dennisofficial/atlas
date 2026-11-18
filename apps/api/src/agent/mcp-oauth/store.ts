import { randomUUID } from 'node:crypto'

import { isUniqueViolation, type Db } from '@dltech/atlas-db'

import { surfaceOf } from './redirect'
import type { AttemptFence, McpServerGrantRow, PendingRow } from './types'

const REPO_SEEN_BUMP_MS = 3_600_000

const ACTIVE = 'active'

const CLEARED_ATTEMPT = { oauthRefreshAttempt: null, oauthRefreshStartedAt: null } as const

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

const scopeOf = (args: { userId?: string | undefined; projectId?: string | undefined }) =>
  args.projectId === undefined ? { userId: args.userId ?? '' } : { projectId: args.projectId }

export class McpOauthStore {
  constructor(private readonly db: Db) {}

  async insertPending(row: PendingRow): Promise<void> {
    await this.db.orm.public.McpOauthPending.create({
      id: row.id,
      userId: row.userId,
      serverUrl: row.serverUrl,
      sealed: row.sealed,
      returnTo: row.returnTo,
      returnSurface: row.surface,
      expiresAt: row.expiresAt,
      ...(row.mcpServerId === null ? {} : { mcpServerId: row.mcpServerId }),
    })
  }

  async takePending(args: { id: string }): Promise<PendingRow | null> {
    const row = await this.db.orm.public.McpOauthPending.select(
      'id',
      'userId',
      'serverUrl',
      'sealed',
      'returnTo',
      'returnSurface',
      'expiresAt',
      'mcpServerId',
    ).first({ id: args.id })
    if (row === null) return null
    const count = await this.db.orm.public.McpOauthPending.where({
      id: args.id,
    }).deleteAndCount()
    if (count !== 1) return null
    const { returnSurface, ...rest } = row
    return { ...rest, surface: surfaceOf(returnSurface) }
  }

  find({ id }: { id: string }): Promise<McpServerGrantRow | null> {
    return this.db.orm.public.McpServer.select(...SERVER_COLUMNS).first({ id })
  }

  findByName(args: {
    userId?: string | undefined
    projectId?: string | undefined
    source: 'cloud' | 'repo'
    name: string
  }): Promise<McpServerGrantRow | null> {
    return this.db.orm.public.McpServer.select(...SERVER_COLUMNS).first({
      ...scopeOf(args),
      source: args.source,
      name: args.name,
    })
  }

  async touchRepoServer(args: {
    userId?: string | undefined
    projectId?: string | undefined
    name: string
    url: string
    now: Date
  }): Promise<McpServerGrantRow> {
    const key = { ...scopeOf(args), source: 'repo' as const, name: args.name }
    let existing = await this.db.orm.public.McpServer.first(key)
    if (existing === null) {
      try {
        const created = await this.db.orm.public.McpServer.create({
          id: `rmcp_${randomUUID()}`,
          ...key,
          repoUrl: args.url,
          lastSeenAt: args.now,
        })
        const selected = await this.find({ id: created.id })
        if (selected === null) throw new Error('repo server vanished after create')
        return selected
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        existing = await this.db.orm.public.McpServer.first(key)
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
      await this.db.orm.public.McpServer.where({ id: existing.id }).updateAndCount(update)
    }
    const selected = await this.find({ id: existing.id })
    if (selected === null) throw new Error('repo server vanished after touch')
    return selected
  }

  async projectOwner(args: { projectId: string }): Promise<string | null> {
    const row = await this.db.orm.public.Project.select('ownerUserId').first({ id: args.projectId })
    return row?.ownerUserId ?? null
  }

  async writeGrant(args: {
    id: string
    generation: number
    serverUrl: string
    sealed: string
  }): Promise<boolean> {
    const statement = this.db.raw.sql`UPDATE "McpServer"
      SET "oauthServerUrl" = ${args.serverUrl},
          "oauthSealed" = ${args.sealed},
          "oauthStatus" = ${ACTIVE},
          "oauthGeneration" = "oauthGeneration" + 1,
          "oauthRefreshAttempt" = NULL,
          "oauthRefreshStartedAt" = NULL,
          "oauthUpdatedAt" = now()
      WHERE "id" = ${args.id}
        AND "oauthGeneration" = ${args.generation}`
      .affectedCount()
      .build()
    const { affectedRows } = await this.db.execute(statement)
    return affectedRows === 1
  }

  async claim(args: {
    id: string
    generation: number
    attemptId: string
    startedAt: Date
  }): Promise<boolean> {
    const statement = this.db.raw.sql`UPDATE "McpServer"
      SET "oauthRefreshAttempt" = ${args.attemptId},
          "oauthRefreshStartedAt" = ${args.startedAt.toISOString()}::timestamptz
      WHERE "id" = ${args.id}
        AND "oauthGeneration" = ${args.generation}
        AND "oauthStatus" = ${ACTIVE}
        AND "oauthRefreshAttempt" IS NULL`
      .affectedCount()
      .build()
    const { affectedRows } = await this.db.execute(statement)
    return affectedRows === 1
  }

  async complete(args: AttemptFence & { sealed: string }): Promise<boolean> {
    const statement = this.db.raw.sql`UPDATE "McpServer"
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
    const { affectedRows } = await this.db.execute(statement)
    return affectedRows === 1
  }

  async release(fence: AttemptFence): Promise<boolean> {
    const count = await this.db.orm.public.McpServer.where(fenceWhere(fence)).updateAndCount(
      CLEARED_ATTEMPT,
    )
    return count === 1
  }

  async reject(fence: AttemptFence): Promise<boolean> {
    const count = await this.db.orm.public.McpServer.where(fenceWhere(fence)).updateAndCount({
      oauthStatus: 'expired',
      ...CLEARED_ATTEMPT,
    })
    return count === 1
  }
}
