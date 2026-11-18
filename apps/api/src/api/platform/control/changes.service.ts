import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ChangeContentStore, ControlPlane } from '@dltech/atlas-control'
import {
  EChangeSide,
  type SessionChangeContentOutput,
  type SessionChangesOutput,
} from '@dltech/atlas-protocol'
import { SessionsService } from './sessions.service'

export const CHANGE_CONTENT_TTL_MS = 5 * 60 * 1000

@Injectable()
export class ChangesService {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(ChangeContentStore) private readonly changeStore: ChangeContentStore,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async changes(args: { userId: string; sessionId: string }): Promise<SessionChangesOutput> {
    await this.sessions.requireOwnedSession(args)
    const checkouts = await this.plane.readChanges({ sessionId: args.sessionId })
    return {
      checkouts: checkouts.map((checkout) => ({
        checkoutId: checkout.checkoutId,
        repo: checkout.repo,
        worktreePath: checkout.worktreePath,
        base: checkout.base,
        updatedAt: checkout.updatedAt,
        files: checkout.files.map((file) => ({
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          binary: file.binary,
          size: file.size,
          baseHash: file.baseHash,
          currentHash: file.currentHash,
        })),
      })),
    }
  }

  async content(args: {
    userId: string
    sessionId: string
    checkoutId: string
    path: string
    side: EChangeSide
  }): Promise<SessionChangeContentOutput> {
    await this.sessions.requireOwnedSession(args)
    const file = await this.plane.readChangeFile({
      sessionId: args.sessionId,
      checkoutId: args.checkoutId,
      path: args.path,
    })
    if (file === undefined) throw new NotFoundException('changed file not found')
    const hash = args.side === EChangeSide.Base ? file.baseHash : file.currentHash
    if (hash === null) throw new NotFoundException('this side has no content')
    const url = await this.changeStore.presignGet({ hash, ttlMs: CHANGE_CONTENT_TTL_MS })
    const size =
      args.side === EChangeSide.Current && file.size !== null
        ? file.size
        : ((await this.changeStore.read({ hash }))?.byteLength ?? 0)
    return { url, hash, size, validUntil: Date.now() + CHANGE_CONTENT_TTL_MS }
  }
}
