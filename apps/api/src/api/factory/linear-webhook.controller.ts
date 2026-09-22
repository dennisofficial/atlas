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
import { verifyLinearSignature } from './linear-webhook.signature'
import { LinearWebhookService } from './linear-webhook.service'
import type { LinearWebhookOutcome, LinearWebhookRequest } from './linear-webhook.types'

@Controller({ path: 'factory/webhooks/linear', version: '1' })
@SkipThrottle()
export class LinearWebhookController {
  private readonly logger = new Logger(LinearWebhookController.name)

  constructor(
    private readonly env: EnvService,
    private readonly webhooks: LinearWebhookService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Req() request: LinearWebhookRequest,
    @Headers('linear-signature') signature: string | undefined,
    @Headers('linear-delivery') deliveryId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<LinearWebhookOutcome> {
    const secret = this.env.get('LINEAR_FACTORY_WEBHOOK_SECRET')
    if (secret === undefined || secret.length === 0) {
      throw new ServiceUnavailableException('the linear factory webhook secret is not configured')
    }

    const rawBody = request.rawBody
    if (rawBody === undefined) {
      throw new UnauthorizedException('missing linear webhook body')
    }
    if (!verifyLinearSignature({ secret, rawBody, signatureHeader: signature })) {
      throw new UnauthorizedException('invalid linear webhook signature')
    }
    if (deliveryId === undefined) {
      throw new UnauthorizedException('missing linear webhook delivery header')
    }

    if (contentType === undefined || !contentType.includes('application/json')) {
      throw new UnsupportedMediaTypeException('linear webhook deliveries must be application/json')
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as unknown
    const outcome = await this.webhooks.handle({ deliveryId, payload })
    if (!outcome.handled) {
      this.logger.log(`ignored linear webhook delivery=${deliveryId}`)
    }
    return outcome
  }
}
