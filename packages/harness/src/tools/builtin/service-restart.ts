import { z } from 'zod'

import {
  EServiceStatus,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { resolveServiceRef } from '../../services/service-ref'
import type { ServiceRegistryPort } from '../../services/service-registry-port'

const inputSchema = z.strictObject({ id: z.string().min(1) })

const description = [
  'Restart a service: stop it if it is running, then start it again with the same command, name, port and environment; a declared service restarts from the current .atlas/services.yaml instead, so edits to it take effect.',
  'Takes a service id or the name it was declared under; a service that gave up after crash-looping is restarted fresh.',
].join(' ')

export class ServiceRestartTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_restart'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly services: ServiceRegistryPort) {
    super()
  }

  protected override async run({ input }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (this.services.restart === undefined) {
      return { ok: false, reason: 'this session cannot restart services' }
    }
    const found = resolveServiceRef({ services: this.services.list(), ref: input.id })
    if (found === undefined) {
      return { ok: false, reason: `no service is registered as "${input.id}"` }
    }

    const restarted = await this.services.restart({ serviceId: found.serviceId })
    if (!restarted.ok) return restarted

    const { snapshot } = restarted
    if (snapshot.status !== EServiceStatus.Running) {
      return {
        ok: false,
        reason: `${snapshot.serviceId} exited right after the restart; read ${snapshot.logPath}`,
      }
    }

    return {
      ok: true,
      output: { serviceId: snapshot.serviceId, name: snapshot.name, status: snapshot.status },
      modelText: `Restarted ${snapshot.name ?? found.serviceId} as ${snapshot.serviceId}; log: ${snapshot.logPath}`,
    }
  }
}
