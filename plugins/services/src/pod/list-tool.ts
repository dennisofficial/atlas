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
import { listServices } from './daemon'
import { renderListLine } from './render'
import { outcomeOf } from './status'

const inputSchema = z.strictObject({ runningOnly: z.boolean().optional() })

const description = [
  'List the services this session has started, running and ended alike.',
  'Set runningOnly to leave out the ones that have already ended.',
  'Each entry names its id, its description and command, whether it is still running, and its port.',
  'Do not poll this to watch a service: if one dies you will be told.',
].join(' ')

export class ServiceListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
    signal,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const listed = await listServices({ ctx: this.ctx, signal })
    if (!listed.ok) return { ok: false, reason: listed.reason }
    const roster = servicesOfEvents(this.ctx.events())
    const rows = listed.value
      .map((info) => ({
        serviceId: info.serviceId,
        command: info.command,
        description: roster.find((row) => row.serviceId === info.serviceId)?.name,
        status: info.status,
        exitCode: info.exitCode,
        port: info.port,
        startedAt: info.startedAt,
        running: outcomeOf({ info, stoppedByModel: false }).status === EServiceStatus.Running,
      }))
      .filter((row) => input.runningOnly !== true || row.running)
    if (rows.length === 0) {
      return {
        ok: true,
        output: { services: [] },
        modelText:
          input.runningOnly === true
            ? 'No service is running.'
            : 'No service has been started. service_start is what puts one here.',
      }
    }
    return {
      ok: true,
      output: { services: rows },
      modelText: rows.map(renderListLine).join('\n'),
    }
  }
}
