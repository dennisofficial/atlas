import { triggerLog } from '../trigger-logger'
import { EnvService } from '../../_core/config/env/env.service'
import { envConfigValidation } from '../../_core/config/env/validation'
import { ProcessBackgroundWork } from '../../_lib/background-work/background-work.providers'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../_lib/redis/redis.service'
import { GithubAppInstallationsService } from '../../api/cloud/github/github-app-installations.service'
import { GithubAppClient } from '../../api/cloud/github/github-app-client'
import { GithubInstallationTokens } from '../../api/cloud/github/github-installation-tokens'
import { GithubAppSyncGate } from '../../api/cloud/github/github-app-sync-gate'
import { GithubAppSyncService } from '../../api/cloud/github/github-app-sync.service'
import { GithubHookSweepService } from '../../api/cloud/github/github-hook-sweep.service'
import { GithubDeviceClient } from '../../api/cloud/github/github-device-client'
import { GithubHeadReads } from '../../api/cloud/github/github-head-reads'
import { GithubHookLifecycleService } from '../../api/cloud/github/github-hook-lifecycle.service'
import { GithubPollSweeperService } from '../../api/cloud/github/github-poll-sweeper.service'
import { GithubDeliveryService } from '../../api/cloud/github/github-delivery.service'
import { GithubPrDiscussionDeliveryService } from '../../api/cloud/github/github-pr-discussion-delivery.service'
import { GithubWebhookInboxService } from '../../api/cloud/github/github-webhook-inbox.service'
import { GithubPrFanoutService } from '../../api/cloud/github/github-pr-fanout.service'
import { buildPrApplyWiring } from '../../api/cloud/github/github-pr-apply-wiring'
import { GithubFillTokens } from '../../api/cloud/github/github-fill-token'
import type { GithubPrOutboxDispatcher } from '../../api/cloud/github/github-pr-outbox'
import type { GithubPrStore } from '../../api/cloud/github/github-pr-store'
import {
  LocalPrFrameBus,
  RedisPrFrameBus,
  type PrFrameBus,
} from '../../api/cloud/github/github-pr-fanout.transport'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import { WAKE_DEBOUNCE_MS } from '../../api/cloud/github/github-sandbox-wake-debounce'
import { GithubSandboxWakeService } from '../../api/cloud/github/github-sandbox-wake.service'
import { threadActivityAt } from '../../api/cloud/github/github-thread-activity'
import { GithubUserReads } from '../../api/cloud/github/github-user-reads'
import { GithubService } from '../../api/cloud/github/github.service'
import { GithubRequestCoordinator } from '../../api/cloud/github/github-request-coordinator'
import { ScopedSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/scoped-sandbox-credentials.service'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { DrainStateService } from '../../api/platform/health/drain-state.service'
import { buildWorkerThreadSignals } from '../thread-signals-graph'

export type GithubSweepGraph = {
  pollSweeper: GithubPollSweeperService
  hookLifecycle: GithubHookLifecycleService
  hookSweep: GithubHookSweepService
  webhookInbox: GithubWebhookInboxService
  deliveries: GithubDeliveryService
  wake: GithubSandboxWakeService
  store: GithubPrStore
  outbox: GithubPrOutboxDispatcher
  dispose: () => Promise<void>
}

export function workerEnvService(): EnvService {
  const { value, error } = envConfigValidation.validate(process.env, {
    allowUnknown: true,
    abortEarly: false,
  })
  if (error) throw new Error(`invalid environment:\n${error.message}`)
  return new EnvService(value)
}

export function buildGithubSweepGraph(args: { env: EnvService }): GithubSweepGraph {
  const { env } = args
  const cipher = new SecretCipherService(env)
  const redis = new RedisService(env)
  if (!redis.isConfigured()) {
    triggerLog.warn(
      'Without Redis the GitHub request budget and PR frames stay in this process; the API and this worker cannot share them',
    )
  }
  const bus: PrFrameBus = redis.isConfigured() ? new RedisPrFrameBus(redis) : new LocalPrFrameBus()
  const github = new GithubService(cipher, env, new GithubDeviceClient({}))
  const reads = new GithubUserReads()
  const coordinator = new GithubRequestCoordinator(redis, github)
  const fanout = new GithubPrFanoutService(new DrainStateService(), bus)
  const workerSignals = buildWorkerThreadSignals({ env })
  const wake = new GithubSandboxWakeService(
    env,
    cipher,
    new ScopedSandboxCredentialsService(buildScopedConfig({ cipher, env }), env),
    sandboxWakeBootProvider.useFactory(),
    new ProcessBackgroundWork(),
    WAKE_DEBOUNCE_MS,
    workerSignals.signals,
    fanout,
  )
  const installations = new GithubAppInstallationsService()
  const appClient = new GithubAppClient(env)
  const appTokens = new GithubInstallationTokens(appClient, installations)
  const fillTokens = new GithubFillTokens({ github, appTokens })
  const {
    store,
    dispatcher: outbox,
    mailbox,
  } = buildPrApplyWiring({
    fanout,
    legacy: {
      threadChanged: (changed) => workerSignals.signals.threadChanged(changed),
      notifyEvent: (notice, event) => wake.notifyEvent(notice, event),
    },
    reads,
    budget: coordinator,
    fillTokenOf: (args) => fillTokens.find(args),
  })
  const hookLifecycle = new GithubHookLifecycleService(
    github,
    reads,
    cipher,
    env,
    installations,
    coordinator,
  )
  const syncGate = new GithubAppSyncGate(redis)
  const hookSweep = new GithubHookSweepService(
    new GithubAppSyncService(appClient, installations, syncGate),
    hookLifecycle,
    installations,
    github,
    reads,
    syncGate,
  )

  return {
    wake,
    store,
    outbox,
    pollSweeper: new GithubPollSweeperService(
      github,
      reads,
      hookLifecycle,
      coordinator,
      new GithubHeadReads(),
      store,
      threadActivityAt,
    ),
    hookLifecycle,
    hookSweep,
    webhookInbox: new GithubWebhookInboxService(),
    deliveries: new GithubDeliveryService(
      github,
      reads,
      fanout,
      cipher,
      mailbox,
      new GithubPrDiscussionDeliveryService(mailbox),
      coordinator,
      store,
      appTokens,
    ),
    dispose: async () => {
      await wake.settle()
      await workerSignals.dispose()
      await fanout.onModuleDestroy()
      await redis.onModuleDestroy()
    },
  }
}

export async function withGithubSweepGraph<T>(args: {
  run: (graph: GithubSweepGraph) => Promise<T>
}): Promise<T> {
  const graph = buildGithubSweepGraph({ env: workerEnvService() })
  try {
    return await args.run(graph)
  } finally {
    await graph.dispose()
  }
}
