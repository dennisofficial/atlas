import type { Db } from '@dltech/atlas-db'

import { EConnectionStatus, type AttemptFence, type ConnectionRow } from './oauth-types'

const fenceWhere = (fence: AttemptFence) => ({
  id: fence.id,
  generation: fence.generation,
  refreshAttempt: fence.attemptId,
})

const CLEARED_ATTEMPT = { refreshAttempt: null, refreshStartedAt: null } as const

export class OauthConnectionStore {
  constructor(private readonly db: Db) {}

  find({ id }: { id: string }): Promise<ConnectionRow | null> {
    return this.db.orm.public.OauthConnection.select(
      'id',
      'userId',
      'provider',
      'status',
      'sealedTokens',
      'generation',
      'refreshAttempt',
      'refreshStartedAt',
    ).first({ id })
  }

  async claim(args: {
    id: string
    userId: string
    generation: number
    attemptId: string
    startedAt: Date
  }): Promise<boolean> {
    const count = await this.db.orm.public.OauthConnection.where({
      id: args.id,
      userId: args.userId,
      generation: args.generation,
      refreshAttempt: null,
      status: EConnectionStatus.Active,
    }).updateAndCount({ refreshAttempt: args.attemptId, refreshStartedAt: args.startedAt })
    return count === 1
  }

  async complete(args: AttemptFence & { sealedTokens: string }): Promise<boolean> {
    const statement = this.db.raw.sql`UPDATE "OauthConnection"
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
    const { affectedRows } = await this.db.execute(statement)
    return affectedRows === 1
  }

  async release(fence: AttemptFence): Promise<boolean> {
    const count = await this.db.orm.public.OauthConnection.where(fenceWhere(fence)).updateAndCount(
      CLEARED_ATTEMPT,
    )
    return count === 1
  }

  async reject(fence: AttemptFence): Promise<boolean> {
    const count = await this.db.orm.public.OauthConnection.where(fenceWhere(fence)).updateAndCount({
      status: EConnectionStatus.Expired,
      ...CLEARED_ATTEMPT,
    })
    return count === 1
  }
}
