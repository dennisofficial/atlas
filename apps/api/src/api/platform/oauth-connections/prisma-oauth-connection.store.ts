import { db, isUniqueViolation } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { EConnectionStatus, OauthConnectionStore } from './oauth-connections.types'
import type { AttemptFence, ConnectionRow } from './oauth-connections.types'

const fenceWhere = (fence: AttemptFence) => ({
  id: fence.id,
  generation: fence.generation,
  refreshAttempt: fence.attemptId,
})

const CLEARED_ATTEMPT = { refreshAttempt: null, refreshStartedAt: null } as const

@Injectable()
export class PrismaOauthConnectionStore implements OauthConnectionStore {
  async insert(row: {
    id: string
    userId: string
    provider: string
    sealedTokens: string
  }): Promise<boolean> {
    try {
      await db.orm.public.OauthConnection.create({ ...row, authorizationId: row.id })
      return true
    } catch (error) {
      if (isUniqueViolation(error)) return false
      throw error
    }
  }

  find(args: { id: string }): Promise<ConnectionRow | null> {
    return db.orm.public.OauthConnection.select(
      'id',
      'userId',
      'provider',
      'status',
      'sealedTokens',
      'authorizationId',
      'generation',
      'refreshAttempt',
      'refreshStartedAt',
    ).first({ id: args.id })
  }

  async reauthorize(args: {
    id: string
    userId: string
    authorizationId: string
    previousAuthorizationId: string
    sealedTokens: string
  }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "OauthConnection"
      SET "sealedTokens" = ${args.sealedTokens},
          "authorizationId" = ${args.authorizationId},
          "status" = ${EConnectionStatus.Active},
          "generation" = "generation" + 1,
          "refreshAttempt" = NULL,
          "refreshStartedAt" = NULL,
          "updatedAt" = now()
      WHERE "id" = ${args.id}
        AND "userId" = ${args.userId}
        AND "authorizationId" = ${args.previousAuthorizationId}`
      .affectedCount()
      .build()
    const { affectedRows } = await db.execute(statement)
    return affectedRows === 1
  }

  async claim(args: {
    id: string
    userId: string
    generation: number
    attemptId: string
    startedAt: Date
  }): Promise<boolean> {
    const count = await db.orm.public.OauthConnection.where({
      id: args.id,
      userId: args.userId,
      generation: args.generation,
      refreshAttempt: null,
      status: EConnectionStatus.Active,
    }).updateAndCount({ refreshAttempt: args.attemptId, refreshStartedAt: args.startedAt })
    return count === 1
  }

  async complete(args: AttemptFence & { sealedTokens: string }): Promise<boolean> {
    const statement = db.raw.sql`UPDATE "OauthConnection"
      SET "sealedTokens" = ${args.sealedTokens},
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
    const count = await db.orm.public.OauthConnection.where(fenceWhere(args)).updateAndCount(
      CLEARED_ATTEMPT,
    )
    return count === 1
  }

  async reject(args: AttemptFence): Promise<boolean> {
    const count = await db.orm.public.OauthConnection.where(fenceWhere(args)).updateAndCount({
      status: EConnectionStatus.Expired,
      ...CLEARED_ATTEMPT,
    })
    return count === 1
  }

  async ownedSandboxId(args: { userId: string; threadId: string }): Promise<string | null> {
    const row = await db.orm.public.CloudSandbox.select('id').first({
      threadId: args.threadId,
      userId: args.userId,
    })
    return row?.id ?? null
  }

  async assign(args: { connectionId: string; sandboxId: string }): Promise<void> {
    await db.orm.public.OauthConnectionSandbox.upsert({
      create: args,
      update: {},
      conflictOn: args,
    })
  }

  async isAssigned(args: { connectionId: string; sandboxId: string }): Promise<boolean> {
    const row = await db.orm.public.OauthConnectionSandbox.select('connectionId').first(args)
    return row !== null
  }

  async remove(args: { id: string; userId: string }): Promise<boolean> {
    const count = await db.orm.public.OauthConnection.where(args).deleteAndCount()
    return count === 1
  }
}
