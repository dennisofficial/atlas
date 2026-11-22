import type { Provider } from '@nestjs/common'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../../_lib/redis/redis.service'
import { GithubAppClient } from '@dltech/atlas-github'
import { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import { GithubAppInstallationsService } from '@dltech/atlas-github'
import { GithubAppSyncGate } from '@dltech/atlas-github'
import { GithubAppSyncService } from '@dltech/atlas-github'
import { GithubConfig } from '@dltech/atlas-github'
import { GithubDeliveryService } from '@dltech/atlas-github'
import { GithubHeadReads } from '@dltech/atlas-github'
import { GithubHookLifecycleService } from '@dltech/atlas-github'
import { GithubHookSweepService } from '@dltech/atlas-github'
import { GithubInstallationTokens } from '@dltech/atlas-github'
import { GithubPrDiscussionDeliveryService } from '@dltech/atlas-github'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { LocalPrFrameBus, PrFrameBus, RedisPrFrameBus } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubPrStore } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubUserReads } from '@dltech/atlas-github'
import { GithubWebhookInboxService } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'

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
