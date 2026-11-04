import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelCredentials } from '@dltech/atlas-wire'

import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'

export class FixedEndpointSandboxProvider extends SandboxProvider {
  constructor(private readonly args: { url: string; daemonSecret: string }) {
    super()
  }

  async wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const sandboxName = sandboxNameOf(args.sessionId)
    return {
      url: this.args.url,
      token: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      sandboxName,
    }
  }

  async stop(_args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {}

  async keepAlive(_args: {
    sessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {}
}
