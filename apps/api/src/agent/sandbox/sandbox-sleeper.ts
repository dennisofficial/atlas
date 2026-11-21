import type { Db } from '@dltech/atlas-db'

import type { ConfigSource } from '../config/agent-host-config'
import { configSourceOf, type ConfigSourceEnv } from '../config/config-source'
import type { SecretCipher } from '../config/secret-cipher'
import { SandboxNotConfiguredError } from '../runtime/sandbox-not-configured-error'
import type { SandboxProviderRegistry } from './provider-registry'
import { sandboxProvidersOf, type SandboxProvidersEnv } from './sandbox-providers'
import { recordSandboxRunClose, sandboxCumulativeCpuMsOf } from './sandbox-runs'

export type SandboxSleeper = {
  sleep(args: { sandboxSessionId: string }): Promise<void>
}

/**
 * The operator's stop: a provider stop is a checkpoint for Agent37 and a snapshot for Vercel, and
 * the run it closes is the same one the idle sweep closes, so the pod's compute is billed once.
 */
export const sandboxSleeperOf = (args: {
  config: ConfigSource
  sandbox: SandboxProviderRegistry
}): SandboxSleeper => ({
  sleep: async ({ sandboxSessionId }) => {
    const config = await args.config.read({ sessionId: sandboxSessionId })
    if (config.sandbox.configured === false) {
      throw new SandboxNotConfiguredError(config.sandbox.gap)
    }
    const sandbox = args.sandbox.for(config.sandbox.provider)
    const target = { sandboxSessionId, credentials: config.sandbox.credentials }
    const cpuCumulativeMs = await sandboxCumulativeCpuMsOf({ sandbox, target })
    await sandbox.stop({ target })
    await recordSandboxRunClose({
      sessionId: sandboxSessionId,
      ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
    })
  },
})

export type PodSleeperEnv = ConfigSourceEnv & SandboxProvidersEnv

export const podSleeperOf = (args: {
  env: PodSleeperEnv
  db: Db
  cipher: SecretCipher
}): SandboxSleeper =>
  sandboxSleeperOf({
    config: configSourceOf(args),
    sandbox: sandboxProvidersOf(args),
  })
