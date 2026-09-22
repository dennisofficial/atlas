import { createHmac } from 'node:crypto'
import {
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../_core/config/env/env.service'
import { LinearWebhookController } from './linear-webhook.controller'
import type { LinearWebhookService } from './linear-webhook.service'
import type { LinearWebhookOutcome, LinearWebhookRequest } from './linear-webhook.types'

const SECRET = 'lin_whsec_test_secret'
const BODY = Buffer.from(JSON.stringify({ type: 'Issue', action: 'update' }))

function sign(args: { body: Buffer; secret: string }): string {
  return createHmac('sha256', args.secret).update(args.body).digest('hex')
}

function fakeRequest(rawBody: Buffer | undefined): LinearWebhookRequest {
  return { rawBody } as unknown as LinearWebhookRequest
}

describe('LinearWebhookController', () => {
  let webhooks: { handle: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    webhooks = {
      handle: vi.fn(async (): Promise<LinearWebhookOutcome> => ({ handled: true })),
    }
  })

  it('refuses every request when the webhook secret is unset', async () => {
    const controller = new LinearWebhookController(
      new EnvService({}),
      webhooks as unknown as LinearWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(BODY),
        sign({ body: BODY, secret: SECRET }),
        'd-1',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })

  it('accepts a well-signed request and hands the parsed payload to the service', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )

    const outcome = await controller.handleWebhook(
      fakeRequest(BODY),
      sign({ body: BODY, secret: SECRET }),
      'd-1',
      'application/json; charset=utf-8',
    )

    expect(outcome).toEqual({ handled: true })
    expect(webhooks.handle).toHaveBeenCalledWith({
      deliveryId: 'd-1',
      payload: { type: 'Issue', action: 'update' },
    })
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(BODY),
        sign({ body: BODY, secret: 'wrong-secret' }),
        'd-1',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )

    await expect(
      controller.handleWebhook(fakeRequest(BODY), undefined, 'd-1', 'application/json'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a missing delivery header', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(BODY),
        sign({ body: BODY, secret: SECRET }),
        undefined,
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a request with no raw body captured', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )

    await expect(
      controller.handleWebhook(
        fakeRequest(undefined),
        sign({ body: BODY, secret: SECRET }),
        'd-1',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a form-encoded delivery with 415 after a valid signature', async () => {
    const controller = new LinearWebhookController(
      new EnvService({ LINEAR_FACTORY_WEBHOOK_SECRET: SECRET }),
      webhooks as unknown as LinearWebhookService,
    )
    const formBody = Buffer.from('payload=%7B%7D')

    await expect(
      controller.handleWebhook(
        fakeRequest(formBody),
        sign({ body: formBody, secret: SECRET }),
        'd-1',
        'application/x-www-form-urlencoded',
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
    expect(webhooks.handle).not.toHaveBeenCalled()
  })
})
