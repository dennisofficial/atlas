import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { EConnectionStatus, OauthConnectionStore } from './oauth-connections.types'
import type { AttemptFence, ConnectionRow } from './oauth-connections.types'

const CONNECTION_SELECT = {
  id: true,
  userId: true,
  provider: true,
  status: true,
  sealedTokens: true,
  authorizationId: true,
  generation: true,
  refreshAttempt: true,
  refreshStartedAt: true,
} as const

const UNIQUE_VIOLATION = 'P2002'

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
      await db.oauthConnection.create({ data: { ...row, authorizationId: row.id } })
      return true
    } catch (error) {
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return false
      throw error
    }
  }

  find(args: { id: string }): Promise<ConnectionRow | null> {
    return db.oauthConnection.findUnique({ where: { id: args.id }, select: CONNECTION_SELECT })
  }

  async reauthorize(args: {
    id: string
    userId: string
    authorizationId: string
    previousAuthorizationId: string
    sealedTokens: string
  }): Promise<boolean> {
    const { count } = await db.oauthConnection.updateMany({
      where: {
        id: args.id,
        userId: args.userId,
        authorizationId: args.previousAuthorizationId,
      },
      data: {
        sealedTokens: args.sealedTokens,
        authorizationId: args.authorizationId,
        status: EConnectionStatus.Active,
        generation: { increment: 1 },
        ...CLEARED_ATTEMPT,
      },
    })
    return count === 1
  }

  async claim(args: {
    id: string
    userId: string
    generation: number
    attemptId: string
    startedAt: Date
  }): Promise<boolean> {
    const { count } = await db.oauthConnection.updateMany({
      where: {
        id: args.id,
        userId: args.userId,
        generation: args.generation,
        refreshAttempt: null,
        status: EConnectionStatus.Active,
      },
      data: { refreshAttempt: args.attemptId, refreshStartedAt: args.startedAt },
    })
    return count === 1
  }

  async complete(args: AttemptFence & { sealedTokens: string }): Promise<boolean> {
    const { count } = await db.oauthConnection.updateMany({
      where: fenceWhere(args),
      data: {
        sealedTokens: args.sealedTokens,
        generation: { increment: 1 },
        ...CLEARED_ATTEMPT,
      },
    })
    return count === 1
  }

  async release(args: AttemptFence): Promise<boolean> {
    const { count } = await db.oauthConnection.updateMany({
      where: fenceWhere(args),
      data: CLEARED_ATTEMPT,
    })
    return count === 1
  }

  async reject(args: AttemptFence): Promise<boolean> {
    const { count } = await db.oauthConnection.updateMany({
      where: fenceWhere(args),
      data: { status: EConnectionStatus.Expired, ...CLEARED_ATTEMPT },
    })
    return count === 1
  }

  async ownedSandboxId(args: { userId: string; threadId: string }): Promise<string | null> {
    const row = await db.cloudSandbox.findFirst({
      where: { threadId: args.threadId, userId: args.userId },
      select: { id: true },
    })
    return row?.id ?? null
  }

  async assign(args: { connectionId: string; sandboxId: string }): Promise<void> {
    await db.oauthConnectionSandbox.upsert({
      where: { connectionId_sandboxId: args },
      create: args,
      update: {},
    })
  }

  async isAssigned(args: { connectionId: string; sandboxId: string }): Promise<boolean> {
    const row = await db.oauthConnectionSandbox.findUnique({
      where: { connectionId_sandboxId: args },
      select: { connectionId: true },
    })
    return row !== null
  }

  async remove(args: { id: string; userId: string }): Promise<boolean> {
    const { count } = await db.oauthConnection.deleteMany({ where: args })
    return count === 1
  }
}
