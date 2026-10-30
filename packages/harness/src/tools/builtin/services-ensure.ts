import { z } from 'zod'

import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { ServiceRegistryPort } from '../../services/service-registry-port'
import { ensuredLine } from './ensured-lines'

const inputSchema = z.strictObject({
  names: z.array(z.string().min(1)).min(1).optional(),
})

const description = [
  'Start the services this repository declares in .atlas/services.yaml and wait until they answer.',
  'Names are optional: omit them to ensure every declared service, in declared order.',
  'Idempotent: a service that is already running is never started twice, so call it freely before you need a URL; one whose declaration changed since it started is restarted from the current declaration (status restarted).',
  'Each service comes back as { name, status, url?, ready, reason? }; a service that never became ready still returns its url, flagged ready:false with the reason.',
  'Declared services get PORT, ATLAS_THREAD_ID and, with a portal, PUBLIC_URL; they are restarted when they crash, with backoff, and come back after the sandbox resumes.',
  'Use it for all declared services or several at once; a single declared service starts with service_start({ name }). Stop one with service_stop({ id: "<name>" }) and restart it with service_restart({ id: "<name>" }); one-off processes without a declaration belong on service_start with a command.',
].join(' ')

export class ServicesEnsureTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'services_ensure'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly services: ServiceRegistryPort) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (this.services.ensureDeclared === undefined) {
      return { ok: false, reason: 'this session cannot manage declared services' }
    }

    const services = await this.services.ensureDeclared({ threadId, names: input.names })
    if (services.length === 0) {
      return {
        ok: true,
        output: { services: [] },
        modelText: 'No services are declared. Add them under services: in .atlas/services.yaml.',
      }
    }

    const unhealthy = services.filter((one) => !one.ready).length
    return {
      ok: true,
      output: { services },
      modelText: [
        ...services.map(ensuredLine),
        unhealthy === 0
          ? 'Every service is ready.'
          : `${unhealthy} not ready; read its log (service_list shows the path) before handing out its url.`,
      ].join('\n'),
    }
  }
}
