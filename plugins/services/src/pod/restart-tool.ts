import {
  EServiceStatus,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { servicesOfEvents } from '../core'
import { declaredNames } from '../core/declared'
import { stopService } from './daemon'
import { readDeclared } from './declared-file'
import { ensureDeclared } from './declared-ensure'
import { launchService } from './launch'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({
  serviceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
})

const description = [
  'Restart a service: stop it if it is running, then start it again.',
  'Takes the id that service_start returned, or the name a project declares in .atlas/services.yaml; the restarted service gets a new id.',
  'Restarting by name re-reads the declaration, so a changed command, env, port and health path apply, and its setup runs again when the declaration changed.',
  'Use it after you change what the service runs.',
].join(' ')

export class ServiceRestartTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_restart'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: ServicePodState,
  ) {
    super()
  }

  protected override async run({
    input,
    signal,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const { name, serviceId } = input
    if ((name === undefined) === (serviceId === undefined)) {
      return {
        ok: false,
        reason:
          'service_restart takes a serviceId or a declared name, exactly one: the id service_start returned, or a name from .atlas/services.yaml',
      }
    }
    if (name !== undefined) {
      return this.restartDeclared({ name, projectDirectory, signal })
    }
    const row = servicesOfEvents(this.ctx.events()).find((kept) => kept.serviceId === serviceId)
    if (row === undefined || row.command === '' || serviceId === undefined) {
      return { ok: false, reason: `no service is registered as "${serviceId ?? ''}"` }
    }
    if (row.status === EServiceStatus.Running) {
      this.state.stopping.add(serviceId)
      this.state.restarting.add(serviceId)
      const stopped = await stopService({ ctx: this.ctx, serviceId, signal })
      if (!stopped.ok) {
        this.state.stopping.delete(serviceId)
        this.state.restarting.delete(serviceId)
        return { ok: false, reason: stopped.reason }
      }
    }
    return launchService({
      ctx: this.ctx,
      state: this.state,
      command: row.command,
      description: row.name ?? row.command,
      cwd: this.state.cwds.get(serviceId) ?? projectDirectory,
      port: row.port,
      name: row.name,
      declarationHash: row.declarationHash,
      signal,
    })
  }

  private async restartDeclared(args: {
    name: string
    projectDirectory: string
    signal?: AbortSignal | undefined
  }): Promise<ToolOutcome> {
    const declared = await readDeclared({
      ctx: this.ctx,
      projectDirectory: args.projectDirectory,
      signal: args.signal,
    })
    if (!declared.ok) return declared
    const hash = declared.value.hashes.get(args.name)
    if (hash === undefined) {
      return {
        ok: false,
        reason: `"${args.name}" is not declared in .atlas/services.yaml; declared services: ${declaredNames(declared.value.services)}`,
      }
    }
    const running = servicesOfEvents(this.ctx.events()).find(
      (row) => row.name === args.name && row.status === EServiceStatus.Running,
    )
    if (running !== undefined && running.declarationHash !== hash) {
      this.state.setupDone.delete(args.name)
    }
    if (running !== undefined) {
      this.state.stopping.add(running.serviceId)
      this.state.restarting.add(running.serviceId)
      const stopped = await stopService({
        ctx: this.ctx,
        serviceId: running.serviceId,
        signal: args.signal,
      })
      if (!stopped.ok) {
        this.state.stopping.delete(running.serviceId)
        this.state.restarting.delete(running.serviceId)
        return { ok: false, reason: stopped.reason }
      }
    }
    return ensureDeclared({
      ctx: this.ctx,
      state: this.state,
      declared: declared.value,
      name: args.name,
      projectDirectory: args.projectDirectory,
      restart: true,
      signal: args.signal,
    })
  }
}
