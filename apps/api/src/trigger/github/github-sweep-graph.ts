import { EnvService } from '../../_core/config/env/env.service'
import { envConfigValidation } from '../../_core/config/env/validation'
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
import { GithubSandboxWakeService } from '../../api/cloud/github/github-sandbox-wake.service'
import { GithubUserReads } from '../../api/cloud/github/github-user-reads'
import { GithubService } from '../../api/cloud/github/github.service'
import { DrainStateService } from '../../api/platform/health/drain-state.service'

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
  const bus: PrFrameBus = redis.isConfigured() ? new RedisPrFrameBus(redis) : new LocalPrFrameBus()
  const github = new GithubService(cipher, env, new GithubDeviceClient({}))
  const reads = new GithubUserReads()
  const fanout = new GithubPrFanoutService(new DrainStateService(), bus)
  const wake = new GithubSandboxWakeService(env, cipher, sandboxWakeBootProvider.useFactory())
  const mailbox = new GithubPrEventMailboxService(fanout, wake)

  return {
    pollSweeper: new GithubPollSweeperService(github, reads, fanout, mailbox),
    hookLifecycle: new GithubHookLifecycleService(
      github,
      reads,
      cipher,
      env,
      new GithubAppInstallationsService(),
    ),
    dispose: async () => {
      await wake.settle()
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
