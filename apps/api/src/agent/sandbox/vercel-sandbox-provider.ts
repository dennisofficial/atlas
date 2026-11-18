import { randomUUID } from 'node:crypto'

import { SandboxUnavailableError } from '@dltech/atlas-host'
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

export const WAKE_DEADLINE_MS = 5 * 60_000

const abortedWake = (args: { signal: AbortSignal; caller: AbortSignal }): Promise<never> =>
  new Promise((_, reject) => {
    const fail = (): void =>
      reject(
        new SandboxUnavailableError(
          args.caller.aborted
            ? 'waking the sandbox was cancelled'
            : 'the sandbox did not wake within 5 minutes',
        ),
      )
    if (args.signal.aborted) fail()
    else args.signal.addEventListener('abort', fail, { once: true })
  })

export class VercelSandboxProvider extends SandboxProvider {
  constructor(
    private readonly args: {
      image: string
      daemonBundle: DaemonBundle
      daemonSecret: string
      cloudUrl: string
      sdk?: VercelSdk | undefined
      wakeDeadlineMs?: number | undefined
      log?: ((line: string) => void) | undefined
    },
  ) {
    super()
  }

  private get sdk(): VercelSdk {
    return this.args.sdk ?? liveSdk
  }

  async wake(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.args.wakeDeadlineMs ?? WAKE_DEADLINE_MS),
      args.signal,
    ])
    const waking = this.wakeWithin({ ...args, signal })
    waking.catch(() => undefined)
    return Promise.race([waking, abortedWake({ signal, caller: args.signal })])
  }

  private async wakeWithin(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const sandboxName = sandboxNameOf(args.sandboxSessionId)
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
      threadId: args.sandboxSessionId,
      token: randomUUID(),
      environment: { ATLAS_SANDBOX_NAME: sandboxName },
      onCreate: () => Promise.resolve(),
      signal: args.signal,
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

  async stop(args: { sandboxSessionId: string; credentials: VercelCredentials }): Promise<void> {
    const sandbox = await this.sdk.get({
      ...args.credentials,
      name: sandboxNameOf(args.sandboxSessionId),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  }

  async keepAlive(args: {
    sandboxSessionId: string
    credentials: VercelCredentials
    until: number
  }): Promise<void> {
    const sandboxName = sandboxNameOf(args.sandboxSessionId)
    const sandbox = await this.sdk.get({
      ...args.credentials,
      name: sandboxName,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await renewSessionDeadline({
      sandbox,
      name: sandboxName,
      sessionId: args.sandboxSessionId,
      until: args.until,
    })
  }
}
