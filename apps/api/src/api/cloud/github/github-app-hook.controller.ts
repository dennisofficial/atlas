import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { EnvService } from '../../../_core/config/env/env.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { installLandingPage } from './github-app-install-landing'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'
import { verifyGithubSignature } from './github-webhook.signature'
import type {
  GithubAppInstallationRepositoriesWebhookPayload,
  GithubAppInstallationWebhookPayload,
  GithubPrWebhookRequest,
} from './github-webhook.types'

const APP_EVENT_TYPES = new Set(['installation', 'installation_repositories'])

/**
 * Ingress for the Atlas GitHub App's own webhook (a single URL the app delivers to for every repo
 * in every installation), distinct from the per-repo hooks which carry per-repo secrets. Verified
 * against the app's webhook secret, not a per-repo row. Lifecycle events keep the installation
 * coverage table current; PR/CI events route through the same delivery service as per-repo hooks.
 */
@Controller({ path: 'github/app', version: '1' })
@SkipThrottle()
export class GithubAppHookController {
  private readonly logger = new Logger(GithubAppHookController.name)

  constructor(
    private readonly deliveries: GithubDeliveryService,
    private readonly installations: GithubAppInstallationsService,
    private readonly env: EnvService,
    private readonly inbox: GithubWebhookInboxService,
  ) {}

  /**
   * The app's post-install Setup URL lands a browser here (GitHub appends installation_id and
   * setup_action). It is a browser page, not a webhook, so it carries no signature and reads only
   * what the webhook already recorded — a missing row means the install webhook has not arrived
   * yet, not that the install failed.
   */
  @Get('callback')
  @Header('content-type', 'text/html; charset=utf-8')
  async handleInstalled(
    @Query('installation_id') installationId: string | undefined,
  ): Promise<string> {
    const id = installationId === undefined ? null : Number(installationId)
    const installation =
      id === null || !Number.isInteger(id)
        ? null
        : await this.installations.read({ installationId: BigInt(id) })
    return installLandingPage({ accountLogin: installation?.accountLogin ?? null })
  }

  @Post('hook')
  @HttpCode(200)
  async handleDelivery(
    @Req() request: GithubPrWebhookRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ received: boolean }> {
    const secret = this.env.get('GITHUB_APP_WEBHOOK_SECRET')
    if (secret === undefined || secret.length === 0) {
      throw new ServiceUnavailableException('github app webhook is not configured')
    }

    const rawBody = request.rawBody
    if (rawBody === undefined) throw new UnauthorizedException('missing github webhook body')
    if (!verifyGithubSignature({ secret, rawBody, signatureHeader: signature })) {
      throw new UnauthorizedException('invalid github webhook signature')
    }
    if (event === undefined) throw new UnauthorizedException('missing github event header')
    if (contentType === undefined || !contentType.includes('application/json')) {
      throw new UnsupportedMediaTypeException('github webhook deliveries must be application/json')
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as unknown
    if (APP_EVENT_TYPES.has(event)) {
      await this.handleLifecycle({ event, payload })
      return { received: true }
    }

    if (deliveryId !== undefined) {
      const fresh = await this.inbox.insert({ deliveryId, event, payload })
      if (!fresh) return { received: true }
    }
    try {
      const outcome = await this.deliveries.handle({ event, payload })
      if (!outcome.handled) this.logger.log(`unhandled github app delivery event=${event}`)
    } catch (failure) {
      if (deliveryId !== undefined)
        await this.inbox.markFailed({ deliveryId, error: failure }).catch(() => undefined)
      this.logger.warn(
        `github app delivery ${deliveryId ?? 'untracked'} failed: ${String(failure)}`,
      )
      return { received: true }
    }
    if (deliveryId !== undefined) await this.inbox.markProcessed({ deliveryId })
    return { received: true }
  }

  private async handleLifecycle(args: { event: string; payload: unknown }): Promise<void> {
    if (args.event === 'installation') {
      await this.installations.applyInstallation(
        args.payload as GithubAppInstallationWebhookPayload,
      )
      return
    }
    if (args.event === 'installation_repositories') {
      await this.installations.applyRepositories(
        args.payload as GithubAppInstallationRepositoriesWebhookPayload,
      )
      return
    }
    throw new BadRequestException(`unsupported github app lifecycle event ${args.event}`)
  }
}
