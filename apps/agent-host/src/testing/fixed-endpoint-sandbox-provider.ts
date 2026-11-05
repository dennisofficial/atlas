import { readFileSync } from 'node:fs'

import { daemonToken } from '@dltech/atlas-protocol/engine'
import type { VercelCredentials } from '../sandbox/constants'

import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from '../sandbox/sandbox-provider'

export class FixedEndpointSandboxProvider extends SandboxProvider {
  constructor(
    private readonly args: {
      url: string
      daemonSecret: string
      urls?: Record<string, string> | undefined
      urlFile?: string | undefined
    },
  ) {
    super()
  }

  async wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const sandboxName = sandboxNameOf(args.sessionId)
    return {
      url: this.urlOf(args.sessionId),
      token: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      sandboxName,
    }
  }

  private urlOf(sessionId: string): string {
    if (this.args.urlFile !== undefined) return readFileSync(this.args.urlFile, 'utf8').trim()
    return this.args.urls?.[sessionId] ?? this.args.url
  }

  async stop(_args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {}

  async keepAlive(_args: {
    sessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {}
}
