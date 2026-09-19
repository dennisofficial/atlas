import { createHmac } from 'node:crypto'
import {
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../_core/config/env/env.service'
import { GithubWebhookController } from './github-webhook.controller'
import type { GithubWebhookService } from './github-webhook.service'
import type { GithubWebhookOutcome, GithubWebhookRequest } from './github-webhook.types'

const SECRET = 'whsec_test_secret'
const BODY = Buffer.from(JSON.stringify({ zen: 'hi' }))

function sign(args: { body: Buffer; secret: string }): string {
  return `sha256=${createHmac('sha256', args.secret).update(args.body).digest('hex')}`
}

function fakeRequest(rawBody: Buffer | undefined): GithubWebhookRequest {
  return { rawBody } as unknown as GithubWebhookRequest
}

describe('GithubWebhookController', () => {
  let webhooks: { handle: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    webhooks = {
      handle: vi.fn(async (): Promise<GithubWebhookOutcome> => ({ handled: true })),
    }
  })

  it('refuses every request when the webhook secret is unset', async () => {
    const controller = new GithubWebhookController(
      new EnvService({}),
      webhooks as unknown as GithubWebhookService,
    )

    await expect(
      controller.handleWebhook(fakeRequest(BODY), sign({ body: BODY, secret: SECRET }), 'ping', 'd-1', 'application/json'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })

  it('accepts a well-signed request and hands the parsed payload to the service', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )

    const outcome = await controller.handleWebhook(
      fakeRequest(BODY),
      sign({ body: BODY, secret: SECRET }),
      'ping',
      'd-1',
      'application/json',
    )

    expect(outcome).toEqual({ handled: true })
    expect(webhooks.handle).toHaveBeenCalledWith({
      event: 'ping',
      deliveryId: 'd-1',
      payload: { zen: 'hi' },
    })
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(BODY),
        sign({ body: BODY, secret: 'wrong-secret' }),
        'ping',
        'd-1',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )

    await expect(
      controller.handleWebhook(fakeRequest(BODY), undefined, 'ping', 'd-1', 'application/json'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a signature of mismatched length', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )

    await expect(
      controller.handleWebhook(fakeRequest(BODY), 'sha256=short', 'ping', 'd-1', 'application/json'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a request with no raw body captured', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(undefined),
        sign({ body: BODY, secret: SECRET }),
        'ping',
        'd-1',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a form-encoded delivery with 415 after a valid signature', async () => {
    const controller = new GithubWebhookController(
      new EnvService({ GITHUB_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as GithubWebhookService,
    )
    const formBody = Buffer.from('payload=%7B%22zen%22%3A%22hi%22%7D')

    await expect(
      controller.handleWebhook(
        fakeRequest(formBody),
        sign({ body: formBody, secret: SECRET }),
        'ping',
        'd-1',
        'application/x-www-form-urlencoded',
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })
})
