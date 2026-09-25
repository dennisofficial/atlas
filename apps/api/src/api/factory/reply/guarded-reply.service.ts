import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common'
import { db } from '../../../db'
import { EFactoryEventKind, EFactorySurface } from '../factory.types'
import { ReplyWatchService } from '../reply-watch/reply-watch.service'
import { TranscriptService } from '../transcript.service'
import { GithubAppService } from './github-app.service'
import { parseReplyTarget } from './reply-target'

const REPLY_WINDOW_MS = 60 * 60 * 1000
const REPLY_MAX_PER_WINDOW = 10

export type GuardedReplyResult = {
  posted: true
  surface: string
  externalId: string
  url: string
}

@Injectable()
export class GuardedReplyService {
  private readonly logger = new Logger(GuardedReplyService.name)

  constructor(
    private readonly transcript: TranscriptService,
    private readonly githubApp: GithubAppService,
    private readonly replyWatch: ReplyWatchService,
  ) {}

  async reply(args: {
    orchestratorThreadId: string
    surface: string
    externalId: string
    body: string
  }): Promise<GuardedReplyResult> {
    const item = await db.factoryWorkItem.findFirst({
      where: { orchestratorThreadId: args.orchestratorThreadId },
    })
    if (item === null) {
      throw new ForbiddenException('this sandbox is not the orchestrator of any work item')
    }
    if (args.surface !== EFactorySurface.GitHub) {
      throw new BadRequestException(`replies to ${args.surface} surfaces are not supported`)
    }
    const target = parseReplyTarget(args.externalId)
    if (target === null) {
      throw new BadRequestException(
        `surface id ${args.externalId} is not a known github surface (owner/repo#n, owner/repo/pull/n)`,
      )
    }

    const alias = await db.factorySurfaceAlias.findFirst({
      where: { surface: args.surface, externalId: args.externalId },
    })
    if (alias === null || alias.workItemId !== item.id) {
      throw new ForbiddenException(
        `surface ${args.externalId} is not aliased to this sandbox's work item`,
      )
    }

    const since = new Date(Date.now() - REPLY_WINDOW_MS).toISOString()
    const recent = await db.factoryTranscriptEvent.count({
      where: {
        workItemId: item.id,
        kind: EFactoryEventKind.Reply,
        receivedAt: { gte: since },
      },
    })
    if (recent >= REPLY_MAX_PER_WINDOW) {
      throw new HttpException(
        `work item ${item.id} has posted ${recent} replies in the last hour — the loop guard refuses more`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const posted = await this.githubApp.createComment({ ...target, body: args.body })
    await this.transcript.append({
      surface: args.surface,
      externalId: args.externalId,
      deliveryId: `reply:${randomUUID()}`,
      kind: EFactoryEventKind.Reply,
      author: 'atlas-factory',
      payload: JSON.stringify({ body: args.body, url: posted.url }),
    })
    await this.replyWatch.resolve({ workItemId: item.id })
    this.logger.log(`posted factory reply on ${args.externalId} for work item ${item.id}`)
    return {
      posted: true,
      surface: args.surface,
      externalId: args.externalId,
      url: posted.url,
    }
  }
}
