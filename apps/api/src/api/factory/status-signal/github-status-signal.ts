import { Injectable, Logger } from '@nestjs/common'
import { GithubAppService } from '../reply/github-app.service'
import { parseReplyTarget } from '../reply/reply-target'
import { EStatusSignal, type StatusSignalAdapter, type StatusSignalRef } from './status-signal'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

// GitHub's comment-reaction set is fixed (no thought bubble); rocket is the working-on-it signal.
const CONTENT_FOR: Record<EStatusSignal, string> = {
  [EStatusSignal.Heard]: 'eyes',
  [EStatusSignal.ReplyComing]: 'rocket',
}

/** GitHub adapter: the three-state contract rides on issue-comment reactions. */
@Injectable()
export class GithubStatusSignal implements StatusSignalAdapter {
  private readonly logger = new Logger(GithubStatusSignal.name)

  constructor(private readonly githubApp: GithubAppService) {}

  async set(args: { ref: StatusSignalRef; signal: EStatusSignal }): Promise<void> {
    const target = parseReplyTarget(args.ref.externalId)
    const commentId = Number(args.ref.commentId)
    if (target === null || !Number.isInteger(commentId)) {
      this.logger.warn(`status signal on an unparseable github ref ${args.ref.externalId}`)
      return
    }
    try {
      await this.githubApp.addCommentReactionForRepo({
        owner: target.owner,
        repo: target.repo,
        commentId,
        content: CONTENT_FOR[args.signal],
      })
    } catch (failure) {
      this.logger.warn(`could not set a status signal on ${args.ref.externalId}: ${messageOf(failure)}`)
    }
  }

  async clear(args: { ref: StatusSignalRef }): Promise<void> {
    const target = parseReplyTarget(args.ref.externalId)
    const commentId = Number(args.ref.commentId)
    if (target === null || !Number.isInteger(commentId)) return
    for (const signal of Object.values(CONTENT_FOR)) {
      try {
        await this.githubApp.clearCommentReaction({
          owner: target.owner,
          repo: target.repo,
          commentId,
          content: signal,
        })
      } catch (failure) {
        this.logger.warn(`could not clear a status signal on ${args.ref.externalId}: ${messageOf(failure)}`)
      }
    }
  }
}
