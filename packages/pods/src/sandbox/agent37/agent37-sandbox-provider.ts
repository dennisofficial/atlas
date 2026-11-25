import { EPodResizeProbe, type PodShape } from '@dltech/atlas-core'
import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import { SandboxUnavailableError } from '@dltech/atlas-host'

import { abortedWake, WAKE_DEADLINE_MS } from '../wake-deadline'
import {
  SandboxProvider,
  type DaemonEndpoint,
  type PodResizeOutcome,
  type SandboxCredentials,
  type SandboxListing,
  type SandboxTarget,
} from '../sandbox-provider'

import { agent37CreateBodyOf } from './agent37-create'
import {
  agent37BundleVersionOf,
  pinnedDaemonBundleUrlOf,
  waitForAgent37Daemon,
  waitForAgent37Instance,
  type Agent37DaemonBundle,
} from './agent37-daemon'
import { agent37EndpointOf } from './agent37-endpoint'
import { listAgent37Instances, removeAgent37Pod, sleepAgent37Pod } from './agent37-instance-sweep'
import { readyAgent37Instance, repairAgent37IfWedged } from './agent37-lifecycle'
import { resizeAgent37Instance } from './agent37-resize'
import { agent37ResizeProbe } from './agent37-resize-state'
import {
  agent37InstanceNameOf,
  type Agent37Env,
  type Agent37InstanceIds,
} from './agent37-instances'
import { Agent37Error, liveAgent37Client, type Agent37Client } from './agent37-client'

const apiKeyOf = (given: SandboxCredentials): string => {
  if (given.provider !== ESandboxProvider.Agent37) {
    throw new Error(`Agent37SandboxProvider cannot run a ${given.provider} sandbox`)
  }
  return given.apiKey
}

type Resolved = { instanceId: string; sandboxName: string; created: boolean }

const unavailable = (args: { sessionId: string; error: unknown }): SandboxUnavailableError =>
  new SandboxUnavailableError(
    `sandbox for ${args.sessionId} is unavailable: ${
      args.error instanceof Error ? args.error.message : String(args.error)
    }`,
  )

// https://www.agent37.com/docs/agents-api/errors — the account is out of instances or the region is
// out of room; neither is the session's fault, so the reader gets the next step instead of a status.
const CAPACITY_MESSAGES: Record<string, string> = {
  instance_limit_reached:
    'Agent37 is at its instance limit. Archive a few sessions or raise your Agent37 tier, then retry',
  capacity_unavailable: 'Agent37 has no capacity for this sandbox right now. Retry in a minute',
  no_capacity: 'Agent37 has no capacity for this sandbox right now. Retry in a minute',
}

const capacityMessageOf = (error: unknown): string | undefined =>
  error instanceof Agent37Error ? CAPACITY_MESSAGES[error.code] : undefined

export class Agent37SandboxProvider extends SandboxProvider {
  constructor(
    private readonly args: {
      env: Agent37Env
      daemonBundle: Agent37DaemonBundle
      daemonBundleUrl: string
      daemonSecret: string
      instances: Agent37InstanceIds
      client?: Agent37Client | undefined
      wakeDeadlineMs?: number | undefined
      log?: ((line: string) => void) | undefined
    },
  ) {
    super()
  }

  private clientOf(apiKey: string): Agent37Client {
    return this.args.client ?? liveAgent37Client({ apiKey })
  }

  private tokenOf(sandboxName: string): string {
    return daemonToken({ secret: this.args.daemonSecret, sandboxName })
  }

