import { createHmac } from 'node:crypto'
import { UnauthorizedException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { seedRepoHook } from '../../../../test/github-seed'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { GithubHookController } from './github-hook.controller'
import type { GithubDeliveryService } from './github-delivery.service'
import type { GithubPrWebhookRequest } from './github-webhook.types'

const SECRET = 'whsec_per_repo_secret'

const CIPHER = { decrypt: () => SECRET } as unknown as SecretCipherService

function controllerWith(): {
  controller: GithubHookController
  handled: Array<{ event: string; payload: unknown }>
} {
  const handled: Array<{ event: string; payload: unknown }> = []
  const deliveries = {
    handle: async (args: { event: string; payload: unknown }) => {
      handled.push(args)
      return { handled: true }
    },
  } as unknown as GithubDeliveryService
  return { controller: new GithubHookController(deliveries, CIPHER), handled }
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
        'application/json',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects an unknown repo with 401', async () => {
    const { controller } = controllerWith()
    const request = requestWith({ body: {} })

    await expect(
      controller.handleDelivery(request, 'nobody/repo', 'sha256=ab', 'ping', 'application/json'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects a malformed repo segment with 400', async () => {
    const { controller } = controllerWith()

    await expect(
      controller.handleDelivery(requestWith({ body: {} }), 'justrepo', 'sha256=ab', 'ping', 'application/json'),
    ).rejects.toThrow(/owner\/name/)
  })

  it('rejects a non-json content type', async () => {
    await seedHook()
    const { controller } = controllerWith()
    const request = requestWith({ body: {} })
    const signature = sign({ body: request.rawBody as Buffer, secret: SECRET })

    await expect(
      controller.handleDelivery(request, 'compai/app', signature, 'ping', 'text/plain'),
    ).rejects.toThrow(/application\/json/)
  })
})
