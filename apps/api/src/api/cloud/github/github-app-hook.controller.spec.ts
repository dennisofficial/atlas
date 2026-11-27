import { createHmac } from 'node:crypto'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import type { BackgroundWork } from '../../../_core/ports/background-work'
import { GithubAppHookController } from './github-app-hook.controller'
import type { GithubAppInstallationsService } from '@dltech/atlas-github'
import type { GithubAppSyncService } from '@dltech/atlas-github'
import type { GithubDeliveryService } from '@dltech/atlas-github'
import type { GithubWebhookInboxService } from '@dltech/atlas-github'
import type { GithubPrWebhookRequest } from './github-webhook-request'

const SECRET = 'app-secret'

function controllerWith() {
  const unknown: number[] = []
  const syncNow: number[] = []
  const pending: Array<Promise<unknown>> = []
  const inserted: Array<{ deliveryId: string; event: string; payload: unknown }> = []
  const handled: Array<{ event: string; payload: unknown }> = []
  const appSync = {
    syncUnknownInstallation: async ({ installationId }: { installationId: number }) => {
      unknown.push(installationId)
    },
    syncNow: async () => {
      syncNow.push(1)
    },
  } as unknown as GithubAppSyncService
  const controller = new GithubAppHookController(
    {
      handle: async (args: { event: string; payload: unknown }) => {
        handled.push(args)
        return { handled: true }
      },
    } as unknown as GithubDeliveryService,
    {
      applyInstallation: async () => undefined,
    } as unknown as GithubAppInstallationsService,
    new EnvService({ GITHUB_APP_WEBHOOK_SECRET: SECRET }),
    {
      insert: async (args: { deliveryId: string; event: string; payload: unknown }) => {
        inserted.push(args)
        return true
      },
      markProcessed: async () => undefined,
    } as unknown as GithubWebhookInboxService,
    appSync,
    {
      keepAlive: (work: Promise<unknown>) => pending.push(work),
    } as unknown as BackgroundWork,
  )
  return {
    controller,
    unknown,
    syncNow,
    inserted,
    handled,
    settle: () => Promise.all(pending),
  }
}

function deliver(args: { controller: GithubAppHookController; event: string; body: unknown }) {
  const rawBody = Buffer.from(JSON.stringify(args.body))
  const signature = `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`
  return args.controller.handleDelivery(
    { rawBody } as GithubPrWebhookRequest,
    signature,
    args.event,
    'delivery-1',
    'application/json',
  )
}

describe('GithubAppHookController installation sync triggers', () => {
  it('asks the sync service about the installation id on a delivery', async () => {
    const { controller, unknown, settle } = controllerWith()

    await deliver({
      controller,
      event: 'check_run',
      body: { installation: { id: 145998843 } },
    })
    await settle()

    expect(unknown).toEqual([145998843])
  })

  it('syncs from GitHub when an installation event carries no repository list', async () => {
    const { controller, syncNow, settle } = controllerWith()

    await deliver({
      controller,
      event: 'installation',
      body: {
        action: 'created',
        installation: {
          id: 1,
          account: { login: 'x', type: 'User' },
          suspended_at: null,
        },
      },
    })
    await settle()

    expect(syncNow).toEqual([1])
  })
})

function relayed(args: {
  controller: GithubAppHookController
  event: string
  body: unknown
  payload?: string
  signature?: string
}) {
  const rawBody = Buffer.from(JSON.stringify(args.body))
  const signature =
    args.signature ?? `sha256=${createHmac('sha256', SECRET).update(rawBody).digest('hex')}`
  return args.controller.handleRelayedDelivery(
    { payload: args.payload ?? rawBody.toString('base64') },
    signature,
    args.event,
    'delivery-2',
    'application/json',
  )
}

describe('GithubAppHookController relayed deliveries', () => {
  it('handles a delivery whose base64 body is signed exactly like a direct one', async () => {
    const { controller, unknown, inserted, handled, settle } = controllerWith()
    const body = {
      action: 'opened',
      installation: { id: 145998843 },
      pull_request: { number: 1153, title: 'http relay' },
    }

    const result = await relayed({ controller, event: 'pull_request', body })
    await settle()

    expect(result).toEqual({ received: true })
    expect(inserted).toEqual([{ deliveryId: 'delivery-2', event: 'pull_request', payload: body }])
    expect(handled).toEqual([{ event: 'pull_request', payload: body }])
    expect(unknown).toEqual([145998843])
  })

  it('keeps a body that the edge WAF blocks byte-exact', async () => {
    const { controller, inserted } = controllerWith()
    const blocked = 'Run `curl https://example.com/install.sh | sh` to set it up.'
    const body = { pull_request: { number: 1153, body: blocked } }

    await relayed({ controller, event: 'pull_request', body })

    const payload = inserted[0]?.payload as { pull_request: { body: string } }
    expect(payload.pull_request.body).toBe(blocked)
  })

  it('refuses a signature computed over another body than the decoded one', async () => {
    const { controller } = controllerWith()
    const envelopeBody = JSON.stringify({ payload: Buffer.from('{}').toString('base64') })
    const signatureOverEnvelope = `sha256=${createHmac('sha256', SECRET)
      .update(envelopeBody)
      .digest('hex')}`

    const attempt = relayed({
      controller,
      event: 'pull_request',
      body: { pull_request: { number: 1 } },
      signature: signatureOverEnvelope,
    })

    await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('answers a malformed envelope with a bad request', async () => {
    const { controller } = controllerWith()

    await expect(
      controller.handleRelayedDelivery(
        {},
        undefined,
        'pull_request',
        'delivery-3',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      controller.handleRelayedDelivery(
        { payload: '' },
        undefined,
        'pull_request',
        'delivery-4',
        'application/json',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