  private async resolve(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
    memoryGb?: number | undefined
    diskGb?: number | undefined
  }): Promise<Resolved> {
    const podSessionId = args.target.sandboxSessionId
    const sandboxName = agent37InstanceNameOf(podSessionId)
    const known = await this.args.instances.find({ podSessionId })
    if (known !== null) return { instanceId: known, sandboxName, created: false }
    const client = this.clientOf(apiKeyOf(args.target.credentials))
    const instance = await client.create(
      agent37CreateBodyOf({
        env: this.args.env,
        podSessionId,
        sandboxName,
        token: this.tokenOf(sandboxName),
        bundleUrl: this.args.daemonBundleUrl,
        ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
        ...(args.memoryGb === undefined ? {} : { memoryGb: args.memoryGb }),
        ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
      }),
    )
    this.args.log?.(`agent37 created instance ${instance.id} for ${podSessionId}`)
    await this.args.instances.remember({ podSessionId, instanceId: instance.id })
    await waitForAgent37Instance({
      client,
      instanceId: instance.id,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
    args.signal.throwIfAborted()
    const readAt = new Date().toISOString()
    const declared = await client.get({ id: instance.id })
    await this.args.instances.seedStatus({
      podSessionId,
      status: declared.status,
      at: readAt,
    })
    return { instanceId: instance.id, sandboxName, created: true }
  }

  private async ensureDaemon(args: { target: SandboxTarget; instanceId: string }): Promise<void> {
    const client = this.clientOf(apiKeyOf(args.target.credentials))
    const sandboxName = agent37InstanceNameOf(args.target.sandboxSessionId)
    const version = await agent37BundleVersionOf(this.args.daemonBundle.path)
    await waitForAgent37Daemon({
      client,
      instanceId: args.instanceId,
      want: {
        version,
        url: pinnedDaemonBundleUrlOf({ url: this.args.daemonBundleUrl, version }),
      },
      token: this.tokenOf(sandboxName),
      repair: async () =>
        repairAgent37IfWedged({
          client,
          id: args.instanceId,
          ...(this.args.log === undefined ? {} : { log: this.args.log }),
        }),
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }

  async wake(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
    memoryGb?: number | undefined
    diskGb?: number | undefined
  }): Promise<DaemonEndpoint> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.args.wakeDeadlineMs ?? WAKE_DEADLINE_MS),
      args.signal,
    ])
    const waking = this.wakeWithin({
      target: args.target,
      signal,
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
      ...(args.memoryGb === undefined ? {} : { memoryGb: args.memoryGb }),
      ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
    })
    waking.catch(() => undefined)
    return Promise.race([waking, abortedWake({ signal, caller: args.signal })])
  }

  private async wakeWithin(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
    memoryGb?: number | undefined
    diskGb?: number | undefined
  }): Promise<DaemonEndpoint> {
    const sessionId = args.target.sandboxSessionId
    try {
      const resolved = await this.resolve(args)
      const client = this.clientOf(apiKeyOf(args.target.credentials))
      await readyAgent37Instance({ client, id: resolved.instanceId, log: this.args.log })
      await this.ensureDaemon({ target: args.target, instanceId: resolved.instanceId })
      // The endpoint carries the instance's real shape so the runtime can record it as applied.
      const readAt = new Date().toISOString()
      const instance = await client.get({ id: resolved.instanceId })
      if (!resolved.created) {
        await this.args.instances.seedStatus({
          podSessionId: sessionId,
          status: instance.status,
          at: readAt,
        })
      }
      return await agent37EndpointOf({
        client,
        instanceId: resolved.instanceId,
        token: this.tokenOf(resolved.sandboxName),
        sandboxName: resolved.sandboxName,
        ...(instance.resources?.cpu === undefined ? {} : { vcpus: instance.resources.cpu }),
        ...(instance.resources?.memory === undefined
          ? {}
          : { memoryGb: instance.resources.memory }),
        ...(instance.resources?.disk === undefined ? {} : { diskGb: instance.resources.disk }),
      })
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error
      const capacity = capacityMessageOf(error)
      if (capacity !== undefined) throw new SandboxUnavailableError(capacity)
      throw unavailable({ sessionId, error })
    }
  }

  override async instanceIdOf(args: { target: SandboxTarget }): Promise<string | undefined> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    return instanceId ?? undefined
  }

  override podDiskGb(): number {
    return this.args.env.resources.disk
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    await sleepAgent37Pod({
      client: this.clientOf(apiKeyOf(args.target.credentials)),
      instances: this.args.instances,
      podSessionId: args.target.sandboxSessionId,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }

  async resize(args: {
    target: SandboxTarget
    shape: PodShape
    diskGb?: number | undefined
  }): Promise<PodResizeOutcome> {
    const podSessionId = args.target.sandboxSessionId
    const instanceId = await this.args.instances.find({ podSessionId })
    if (instanceId === null) return 'absent'
    return resizeAgent37Instance({
      client: this.clientOf(apiKeyOf(args.target.credentials)),
      instanceId,
      shape: args.shape,
      diskGb: args.diskGb,
      log: this.args.log,
    })
  }

  override resizeState(args: { target: SandboxTarget; shape: PodShape }): Promise<EPodResizeProbe> {
    return agent37ResizeProbe({
      client: () => this.clientOf(apiKeyOf(args.target.credentials)),
      instances: this.args.instances,
      podSessionId: args.target.sandboxSessionId,
      shape: args.shape,
    })
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    if (instanceId === null) return
    await this.clientOf(apiKeyOf(args.target.credentials)).exec({ id: instanceId, command: 'true' })
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    await removeAgent37Pod({
      client: this.clientOf(apiKeyOf(args.target.credentials)),
      instances: this.args.instances,
      podSessionId: args.target.sandboxSessionId,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }

  async list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    return listAgent37Instances({
      client: this.clientOf(apiKeyOf(args.credentials)),
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }
}
