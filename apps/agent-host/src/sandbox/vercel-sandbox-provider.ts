import { randomUUID } from 'node:crypto'

import { daemonToken } from '@dltech/atlas-protocol/engine'
import {
  imageOptimizeRetry,
  SANDBOX_QUICK_TIMEOUT_MS,
  settleRetry,
  type VercelCredentials,
} from './constants'
import { mountWithRetries } from './vercel-mount'
import { liveSdk, renewSessionDeadline, routedUrlOf, type VercelSdk } from './vercel-sdk'

import { launchDaemon, type DaemonBundle } from './daemon-launch'
import { SandboxProvider, sandboxNameOf, type DaemonEndpoint } from './sandbox-provider'

export class VercelSandboxProvider extends SandboxProvider {
  constructor(
    private readonly args: {
      image: string
      daemonBundle: DaemonBundle
      daemonSecret: string
      cloudUrl: string
      sdk?: VercelSdk | undefined
      log?: ((line: string) => void) | undefined
    },
  ) {
    super()
  }

  private get sdk(): VercelSdk {
    return this.args.sdk ?? liveSdk
  }

  async wake(args: {
    sessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const sandboxName = sandboxNameOf(args.sessionId)
    const token = daemonToken({ secret: this.args.daemonSecret, sandboxName })
    const sandbox = await mountWithRetries({
      sdk: this.sdk,
      cloudUrl: this.args.cloudUrl,
      retry: settleRetry,
      imageOptimize: imageOptimizeRetry,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
      credentials: args.credentials,
      name: sandboxName,
      image: this.args.image,
      threadId: args.sessionId,
      token: randomUUID(),
      environment: { ATLAS_SANDBOX_NAME: sandboxName },
      onCreate: () => Promise.resolve(),
    })
    await launchDaemon({
      sandbox,
      bundle: this.args.daemonBundle,
      token,
      sandboxName,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
    const routed = await routedUrlOf({
      sandbox,
      refetch: () =>
        this.sdk.get({
          ...args.credentials,
          name: sandboxName,
          signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
        }),
    })
    return {
      url: routed.replace(/^https:/, 'wss:'),
      token,
      sandboxName,
    }
  }

  async stop(args: { sessionId: string; credentials: VercelCredentials }): Promise<void> {
    const sandbox = await this.sdk.get({
      ...args.credentials,
      name: sandboxNameOf(args.sessionId),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  }

  async keepAlive(args: {
    sessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {
    const sandboxName = sandboxNameOf(args.sessionId)
    const sandbox = await this.sdk.get({
      ...args.credentials,
      name: sandboxName,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await renewSessionDeadline({
      sandbox,
      name: sandboxName,
      sessionId: args.sessionId,
      until: args.until,
    })
  }
}
