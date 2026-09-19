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
import { EnvService } from '../../_core/config/env/env.service'
import { Public } from '../../_core/decorators/public.decorator'
import { GithubWebhookService } from './github-webhook.service'
import { verifyGithubSignature } from './github-webhook.signature'
import type { GithubWebhookOutcome, GithubWebhookRequest } from './github-webhook.types'

@Controller({ path: 'factory/webhooks/github', version: '1' })
@SkipThrottle()
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name)

  constructor(
    private readonly env: EnvService,
    private readonly webhooks: GithubWebhookService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Req() request: GithubWebhookRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<GithubWebhookOutcome> {
    const secret = this.env.get('GITHUB_FACTORY_WEBHOOK_SECRET')
    if (secret === undefined || secret.length === 0) {
      throw new ServiceUnavailableException('the github factory webhook secret is not configured')
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
    const outcome = await this.webhooks.handle({ event, deliveryId, payload })
    if (!outcome.handled) {
      this.logger.log(`ignored github webhook event=${event} delivery=${deliveryId}`)
    }
    return outcome
  }
}
