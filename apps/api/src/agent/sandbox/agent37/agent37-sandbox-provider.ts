import { ESandboxProvider } from '@dltech/atlas-protocol'
import { daemonToken } from '@dltech/atlas-protocol/engine'
import { SandboxUnavailableError } from '@dltech/atlas-host'

import { abortedWake, WAKE_DEADLINE_MS } from '../wake-deadline'
import { SandboxProvider, type DaemonEndpoint, type SandboxTarget } from '../sandbox-provider'

import { agent37CreateBodyOf } from './agent37-create'
import { launchAgent37Daemon, type Agent37DaemonBundle } from './agent37-daemon'
import { agent37EndpointOf } from './agent37-endpoint'
import {
  agent37InstanceNameOf,
  type Agent37Env,
  type Agent37InstanceIds,
} from './agent37-instances'
import { liveAgent37Client, type Agent37Client } from './agent37-client'

const apiKeyOf = (target: SandboxTarget): string => {
  const credentials = target.credentials
  if (credentials.provider !== ESandboxProvider.Agent37) {
    throw new Error(`Agent37SandboxProvider cannot run a ${credentials.provider} sandbox`)
  }
  return credentials.apiKey
}

type Resolved = { instanceId: string; sandboxName: string }

const unavailable = (args: { sessionId: string; error: unknown }): SandboxUnavailableError =>
  new SandboxUnavailableError(
    `sandbox for ${args.sessionId} is unavailable: ${
      args.error instanceof Error ? args.error.message : String(args.error)
    }`,
  )

export class Agent37SandboxProvider extends SandboxProvider {
  constructor(
    private readonly args: {
      env: Agent37Env
      daemonBundle: Agent37DaemonBundle
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

  private async resolve(args: { target: SandboxTarget; signal: AbortSignal }): Promise<Resolved> {
    const podSessionId = args.target.sandboxSessionId
    const sandboxName = agent37InstanceNameOf(podSessionId)
    const known = await this.args.instances.find({ podSessionId })
    if (known !== null) return { instanceId: known, sandboxName }
    const client = this.clientOf(apiKeyOf(args.target))
    const instance = await client.create(
      agent37CreateBodyOf({
        env: this.args.env,
        podSessionId,
        sandboxName,
        token: this.tokenOf(sandboxName),
      }),
    )
    await this.args.instances.remember({ podSessionId, instanceId: instance.id })
    args.signal.throwIfAborted()
    this.args.log?.(`agent37 created instance ${instance.id} for ${podSessionId}`)
    return { instanceId: instance.id, sandboxName }
  }

  private async ensureDaemon(args: {
    target: SandboxTarget
    instanceId: string
    sandboxName: string
  }): Promise<void> {
    const client = this.clientOf(apiKeyOf(args.target))
    await launchAgent37Daemon({
      client,
      instanceId: args.instanceId,
      bundle: this.args.daemonBundle,
      token: this.tokenOf(args.sandboxName),
      sandboxName: args.sandboxName,
      ...(this.args.log === undefined ? {} : { log: this.args.log }),
    })
  }

  async wake(args: { target: SandboxTarget; signal: AbortSignal }): Promise<DaemonEndpoint> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.args.wakeDeadlineMs ?? WAKE_DEADLINE_MS),
      args.signal,
    ])
    const waking = this.wakeWithin({ target: args.target, signal })
    waking.catch(() => undefined)
    return Promise.race([waking, abortedWake({ signal, caller: args.signal })])
  }

  private async wakeWithin(args: {
    target: SandboxTarget
    signal: AbortSignal
  }): Promise<DaemonEndpoint> {
    const sessionId = args.target.sandboxSessionId
    try {
      const resolved = await this.resolve(args)
      await this.ensureDaemon({ target: args.target, ...resolved })
      return await agent37EndpointOf({
        client: this.clientOf(apiKeyOf(args.target)),
        instanceId: resolved.instanceId,
        token: this.tokenOf(resolved.sandboxName),
        sandboxName: resolved.sandboxName,
      })
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error
      throw unavailable({ sessionId, error })
    }
  }

  async stop(args: { target: SandboxTarget }): Promise<void> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    if (instanceId === null) return
    await this.clientOf(apiKeyOf(args.target)).sleep({ id: instanceId })
  }

  async keepAlive(args: { target: SandboxTarget; until: number }): Promise<void> {
    const instanceId = await this.args.instances.find({
      podSessionId: args.target.sandboxSessionId,
    })
    if (instanceId === null) return
    await this.clientOf(apiKeyOf(args.target)).exec({ id: instanceId, command: 'true' })
  }
}
