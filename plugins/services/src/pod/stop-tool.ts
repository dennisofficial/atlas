import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { stopService } from './daemon'
import { renderStopped } from './render'
import type { ServicePodState } from './state'

const inputSchema = z.strictObject({ serviceId: z.string().min(1) })

const description = [
  'Stop a service that is still running.',
  'Takes the id that service_start returned.',
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
    const { serviceId } = input
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
