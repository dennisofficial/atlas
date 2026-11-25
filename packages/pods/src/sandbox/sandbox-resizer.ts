import type { PodShape } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

import type { PodsEnv } from '../env'

import type { SandboxConfigSource } from '../config/sandbox-config'
import { sandboxConfigSourceOf } from '../config/sandbox-config'
import { SandboxNotConfiguredError } from '../runtime/sandbox-not-configured-error'
import type { SandboxProviderRegistry } from './provider-registry'
import type { PodResizeOutcome } from './sandbox-provider'
import { sandboxProvidersOf, type SandboxProvidersEnv } from './sandbox-providers'
import { recordSandboxRunClose, sandboxCumulativeCpuMsOf } from './sandbox-runs'

export type SandboxResizer = {
  resize(args: {
    sandboxSessionId: string
    shape: PodShape
    diskGb?: number | undefined
  }): Promise<PodResizeOutcome>
}

export const sandboxResizerOf = (args: {
  config: SandboxConfigSource
  sandbox: SandboxProviderRegistry
}): SandboxResizer => ({
  resize: async ({ sandboxSessionId, shape, diskGb }) => {
    const config = await args.config.read({ sessionId: sandboxSessionId })
    if (config.configured === false) {
      throw new SandboxNotConfiguredError(config.gap)
    }
    const sandbox = args.sandbox.for(config.provider)
    const target = { sandboxSessionId, credentials: config.credentials }
    const cpuCumulativeMs = await sandboxCumulativeCpuMsOf({ sandbox, target })
    await recordSandboxRunClose({
      sessionId: sandboxSessionId,
      ...(cpuCumulativeMs === undefined ? {} : { cpuCumulativeMs }),
    })
    return await sandbox.resize({
      target,
      shape,
      ...(diskGb === undefined ? {} : { diskGb }),
    })
  },
})

export type PodResizerEnv = PodsEnv & SandboxProvidersEnv

export const podResizerOf = (args: { env: PodResizerEnv; db: Db }): SandboxResizer =>
  sandboxResizerOf({
    config: sandboxConfigSourceOf(args),
    sandbox: sandboxProvidersOf(args),
  })
