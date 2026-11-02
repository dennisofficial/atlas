import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import type { BackgroundWork } from '../../../_core/ports/background-work'
import { GithubAppHookController } from './github-app-hook.controller'
import type { GithubAppInstallationsService } from './github-app-installations.service'
import type { GithubAppSyncService } from './github-app-sync.service'
import type { GithubDeliveryService } from './github-delivery.service'
import type { GithubWebhookInboxService } from './github-webhook-inbox.service'
import type { GithubPrWebhookRequest } from './github-webhook.types'

const SECRET = 'app-secret'

function controllerWith() {
  const unknown: number[] = []
  const syncNow: number[] = []
  const pending: Array<Promise<unknown>> = []
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
      handle: async () => ({ handled: true }),
    } as unknown as GithubDeliveryService,
    {
      applyInstallation: async () => undefined,
    } as unknown as GithubAppInstallationsService,
    new EnvService({ GITHUB_APP_WEBHOOK_SECRET: SECRET }),
    {
      insert: async () => true,
      markProcessed: async () => undefined,
    } as unknown as GithubWebhookInboxService,
    appSync,
    {
      keepAlive: (work: Promise<unknown>) => pending.push(work),
    } as unknown as BackgroundWork,
  )
  return { controller, unknown, syncNow, settle: () => Promise.all(pending) }
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
