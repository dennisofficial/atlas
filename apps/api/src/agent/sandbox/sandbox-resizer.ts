import type { ConfigSource } from '../config/agent-host-config'
import { SandboxNotConfiguredError } from '../runtime/sandbox-not-configured-error'
import type { SandboxProviderRegistry } from './provider-registry'
import type { PodResizeOutcome } from './sandbox-provider'

export type SandboxResizer = {
  resize(args: { sandboxSessionId: string; vcpus: number }): Promise<PodResizeOutcome>
}

export const sandboxResizerOf = (args: {
  config: ConfigSource
  sandbox: SandboxProviderRegistry
}): SandboxResizer => ({
  resize: async ({ sandboxSessionId, vcpus }) => {
    const config = await args.config.read({ sessionId: sandboxSessionId })
    if (config.sandbox.configured === false) {
      throw new SandboxNotConfiguredError(config.sandbox.gap)
    }
    return await args.sandbox.for(config.sandbox.provider).resize({
      target: { sandboxSessionId, credentials: config.sandbox.credentials },
      vcpus,
    })
  },
})
