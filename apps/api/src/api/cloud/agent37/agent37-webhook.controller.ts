import {
  BadRequestException,
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
import { agent37StatusEventOf } from './agent37-webhook.event'
import { verifyAgent37Signature } from './agent37-webhook.signature'
import { Agent37WebhookService } from './agent37-webhook.service'

type Agent37WebhookRequest = { rawBody?: Buffer }

@Controller({ path: 'webhooks/agent37', version: '1' })
@SkipThrottle()
export class Agent37WebhookController {
  private readonly logger = new Logger(Agent37WebhookController.name)

  constructor(
    private readonly env: EnvService,
    private readonly statuses: Agent37WebhookService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleDelivery(
    @Req() request: Agent37WebhookRequest,
    @Headers('webhook-id') id: string | undefined,
    @Headers('webhook-timestamp') timestamp: string | undefined,
    @Headers('webhook-signature') signature: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = this.env.get('AGENT37_WEBHOOK_SECRET')
    if (secret === undefined || secret.length === 0) {
      throw new ServiceUnavailableException('agent37 webhook is not configured')
    }
    const rawBody = request.rawBody
    if (rawBody === undefined || id === undefined || timestamp === undefined) {
      throw new UnauthorizedException('missing agent37 webhook headers')
    }
    if (
      !verifyAgent37Signature({
        secret,
        id,
        timestamp,
        rawBody,
        signatureHeader: signature,
        nowMs: Date.now(),
      })
    ) {
      throw new UnauthorizedException('invalid agent37 webhook signature')
    }
    if (contentType === undefined || !contentType.includes('application/json')) {
      throw new UnsupportedMediaTypeException('agent37 webhook deliveries must be application/json')
    }

    const event = agent37StatusEventOf(this.parse(rawBody))
    if (event === null) return { received: true }
    const applied = await this.statuses.applyStatus(event)
    if (!applied) this.logger.log(`ignored stale or unknown agent37 instance ${event.instanceId}`)
    return { received: true }
  }

  private parse(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString('utf8')) as unknown
    } catch {
      throw new BadRequestException('agent37 webhook body is not json')
    }
  }
}
