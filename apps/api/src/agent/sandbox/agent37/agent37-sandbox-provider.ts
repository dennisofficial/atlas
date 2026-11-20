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
  waitForAgent37Daemon,
  waitForAgent37Instance,
  type Agent37DaemonBundle,
} from './agent37-daemon'
import { agent37EndpointOf } from './agent37-endpoint'
import {
  AGENT37_POD_SESSION_KEY,
  agent37InstanceNameOf,
  type Agent37Env,
  type Agent37InstanceIds,
} from './agent37-instances'
import {
  Agent37Error,
  isAgent37Missing,
  liveAgent37Client,
  type Agent37Client,
} from './agent37-client'
import { agent37ShapeOfVcpus } from './agent37-resize'

const apiKeyOf = (given: SandboxCredentials): string => {
  if (given.provider !== ESandboxProvider.Agent37) {
    throw new Error(`Agent37SandboxProvider cannot run a ${given.provider} sandbox`)
  }
  return given.apiKey
}

type Resolved = { instanceId: string; sandboxName: string }

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
  }): Promise<Resolved> {
    const podSessionId = args.target.sandboxSessionId
    const sandboxName = agent37InstanceNameOf(podSessionId)
    const known = await this.args.instances.find({ podSessionId })
    if (known !== null) return { instanceId: known, sandboxName }
    const client = this.clientOf(apiKeyOf(args.target.credentials))
    const instance = await client.create(
      agent37CreateBodyOf({
        env: this.args.env,
        podSessionId,
        sandboxName,
        token: this.tokenOf(sandboxName),
        bundleUrl: this.args.daemonBundleUrl,
        ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
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
    return { instanceId: instance.id, sandboxName }
  }

  private async ensureDaemon(args: { target: SandboxTarget; instanceId: string }): Promise<void> {
    const client = this.clientOf(apiKeyOf(args.target.credentials))
    const sandboxName = agent37InstanceNameOf(args.target.sandboxSessionId)
    await waitForAgent37Daemon({
      client,
      instanceId: args.instanceId,
      version: await agent37BundleVersionOf(this.args.daemonBundle.path),
      token: this.tokenOf(sandboxName),
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }

  async wake(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.args.wakeDeadlineMs ?? WAKE_DEADLINE_MS),
      args.signal,
    ])
    const waking = this.wakeWithin({
      target: args.target,
      signal,
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
    })
    waking.catch(() => undefined)
    return Promise.race([waking, abortedWake({ signal, caller: args.signal })])
  }

  private async wakeWithin(args: {
    target: SandboxTarget
    signal: AbortSignal
    vcpus?: number | undefined
  }): Promise<DaemonEndpoint> {
    const sessionId = args.target.sandboxSessionId
    try {
      const resolved = await this.resolve(args)
      await this.ensureDaemon({ target: args.target, instanceId: resolved.instanceId })
      const client = this.clientOf(apiKeyOf(args.target.credentials))
      // The endpoint carries the instance's real cpu so the runtime can record the size as applied.
      const instance = await client.get({ id: resolved.instanceId })
      return await agent37EndpointOf({
        client,
        instanceId: resolved.instanceId,
        token: this.tokenOf(resolved.sandboxName),
        sandboxName: resolved.sandboxName,
        ...(instance.resources?.cpu === undefined ? {} : { vcpus: instance.resources.cpu }),
      })
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error
      const capacity = capacityMessageOf(error)
      if (capacity !== undefined) throw new SandboxUnavailableError(capacity)
      throw unavailable({ sessionId, error })
    }
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    if (instanceId === null) return
    await this.clientOf(apiKeyOf(args.target.credentials)).sleep({ id: instanceId })
  }

  async resize(args: { target: SandboxTarget; vcpus: number }): Promise<PodResizeOutcome> {
    const podSessionId = args.target.sandboxSessionId
    const instanceId = await this.args.instances.find({ podSessionId })
    if (instanceId === null) return 'absent'
    const shape = agent37ShapeOfVcpus(args.vcpus)
    // A resize recreates the container in place (https://www.agent37.com/docs/agents-api/instances/resize),
    // so a sleeping instance comes back running at the new shape instead of storing it for its next wake.
    await this.clientOf(apiKeyOf(args.target.credentials)).resize({
      id: instanceId,
      cpu: shape.cpu,
      memory: shape.memory,
    })
    return 'restarted'
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    if (instanceId === null) return
    await this.clientOf(apiKeyOf(args.target.credentials)).exec({ id: instanceId, command: 'true' })
  }

  /**
   * Every instance this account holds for the pod, not just the remembered one: a create that died
   * before it was remembered, or a session row that was soft-deleted, leaves an orphan the mapping
   * no longer knows about. The pod key in the instance metadata is what survives both.
   */
  private async instanceIdsOf(args: {
    client: Agent37Client
    podSessionId: string
  }): Promise<Set<string>> {
    const ids = new Set<string>()
    const known = await this.args.instances.find({ podSessionId: args.podSessionId })
    if (known !== null) ids.add(known)
    let cursor: string | undefined
    for (;;) {
      const page = await args.client.list(cursor === undefined ? {} : { cursor })
      for (const instance of page.data) {
        if (instance.metadata?.[AGENT37_POD_SESSION_KEY] === args.podSessionId) ids.add(instance.id)
      }
      if (page.next === undefined) return ids
      cursor = page.next
    }
  }

  async delete(args: { target: SandboxTarget }): Promise<void> {
    const podSessionId = args.target.sandboxSessionId
    const client = this.clientOf(apiKeyOf(args.target.credentials))
    let leftRunning = false
    for (const instanceId of await this.instanceIdsOf({ client, podSessionId })) {
      try {
        // A running instance has someone behind it; the sweep stops it on one pass and deletes it
        // on a later one, so a pod that came alive is never deleted under its user.
        if ((await client.get({ id: instanceId })).status === 'running') {
          leftRunning = true
          continue
        }
        await client.remove({ id: instanceId })
      } catch (failure) {
        if (!isAgent37Missing(failure)) throw failure
      }
    }
    // The mapping still has to find a pod that was left running, so it is only forgotten once the
    // pod has nothing live left.
    if (!leftRunning) await this.args.instances.forget({ podSessionId })
  }

  async list(args: { credentials: SandboxCredentials }): Promise<readonly SandboxListing[]> {
    const client = this.clientOf(apiKeyOf(args.credentials))
    const listings: SandboxListing[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await client.list(cursor === undefined ? {} : { cursor })
      for (const instance of page.data) {
        const sandboxSessionId = instance.metadata?.[AGENT37_POD_SESSION_KEY]
        if (sandboxSessionId === undefined) continue
        listings.push({
          sandboxSessionId,
          running: instance.status === 'running',
          createdAt: (instance.created ?? 0) * 1000,
        })
      }
      if (page.next === undefined) return listings
      cursor = page.next
    }
  }
}
