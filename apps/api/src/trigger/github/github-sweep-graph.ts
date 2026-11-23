import { triggerLog } from '../trigger-logger'
import { EnvService } from '../../_core/config/env/env.service'
import { validatedEnvService } from '../../_core/config/env/validated-env'
import { ProcessBackgroundWork } from '../../_lib/background-work/background-work.providers'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../_lib/redis/redis.service'
import { GithubAppInstallationsService } from '@dltech/atlas-github'
import { githubConfigOf } from '../../api/cloud/github/github.providers'
import { GithubAppClient } from '@dltech/atlas-github'
import { GithubDeviceClient } from '@dltech/atlas-github'
import { GithubHeadReads } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubInstallationTokens } from '@dltech/atlas-github'
import { GithubHookLifecycleService } from '@dltech/atlas-github'
import { GithubPollSweeperService } from '@dltech/atlas-github'
import { buildPrApplyWiring } from '@dltech/atlas-github'
import { GithubFillTokens } from '@dltech/atlas-github'
import type { GithubPrOutboxDispatcher } from '@dltech/atlas-github'
import type { GithubPrStore } from '@dltech/atlas-github'
import { LocalPrFrameBus, RedisPrFrameBus, type PrFrameBus } from '@dltech/atlas-github'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import { WAKE_DEBOUNCE_MS } from '../../api/cloud/github/github-sandbox-wake-debounce'
import { GithubSandboxWakeService } from '../../api/cloud/github/github-sandbox-wake.service'
import { threadActivityAt } from '../../api/cloud/github/github-thread-activity'
import { GithubUserReads } from '@dltech/atlas-github'
import { GithubService } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { ScopedSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/scoped-sandbox-credentials.service'
import { buildScopedConfig } from '../../api/cloud/scoped-config/scoped-config.factory'
import { DrainStateService } from '../../api/platform/health/drain-state.service'
import { buildWorkerThreadSignals } from '../thread-signals-graph'
import { Logger } from '@nestjs/common'
import { setGithubLogSink } from '@dltech/atlas-github'

setGithubLogSink((context) => new Logger(context))

export type GithubSweepGraph = {
  pollSweeper: GithubPollSweeperService
  wake: GithubSandboxWakeService
  store: GithubPrStore
  outbox: GithubPrOutboxDispatcher
  dispose: () => Promise<void>
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
  const config = githubConfigOf(env)
  const github = new GithubService(cipher, config, new GithubDeviceClient({}))
  const reads = new GithubUserReads()
  const coordinator = new GithubRequestCoordinator(redis, github)
  const fanout = new GithubPrFanoutService(new DrainStateService(), bus)
  const workerSignals = buildWorkerThreadSignals({ env })
  const wake = new GithubSandboxWakeService(
    env,
    cipher,
    new ScopedSandboxCredentialsService(buildScopedConfig({ cipher, env })),
    sandboxWakeBootProvider.useFactory(),
    new ProcessBackgroundWork(),
    WAKE_DEBOUNCE_MS,
    workerSignals.signals,
    fanout,
  )
  const installations = new GithubAppInstallationsService()
  const appClient = new GithubAppClient(config)
  const appTokens = new GithubInstallationTokens(appClient, installations)
  const fillTokens = new GithubFillTokens({ github, appTokens })
  const { store, dispatcher: outbox } = buildPrApplyWiring({
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
    config,
    installations,
    coordinator,
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
  const graph = buildGithubSweepGraph({ env: validatedEnvService() })
  try {
    return await args.run(graph)
  } finally {
    await graph.dispose()
  }
}
