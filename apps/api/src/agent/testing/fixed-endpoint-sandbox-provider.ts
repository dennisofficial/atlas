import { readFileSync } from 'node:fs'

import { daemonToken } from '@dltech/atlas-protocol/engine'

import {
  SandboxProvider,
  type DaemonEndpoint,
  type SandboxTarget,
} from '../sandbox/sandbox-provider'
import { sandboxNameOf } from '../sandbox/vercel-names'

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

  async wake(args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    const sandboxName = sandboxNameOf(args.target.sandboxSessionId)
    return {
      url: this.urlOf(args.target.sandboxSessionId),
      token: daemonToken({ secret: this.args.daemonSecret, sandboxName }),
      sandboxName,
    }
  }

  private urlOf(sandboxSessionId: string): string {
    if (this.args.urlFile !== undefined) return readFileSync(this.args.urlFile, 'utf8').trim()
    return this.args.urls?.[sandboxSessionId] ?? this.args.url
  }

  async stop(_args: { target: SandboxTarget }): Promise<void> {}

  async keepAlive(_args: { target: SandboxTarget; until: number }): Promise<void> {}

  async resize(_args: { target: SandboxTarget; vcpus: number }): Promise<void> {}
}
