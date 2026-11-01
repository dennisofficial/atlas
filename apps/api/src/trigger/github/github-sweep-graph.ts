import { Logger } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { envConfigValidation } from '../../_core/config/env/validation'
import { ProcessBackgroundWork } from '../../_lib/background-work/background-work.providers'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { RedisService } from '../../_lib/redis/redis.service'
import { GithubAppInstallationsService } from '../../api/cloud/github/github-app-installations.service'
import { GithubDeviceClient } from '../../api/cloud/github/github-device-client'
import { GithubHookLifecycleService } from '../../api/cloud/github/github-hook-lifecycle.service'
import { GithubPollSweeperService } from '../../api/cloud/github/github-poll-sweeper.service'
import { GithubPrEventMailboxService } from '../../api/cloud/github/github-pr-event-mailbox.service'
import { GithubPrFanoutService } from '../../api/cloud/github/github-pr-fanout.service'
import {
  LocalPrFrameBus,
  RedisPrFrameBus,
  type PrFrameBus,
} from '../../api/cloud/github/github-pr-fanout.transport'
import { sandboxWakeBootProvider } from '../../api/cloud/github/github-sandbox-wake-boot'
import { WAKE_DEBOUNCE_MS } from '../../api/cloud/github/github-sandbox-wake-debounce'
import { GithubSandboxWakeService } from '../../api/cloud/github/github-sandbox-wake.service'
import { GithubUserReads } from '../../api/cloud/github/github-user-reads'
import { GithubService } from '../../api/cloud/github/github.service'
import { GithubObservationStore } from '../../api/cloud/github/github-observation.store'
import { ThreadSandboxCredentialsService } from '../../api/cloud/sandbox-credentials/thread-sandbox-credentials.service'
import { ScopedConfigService } from '../../api/cloud/scoped-config/scoped-config.service'
import { DrainStateService } from '../../api/platform/health/drain-state.service'
import { buildWorkerThreadSignals } from '../thread-signals-graph'

export type GithubSweepGraph = {
  pollSweeper: GithubPollSweeperService
  hookLifecycle: GithubHookLifecycleService
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
    new Logger('GithubSweepGraph').warn(
      'GitHub observation leases are same-process only without Redis; a separate worker cannot share API view leases',
    )
  }
  const bus: PrFrameBus = redis.isConfigured() ? new RedisPrFrameBus(redis) : new LocalPrFrameBus()
  const github = new GithubService(cipher, env, new GithubDeviceClient({}))
  const reads = new GithubUserReads()
  const observations = new GithubObservationStore(redis, github)
  const fanout = new GithubPrFanoutService(new DrainStateService(), bus)
  const workerSignals = buildWorkerThreadSignals({ env })
  const wake = new GithubSandboxWakeService(
    env,
    cipher,
    new ThreadSandboxCredentialsService(new ScopedConfigService(cipher), env),
    sandboxWakeBootProvider.useFactory(),
    new ProcessBackgroundWork(),
    WAKE_DEBOUNCE_MS,
    workerSignals.signals,
    fanout,
  )
  const mailbox = new GithubPrEventMailboxService(fanout, wake)
  const hookLifecycle = new GithubHookLifecycleService(
    github,
    reads,
    cipher,
    env,
    new GithubAppInstallationsService(),
    observations,
  )

  return {
    pollSweeper: new GithubPollSweeperService(
      github,
      reads,
      fanout,
      mailbox,
      workerSignals.signals,
      hookLifecycle,
      observations,
    ),
    hookLifecycle,
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
