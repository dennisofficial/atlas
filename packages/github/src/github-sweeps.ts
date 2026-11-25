import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncGate } from './github-app-sync-gate'
import { GithubAppSyncService } from './github-app-sync.service'
import type { GithubConfig } from './github-config'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubDeviceClient } from './github-device-client'
import { GithubFillTokens } from './github-fill-token'
import { GithubHeadReads } from './github-head-reads'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubHookSweepService } from './github-hook-sweep.service'
import { GithubInstallationTokens } from './github-installation-tokens'
import { GithubPollSweeperService } from './github-poll-sweeper.service'
import { buildPrApplyWiring } from './github-pr-apply-wiring'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { LocalPrFrameBus, type PrFrameBus, RedisPrFrameBus } from './github-pr-fanout.transport'
import type { GithubPrOutboxDispatcher } from './github-pr-outbox'
import type { GithubPrStore } from './github-pr-store'
import type { GithubRedis, GithubSecretCipher } from './github-ports'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { GithubService } from './github.service'
import { GithubUserReads } from './github-user-reads'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'

export type GithubSweeps = {
  pollSweeper: GithubPollSweeperService
  hookSweep: GithubHookSweepService
  webhookInbox: GithubWebhookInboxService
  deliveries: GithubDeliveryService
  outbox: GithubPrOutboxDispatcher
  store: GithubPrStore
  fanout: GithubPrFanoutService
  dispose: () => Promise<void>
}

export function buildGithubSweeps(args: {
  config: GithubConfig
  cipher: GithubSecretCipher
  redis: GithubRedis
}): GithubSweeps {
  const bus: PrFrameBus = args.redis.isConfigured()
    ? new RedisPrFrameBus(args.redis)
    : new LocalPrFrameBus()
  const github = new GithubService(args.cipher, args.config, new GithubDeviceClient({}))
  const reads = new GithubUserReads()
  const coordinator = new GithubRequestCoordinator(args.redis, github)
  const fanout = new GithubPrFanoutService({ onDrain: () => undefined }, bus)
  const installations = new GithubAppInstallationsService()
  const appClient = new GithubAppClient(args.config)
  const appTokens = new GithubInstallationTokens(appClient, installations)
  const fillTokens = new GithubFillTokens({ github, appTokens })
  const {
    store,
    dispatcher: outbox,
    mailbox,
  } = buildPrApplyWiring({
    fanout,
    reads,
    budget: coordinator,
    fillTokenOf: (request) => fillTokens.find(request),
  })
  const hookLifecycle = new GithubHookLifecycleService(
    github,
    reads,
    args.cipher,
    args.config,
    installations,
    coordinator,
  )
  const syncGate = new GithubAppSyncGate(args.redis)

  return {
    pollSweeper: new GithubPollSweeperService(
      github,
      reads,
      hookLifecycle,
      coordinator,
      new GithubHeadReads(),
      store,
    ),
    hookSweep: new GithubHookSweepService(
      new GithubAppSyncService(appClient, installations, syncGate),
      hookLifecycle,
      installations,
      github,
      reads,
      syncGate,
    ),
    webhookInbox: new GithubWebhookInboxService(),
    deliveries: new GithubDeliveryService(
      github,
      reads,
      fanout,
      args.cipher,
      mailbox,
      new GithubPrDiscussionDeliveryService(mailbox),
      coordinator,
      store,
      appTokens,
    ),
    outbox,
    store,
    fanout,
    dispose: async () => {
      await fanout.onModuleDestroy()
    },
  }
}
