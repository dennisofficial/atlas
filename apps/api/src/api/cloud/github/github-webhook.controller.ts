import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { EnvService } from '../../../_core/config/env/env.service'
import { Public } from '../../../_core/decorators/public.decorator'
import { GithubWebhookService as FactoryWebhookService } from '../../factory/github-webhook.service'
import { verifyGithubSignature } from '../../factory/github-webhook.signature'
import { GithubPrWebhookService } from './github-webhook.service'
import type { GithubPrWebhookRequest } from './github-webhook.types'

/**
 * The GitHub App's single webhook URL lands here: HMAC-authenticated, no caller principal. Every
 * delivery is persisted and offered to both consumers — the PR/CI tracker below and the factory,
 * which ignores what it does not track and dedups on delivery id what it does.
 */
@Controller({ path: 'github/webhooks', version: '1' })
@SkipThrottle()
export class GithubPrWebhookController {
  private readonly logger = new Logger(GithubPrWebhookController.name)

  constructor(
    private readonly env: EnvService,
    private readonly tracking: GithubPrWebhookService,
    private readonly factory: FactoryWebhookService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Req() request: GithubPrWebhookRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = this.env.get('GITHUB_WEBHOOK_SECRET')
    if (secret === undefined || secret.length === 0) {
      throw new ServiceUnavailableException('the github webhook secret is not configured')
    }

    const rawBody = request.rawBody
    if (rawBody === undefined) {
      throw new UnauthorizedException('missing github webhook body')
    }
    if (!verifyGithubSignature({ secret, rawBody, signatureHeader: signature })) {
      throw new UnauthorizedException('invalid github webhook signature')
    }
    if (event === undefined || deliveryId === undefined) {
      throw new UnauthorizedException('missing github webhook headers')
    }
    if (contentType === undefined || !contentType.includes('application/json')) {
      throw new UnsupportedMediaTypeException('github webhook deliveries must be application/json')
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as unknown
    const outcome = await this.tracking.handle({ event, deliveryId, payload })

    try {
      await this.factory.handle({ event, deliveryId, payload })
    } catch (failure) {
      this.logger.warn(`factory webhook routing failed for ${event} ${deliveryId}: ${failure}`)
    }

    if (!outcome.handled && event !== 'ping') {
      this.logger.log(`received github webhook event=${event} delivery=${deliveryId}`)
    }
    return { received: true }
  }
}
