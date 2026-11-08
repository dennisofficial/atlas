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
import { stopService } from './daemon'
import { launchService } from './launch'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({ serviceId: z.string().min(1) })

const description = [
  'Restart a service: stop it if it is running, then start it again with the same command, port and working directory.',
  'Takes the id that service_start returned, and the restarted service gets a new id.',
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
    const { serviceId } = input
    const row = servicesOfEvents(this.ctx.events()).find((kept) => kept.serviceId === serviceId)
    if (row === undefined || row.command === '') {
      return {
        ok: false,
        reason: `no service is registered as "${serviceId}"`,
      }
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
      signal,
    })
  }
}
