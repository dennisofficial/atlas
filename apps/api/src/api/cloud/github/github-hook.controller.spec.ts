import { createHmac } from 'node:crypto'
import { UnauthorizedException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubHookController } from './github-hook.controller'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'
import type { GithubDeliveryService } from './github-delivery.service'
import type { GithubPrWebhookRequest } from './github-webhook.types'

const SECRET = 'whsec_per_repo_secret'

const CIPHER = { decrypt: () => SECRET } as unknown as SecretCipherService

function controllerWith(args: { fail?: boolean } = {}): {
  controller: GithubHookController
  handled: Array<{ event: string; payload: unknown }>
} {
  const handled: Array<{ event: string; payload: unknown }> = []
  const deliveries = {
    handle: async (call: { event: string; payload: unknown }) => {
      if (args.fail === true) throw new Error('boom')
      handled.push(call)
      return { handled: true }
    },
  } as unknown as GithubDeliveryService
  return {
    controller: new GithubHookController(deliveries, CIPHER, new GithubWebhookInboxService()),
    handled,
  }
}

function requestWith(args: { body: unknown }): GithubPrWebhookRequest {
  const rawBody = Buffer.from(JSON.stringify(args.body))
  return { rawBody } as GithubPrWebhookRequest
}

function sign(args: { body: Buffer; secret: string }): string {
  return `sha256=${createHmac('sha256', args.secret).update(args.body).digest('hex')}`
}

const seedHook = (): Promise<unknown> => seedRepoHook({ createdBy: 'usr_1' })

describe('GithubHookController', () => {
  useTestDatabase()
  it('verifies the signature against the decrypted per-repo secret and hands off', async () => {
    await seedHook()
    const { controller, handled } = controllerWith()
    const request = requestWith({ body: { zen: 'hi' } })
    const signature = sign({ body: request.rawBody as Buffer, secret: SECRET })

    const result = await controller.handleDelivery(
      request,
      'compai/app',
      signature,
      'ping',
      undefined,
      'application/json',
    )

    expect(result).toEqual({ received: true })
    expect(handled).toEqual([{ event: 'ping', payload: { zen: 'hi' } }])
  })

  it('rejects a bad signature with 401', async () => {
    await seedHook()
    const { controller } = controllerWith()
    const request = requestWith({ body: { zen: 'hi' } })

    await expect(
      controller.handleDelivery(
        request,
        'compai/app',
        sign({ body: request.rawBody as Buffer, secret: 'wrong' }),
        'ping',
        undefined,
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects an unknown repo with 401', async () => {
    const { controller } = controllerWith()
    const request = requestWith({ body: {} })

    await expect(
      controller.handleDelivery(
        request,
        'nobody/repo',
        'sha256=ab',
        'ping',
        undefined,
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a malformed repo segment with 400', async () => {
    const { controller } = controllerWith()

    await expect(
      controller.handleDelivery(
        requestWith({ body: {} }),
        'justrepo',
        'sha256=ab',
        'ping',
        undefined,
        'application/json',
      ),
    ).rejects.toThrow(/owner\/name/)
  })

  it('rejects a non-json content type', async () => {
    await seedHook()
    const { controller } = controllerWith()
    const request = requestWith({ body: {} })
    const signature = sign({ body: request.rawBody as Buffer, secret: SECRET })

    await expect(
      controller.handleDelivery(request, 'compai/app', signature, 'ping', undefined, 'text/plain'),
    ).rejects.toThrow(/application\/json/)
  })

  it('acknowledges a duplicate delivery id without reprocessing', async () => {
    await seedHook()
    const { controller, handled } = controllerWith()
    const request = requestWith({ body: { zen: 'hi' } })
    const signature = sign({ body: request.rawBody as Buffer, secret: SECRET })

    const first = await controller.handleDelivery(
      request,
      'compai/app',
      signature,
      'ping',
      'delivery-1',
      'application/json',
    )
    const second = await controller.handleDelivery(
      request,
      'compai/app',
      signature,
      'ping',
      'delivery-1',
      'application/json',
    )

    expect(first).toEqual({ received: true })
    expect(second).toEqual({ received: true })
    expect(handled).toEqual([{ event: 'ping', payload: { zen: 'hi' } }])
  })

  it('answers 200 on a processing failure and records the error on the inbox row', async () => {
    await seedHook()
    const { controller } = controllerWith({ fail: true })
    const request = requestWith({ body: { zen: 'hi' } })
    const signature = sign({ body: request.rawBody as Buffer, secret: SECRET })

    const result = await controller.handleDelivery(
      request,
      'compai/app',
      signature,
      'ping',
      'delivery-fail',
      'application/json',
    )

    expect(result).toEqual({ received: true })
    const row = await db.orm.public.GithubWebhookInbox.where({
      deliveryId: 'delivery-fail',
    }).first()
    expect(row?.processingError).toContain('boom')
    expect(row?.processedAt).toBeNull()
  })
})
