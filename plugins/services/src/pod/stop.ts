import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { runningDeclaredOf, servicesOfEvents } from '../core'
import { stopService } from './daemon'
import { EServiceFailure, failureOutcome, serviceFailed } from './failure'
import type { DeclaredPlace } from './place'
import { renderStopped } from './render'
import type { ServiceInput } from './schema'
import type { ServicePodState } from './state'

const namedRunning = (args: { ctx: PluginPodContext; name: string; root: string }) => {
  const rows = servicesOfEvents(args.ctx.events())
  return (
    runningDeclaredOf({ rows, name: args.name, root: args.root }) ??
    rows.find((row) => row.name === args.name && row.status === EServiceStatus.Running)
  )
}

export const stopServiceAction = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  place: DeclaredPlace
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  const named =
    input.name === undefined
      ? undefined
      : namedRunning({ ctx, name: input.name, root: args.place.root })
  const serviceId = input.serviceId ?? named?.serviceId
  if (serviceId === undefined) {
    return failureOutcome(
      serviceFailed({
        reason:
          input.name === undefined
            ? 'action "stop" takes a serviceId or a declared name'
            : `no running service is declared as "${input.name}" in .atlas/services.yaml; list shows what is running`,
        failure: EServiceFailure.InvalidArgs,
      }),
    )
  }
  state.stopping.add(serviceId)
  const stopped = await stopService({ ctx, serviceId, signal: args.signal })
  if (!stopped.ok) {
    state.stopping.delete(serviceId)
    return failureOutcome(
      serviceFailed({ reason: stopped.reason, failure: EServiceFailure.StopFailed }),
    )
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
