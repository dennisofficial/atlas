import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../../../_core/decorators/public.decorator'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { WEBHOOK_THROTTLE_PER_MINUTE } from '../../../_lib/webhook-body-limit'
import { db } from '../../../db'
import { GithubDeliveryService } from './github-delivery.service'
import { parseHookRepoParam } from './github-pr-payload'
import { verifyGithubSignature } from './github-webhook.signature'
import type { GithubPrWebhookRequest } from './github-webhook.types'

/**
 * Per-repo webhook receiver for the realtime subscription flow: the hook URL embeds the repo so
 * the handler loads that repo's HMAC secret directly. HMAC-authenticated, caller-anonymous,
 * stateless — a restart loses nothing because GithubPrState is the record.
 */
@Controller({ path: 'github/hooks', version: '1' })
@Throttle({ default: { limit: WEBHOOK_THROTTLE_PER_MINUTE, ttl: 60_000 } })
export class GithubHookController {
  private readonly logger = new Logger(GithubHookController.name)

  constructor(
    private readonly deliveries: GithubDeliveryService,
    private readonly cipher: SecretCipherService,
  ) {}

  @Post(':repo')
  @Public()
  @HttpCode(200)
  async handleDelivery(
    @Req() request: GithubPrWebhookRequest,
    @Param('repo') repoParam: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ received: boolean }> {
    const repoFullName = parseHookRepoParam({ repo: repoParam })
    if (repoFullName === null) throw new BadRequestException('hook repo must be owner/name')

    const hook = await db.githubRepoHook.findUnique({ where: { repoFullName } })
    if (hook === null) throw new UnauthorizedException('no hook is registered for this repo')

    const rawBody = request.rawBody
    if (rawBody === undefined) throw new UnauthorizedException('missing github webhook body')

    const secret = this.cipher.decrypt(hook.secret)
    if (!verifyGithubSignature({ secret, rawBody, signatureHeader: signature })) {
      throw new UnauthorizedException('invalid github webhook signature')
    }
    if (event === undefined) throw new UnauthorizedException('missing github event header')
    if (contentType === undefined || !contentType.includes('application/json')) {
      throw new UnsupportedMediaTypeException('github webhook deliveries must be application/json')
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as unknown
    const outcome = await this.deliveries.handle({ event, payload })

    if (!outcome.handled) this.logger.log(`unhandled github delivery event=${event} repo=${repoFullName}`)
    return { received: true }
  }
}
