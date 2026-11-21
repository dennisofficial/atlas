import type { PodShape } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

import type { ConfigSource } from '../config/agent-host-config'
import { configSourceOf, type ConfigSourceEnv } from '../config/config-source'
import type { SecretCipher } from '../config/secret-cipher'
import { SandboxNotConfiguredError } from '../runtime/sandbox-not-configured-error'
import type { SandboxProviderRegistry } from './provider-registry'
import type { PodResizeOutcome } from './sandbox-provider'
import { sandboxProvidersOf, type SandboxProvidersEnv } from './sandbox-providers'
import { recordSandboxRunClose, sandboxCumulativeCpuMsOf } from './sandbox-runs'

export type SandboxResizer = {
  resize(args: { sandboxSessionId: string; shape: PodShape }): Promise<PodResizeOutcome>
}

export const sandboxResizerOf = (args: {
  config: ConfigSource
  sandbox: SandboxProviderRegistry
}): SandboxResizer => ({
  resize: async ({ sandboxSessionId, shape }) => {
    const config = await args.config.read({ sessionId: sandboxSessionId })
    if (config.sandbox.configured === false) {
      throw new SandboxNotConfiguredError(config.sandbox.gap)
    }
    const sandbox = args.sandbox.for(config.sandbox.provider)
    const target = { sandboxSessionId, credentials: config.sandbox.credentials }
    const cpuCumulativeMs = await sandboxCumulativeCpuMsOf({ sandbox, target })
    await recordSandboxRunClose({
      sessionId: sandboxSessionId,
      sandboxStopped: false,
      ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
    })
    return await sandbox.resize({ target, shape })
  },
})

export type PodResizerEnv = ConfigSourceEnv & SandboxProvidersEnv

export const podResizerOf = (args: {
  env: PodResizerEnv
  db: Db
  cipher: SecretCipher
}): SandboxResizer =>
  sandboxResizerOf({
    config: configSourceOf(args),
    sandbox: sandboxProvidersOf(args),
  })
