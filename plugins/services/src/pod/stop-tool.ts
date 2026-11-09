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
import { renderStopped } from './render'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({
  serviceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
})

const description = [
  'Stop a service that is still running.',
  'Takes the id that service_start returned, or the name a project declares in .atlas/services.yaml.',
  'The whole process group is signalled, so anything the service forked goes with it.',
  'The ending is recorded and delivered on its own, the same as any other ending, so do not wait for it.',
].join(' ')

export class ServiceStopTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_stop'
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
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const named =
      input.name === undefined
        ? undefined
        : servicesOfEvents(this.ctx.events()).find(
            (row) => row.name === input.name && row.status === EServiceStatus.Running,
          )
    const serviceId = input.serviceId ?? named?.serviceId
    if (serviceId === undefined) {
      return {
        ok: false,
        reason:
          input.name === undefined
            ? 'service_stop takes a serviceId or a declared name, exactly one'
            : `no running service is declared as "${input.name}" in .atlas/services.yaml; service_list shows what is running`,
      }
    }
    this.state.stopping.add(serviceId)
    const stopped = await stopService({ ctx: this.ctx, serviceId, signal })
    if (!stopped.ok) {
      this.state.stopping.delete(serviceId)
      return { ok: false, reason: stopped.reason }
    }
    return {
      ok: true,
      output: {
        serviceId,
        command: stopped.value.command,
        status: stopped.value.status,
        exitCode: stopped.value.exitCode,
      },
      modelText: renderStopped({ serviceId }),
    }
  }
}
