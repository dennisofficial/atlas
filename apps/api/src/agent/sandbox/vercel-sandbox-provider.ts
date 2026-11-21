import { randomUUID } from 'node:crypto'

import type { Sandbox } from '@vercel/sandbox'

import { ESandboxProvider } from '@dltech/atlas-protocol'
import {
  type PodShape,
  SANDBOX_MEMORY_GB_PER_VCPU,
  VERCEL_CGROUP_CPU_BILLING_FACTOR,
} from '@dltech/atlas-core'
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
import { daemonCpuUsecOf } from './daemon-cpu'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from './sandbox-provider'
import { podSessionIdOfSandboxName, sandboxNameOf } from './vercel-names'
import { abortedWake, WAKE_DEADLINE_MS } from './wake-deadline'

/** Vercel's list endpoints reject a limit above 50. */
const LIST_PAGE_LIMIT = 50
const NS_PER_MS = 1_000

export { WAKE_DEADLINE_MS }

const vercelCredentialsOf = (given: SandboxCredentials): VercelCredentials => {
  if (given.provider !== ESandboxProvider.Vercel)
    throw new Error(`VercelSandboxProvider cannot run a ${given.provider} sandbox`)
  return given
}

export const vercelBilledCpuMsOfUsec = (usec: number): number =>
  Math.round((usec / NS_PER_MS) * VERCEL_CGROUP_CPU_BILLING_FACTOR)

/** Vercel fills `totalActiveCpuDurationMs` in once the VM has finished stopping; a running sandbox reads 0. */
const vercelCpuMsOf = async (args: {
  sandbox: Sandbox
  daemonSecret: string
  sandboxSessionId: string
}): Promise<number | undefined> => {
  const usage = args.sandbox as { totalActiveCpuDurationMs?: number | undefined }
  if (args.sandbox.status !== 'running')
    return usage.totalActiveCpuDurationMs === undefined || usage.totalActiveCpuDurationMs === 0
      ? undefined
      : usage.totalActiveCpuDurationMs
  const usec = await daemonCpuUsecOf({
    sandbox: args.sandbox,
    token: daemonToken({
      secret: args.daemonSecret,
      sandboxName: sandboxNameOf(args.sandboxSessionId),
    }),
  })
  return usec === undefined ? undefined : vercelBilledCpuMsOfUsec(usec)
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
    const credentials = vercelCredentialsOf(args.target.credentials)
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
      ...(vcpus === undefined ? {} : { memoryGb: vcpus * SANDBOX_MEMORY_GB_PER_VCPU }),
    }
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    const credentials = vercelCredentialsOf(args.target.credentials)
    const sandbox = await this.sdk.get({
      ...credentials,
      name: sandboxNameOf(args.target.sandboxSessionId),
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    await sandbox.stop({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
  }

  override async activeCpuMs(args: { target: SandboxTarget }): Promise<number | undefined> {
    const credentials = vercelCredentialsOf(args.target.credentials)
    const sandbox = await this.sdk.get({
      ...credentials,
      name: sandboxNameOf(args.target.sandboxSessionId),
      resume: false,
      signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
    })
    return await vercelCpuMsOf({
      sandbox,
      daemonSecret: this.args.daemonSecret,
      sandboxSessionId: args.target.sandboxSessionId,
    })
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    const credentials = vercelCredentialsOf(args.target.credentials)
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

  async resize(args: { target: SandboxTarget; shape: PodShape }): Promise<PodResizeOutcome> {
    const credentials = vercelCredentialsOf(args.target.credentials)
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
    await sandbox.update({ resources: { vcpus: args.shape.vcpus } }, { signal })
    if (sandbox.status === 'stopped') return 'stored'
    await sandbox.stop({ signal })
    return 'restarted'
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    const credentials = vercelCredentialsOf(args.target.credentials)
    const signal = AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS)
    try {
      const sandbox = await this.sdk.get({
        ...credentials,
        name: sandboxNameOf(args.target.sandboxSessionId),
        resume: false,
        signal,
      })
      // A running sandbox has someone behind it: the sweep stops it on one pass and deletes it on a
      // later one, so delete never races a live pod into deletion.
      if (sandbox.status === 'running') return
      await sandbox.delete({ signal })
    } catch (failure) {
      if (isSandboxMissing(failure)) return
      throw failure
    }
  }

  async list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    const credentials = vercelCredentialsOf(args.credentials)
    // Vercel's list endpoints reject a limit above 50; `toArray` walks every page.
    const pages = await this.sdk.list({ ...credentials, limit: LIST_PAGE_LIMIT })
    const sandboxes = await pages.toArray()
    return sandboxes.flatMap((sandbox) => {
      const sandboxSessionId = podSessionIdOfSandboxName(sandbox.name)
      if (sandboxSessionId === null) return []
      return [
        { sandboxSessionId, running: sandbox.status === 'running', createdAt: sandbox.createdAt },
      ]
    })
  }
}
