import { z } from 'zod'

import {
  EStopAction,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import { EKilledBy } from '../../shells/background-shell'
import { ServiceRegistryPort } from '../../services'

const inputSchema = z.strictObject({
  id: z.string().min(1),
})

const description = [
  'Stop a service that is still running.',
  'Takes the id that service_start returned.',
  'The whole process group is signalled, so anything the service forked goes with it.',
  'SIGTERM first; a service that keeps ignoring it is escalated to SIGKILL automatically after a grace period.',
  'You will be told when it has actually exited, the same as any other ending.',
].join(' ')

export class ServiceStopTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'service_stop'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly services: ServiceRegistryPort) {
    super()
  }

  protected override async run({
    input,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const stopped = this.services.stop({ serviceId: input.id, by: EKilledBy.Model })
    if (!stopped.ok) return stopped

    const { snapshot, action } = stopped

    return {
      ok: true,
      output: {
        serviceId: snapshot.serviceId,
        command: snapshot.command,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
      },
      modelText:
        action === EStopAction.Gone
          ? `Service ${snapshot.serviceId} had already exited, so nothing was signalled.`
          : action === EStopAction.Kill
            ? `Service ${snapshot.serviceId} was already asked to stop; SIGKILL follows automatically after the grace period if it keeps ignoring SIGTERM.`
            : `Sent SIGTERM to service ${snapshot.serviceId} and its process group, escalating to SIGKILL automatically after a grace period. You will be told when it has exited.`,
    }
  }
}
