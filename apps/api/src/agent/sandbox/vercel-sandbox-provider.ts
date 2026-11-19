import { randomUUID } from 'node:crypto'

import type { Sandbox } from '@vercel/sandbox'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import {
  imageOptimizeRetry,
  SANDBOX_QUICK_TIMEOUT_MS,
  settleRetry,
  type VercelCredentials,
} from './constants'
import { mountWithRetries } from './vercel-mount'
import { liveSdk, renewSessionDeadline, routedUrlOf, type VercelSdk } from './vercel-sdk'
import { isSandboxMissing } from './vercel-errors'

import { launchDaemon, type DaemonBundle } from './daemon-launch'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxTarget,
} from './sandbox-provider'
import { sandboxNameOf } from './vercel-names'
import { abortedWake, WAKE_DEADLINE_MS } from './wake-deadline'

export { WAKE_DEADLINE_MS }

const vercelCredentialsOf = (target: SandboxTarget): VercelCredentials => {
  const credentials = target.credentials
  if (credentials.provider !== ESandboxProvider.Vercel)
    throw new Error(`VercelSandboxProvider cannot run a ${credentials.provider} sandbox`)
  return credentials
}

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
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint> {
    const credentials = vercelCredentialsOf(args.target)
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.args.wakeDeadlineMs ?? WAKE_DEADLINE_MS),
      args.signal,
    ])
    const waking = this.wakeWithin({
      target: args.target,
      credentials,
      signal,
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
    })
    waking.catch(() => undefined)
    return Promise.race([waking, abortedWake({ signal, caller: args.signal })])
  }

  private async wakeWithin(args: {
    target: SandboxTarget
    credentials: VercelCredentials
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint> {
    const sandboxSessionId = args.target.sandboxSessionId
    const sandboxName = sandboxNameOf(sandboxSessionId)
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
      threadId: sandboxSessionId,
      token: randomUUID(),
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
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
    const vcpus = sandbox.status === 'running' ? sandbox.currentSession().vcpus : sandbox.vcpus
    return {
      url: routed.replace(/^https:/, 'wss:'),
      token,
      sandboxName,
      ...(vcpus === undefined ? {} : { vcpus }),
    }
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    const credentials = vercelCredentialsOf(args.target)
    const sandbox = await this.sdk.get({
      ...credentials,
      name: sandboxNameOf(args.target.sandboxSessionId),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    const credentials = vercelCredentialsOf(args.target)
    const sandboxName = sandboxNameOf(args.target.sandboxSessionId)
    const sandbox = await this.sdk.get({
      ...credentials,
      name: sandboxName,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await renewSessionDeadline({
      sandbox,
      name: sandboxName,
      sessionId: args.target.sandboxSessionId,
      until: args.until,
    })
  }

  async resize(args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome> {
    const credentials = vercelCredentialsOf(args.target)
    const signal = AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS)
    let sandbox: Sandbox
    try {
      sandbox = await this.sdk.get({
        ...credentials,
        name: sandboxNameOf(args.target.sandboxSessionId),
        resume: false,
        signal,
      })
    } catch (failure) {
      if (isSandboxMissing(failure)) return 'absent'
      throw failure
    }
    await sandbox.update({ resources: { vcpus: args.vcpus } }, { signal })
    if (sandbox.status === 'stopped') return 'stored'
    await sandbox.stop({ signal })
    return 'restarted'
  }
}
