import type { Provider } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../../_lib/redis/redis.service'
import { GithubAppClient } from './github-app-client'
import { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncGate } from './github-app-sync-gate'
import { GithubAppSyncService } from './github-app-sync.service'
import { GithubConfig } from './github-config'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubHeadReads } from './github-head-reads'
import { GithubHookLifecycleService } from './github-hook-lifecycle.service'
import { GithubHookSweepService } from './github-hook-sweep.service'
import { GithubInstallationTokens } from './github-installation-tokens'
import { GithubPrDiscussionDeliveryService } from './github-pr-discussion-delivery.service'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { LocalPrFrameBus, PrFrameBus, RedisPrFrameBus } from './github-pr-fanout.transport'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrStore } from './github-pr-store'
import { GithubRequestCoordinator } from './github-request-coordinator'
import { GithubUserReads } from './github-user-reads'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'
import { GithubService } from './github.service'

export const prFrameBusProvider: Provider = {
  provide: PrFrameBus,
  inject: [RedisService],
  useFactory: (redis: RedisService): PrFrameBus =>
    redis.isConfigured() ? new RedisPrFrameBus(redis) : new LocalPrFrameBus(),
}

export const githubUserReadsProvider: Provider = {
  provide: GithubUserReads,
  useFactory: (): GithubUserReads => new GithubUserReads(),
}

export const githubHeadReadsProvider: Provider = {
  provide: GithubHeadReads,
  useFactory: (): GithubHeadReads => new GithubHeadReads(),
}

export const githubWebhookInboxProvider: Provider = {
  provide: GithubWebhookInboxService,
  useFactory: (): GithubWebhookInboxService => new GithubWebhookInboxService(),
}

export const githubAppClientProvider: Provider = {
  provide: GithubAppClient,
  inject: [GithubConfig],
  useFactory: (config: GithubConfig): GithubAppClient => new GithubAppClient(config),
}

export const githubAppInstallationsProvider: Provider = {
  provide: GithubAppInstallationsService,
  useFactory: (): GithubAppInstallationsService => new GithubAppInstallationsService(),
}

export const githubAppSyncGateProvider: Provider = {
  provide: GithubAppSyncGate,
  inject: [RedisService],
  useFactory: (redis: RedisService): GithubAppSyncGate => new GithubAppSyncGate(redis),
}

export const githubAppSyncServiceProvider: Provider = {
  provide: GithubAppSyncService,
  inject: [GithubAppClient, GithubAppInstallationsService, GithubAppSyncGate],
  useFactory: (
    client: GithubAppClient,
    installations: GithubAppInstallationsService,
    gate: GithubAppSyncGate,
  ): GithubAppSyncService => new GithubAppSyncService(client, installations, gate),
}

export const githubAppInstallNoticeProvider: Provider = {
  provide: GithubAppInstallNoticeService,
  inject: [GithubAppInstallationsService, GithubConfig],
  useFactory: (
    installations: GithubAppInstallationsService,
    config: GithubConfig,
  ): GithubAppInstallNoticeService => new GithubAppInstallNoticeService(installations, config),
}

export const githubInstallationTokensProvider: Provider = {
  provide: GithubInstallationTokens,
  inject: [GithubAppClient, GithubAppInstallationsService],
  useFactory: (
    client: GithubAppClient,
    installations: GithubAppInstallationsService,
  ): GithubInstallationTokens => new GithubInstallationTokens(client, installations),
}

export const githubHookLifecycleProvider: Provider = {
  provide: GithubHookLifecycleService,
  inject: [
    GithubService,
    GithubUserReads,
    SecretCipherService,
    GithubConfig,
    GithubAppInstallationsService,
    GithubRequestCoordinator,
  ],
  useFactory: (
    github: GithubService,
    reads: GithubUserReads,
    cipher: SecretCipherService,
    config: GithubConfig,
    installations: GithubAppInstallationsService,
    coordinator: GithubRequestCoordinator,
  ): GithubHookLifecycleService =>
    new GithubHookLifecycleService(github, reads, cipher, config, installations, coordinator),
}

export const githubHookSweepProvider: Provider = {
  provide: GithubHookSweepService,
  inject: [
    GithubAppSyncService,
    GithubHookLifecycleService,
    GithubAppInstallationsService,
    GithubService,
    GithubUserReads,
    GithubAppSyncGate,
  ],
  useFactory: (
    appSync: GithubAppSyncService,
    lifecycle: GithubHookLifecycleService,
    installations: GithubAppInstallationsService,
    github: GithubService,
    reads: GithubUserReads,
    gate: GithubAppSyncGate,
  ): GithubHookSweepService =>
    new GithubHookSweepService(appSync, lifecycle, installations, github, reads, gate),
}

export const githubPrFanoutProvider: Provider = {
  provide: GithubPrFanoutService,
  inject: [DrainStateService, PrFrameBus],
  useFactory: (drain: DrainStateService, bus: PrFrameBus): GithubPrFanoutService =>
    new GithubPrFanoutService(drain, bus),
}

export const githubPrDiscussionDeliveryProvider: Provider = {
  provide: GithubPrDiscussionDeliveryService,
  inject: [GithubPrEventMailboxService],
  useFactory: (mailbox: GithubPrEventMailboxService): GithubPrDiscussionDeliveryService =>
    new GithubPrDiscussionDeliveryService(mailbox),
}

export const githubDeliveryProvider: Provider = {
  provide: GithubDeliveryService,
  inject: [
    GithubService,
    GithubUserReads,
    GithubPrFanoutService,
    SecretCipherService,
    GithubPrEventMailboxService,
    GithubPrDiscussionDeliveryService,
    GithubRequestCoordinator,
    GithubPrStore,
    GithubInstallationTokens,
  ],
  useFactory: (
    github: GithubService,
    reads: GithubUserReads,
    fanout: GithubPrFanoutService,
    cipher: SecretCipherService,
    mailbox: GithubPrEventMailboxService,
    discussion: GithubPrDiscussionDeliveryService,
    coordinator: GithubRequestCoordinator,
    store: GithubPrStore,
    appTokens: GithubInstallationTokens,
  ): GithubDeliveryService =>
    new GithubDeliveryService(
      github,
      reads,
      fanout,
      cipher,
      mailbox,
      discussion,
      coordinator,
      store,
      appTokens,
    ),
}
