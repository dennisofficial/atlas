import { Injectable, Logger } from '@nestjs/common'
import { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider } from '../factory.types'
import { addCommentReaction, clearCommentReaction } from '../linear/linear-client'
import { LinearTokensService } from '../linear/linear-tokens.service'
import { EStatusSignal, type StatusSignalAdapter, type StatusSignalRef } from './status-signal'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const EMOJI_FOR: Record<EStatusSignal, string> = {
  [EStatusSignal.Heard]: '👀',
  [EStatusSignal.ReplyComing]: '🚀',
}

/** Linear adapter: the three-state contract rides on comment reactions, same idiom as GitHub. */
@Injectable()
export class LinearStatusSignal implements StatusSignalAdapter {
  private readonly logger = new Logger(LinearStatusSignal.name)

  constructor(
    private readonly connections: FactoryConnectionsService,
    private readonly linearTokens: LinearTokensService,
  ) {}

  async set(args: { ref: StatusSignalRef; signal: EStatusSignal }): Promise<void> {
    const token = await this.tokenFor(args.ref)
    if (token === null) return
    try {
      await addCommentReaction({
        token,
        commentId: args.ref.commentId,
        emoji: EMOJI_FOR[args.signal],
      })
    } catch (failure) {
      this.logger.warn(`could not set a status signal on linear comment ${args.ref.commentId}: ${messageOf(failure)}`)
    }
  }

  async clear(args: { ref: StatusSignalRef }): Promise<void> {
    const token = await this.tokenFor(args.ref)
    if (token === null) return
    for (const emoji of Object.values(EMOJI_FOR)) {
      try {
        await clearCommentReaction({ token, commentId: args.ref.commentId, emoji })
      } catch (failure) {
        this.logger.warn(`could not clear a status signal on linear comment ${args.ref.commentId}: ${messageOf(failure)}`)
      }
    }
  }

  private async tokenFor(ref: StatusSignalRef): Promise<string | null> {
    const connections = await this.connections.listForOrganization({
      organizationId: ref.organizationId,
    })
    const linear = connections.find((one) => one.provider === EFactoryConnectionProvider.Linear)
    if (linear === undefined) {
      this.logger.warn(`no linear connection for organization ${ref.organizationId}; no status signal`)
      return null
    }
    try {
      return await this.linearTokens.getToken({ workspaceId: linear.externalAccountId })
    } catch (failure) {
      this.logger.warn(`could not resolve a linear token for a status signal: ${messageOf(failure)}`)
      return null
    }
  }
}
