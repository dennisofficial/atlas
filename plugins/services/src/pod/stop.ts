import { EServiceStatus, type ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { servicesOfEvents } from '../core'
import { stopService } from './daemon'
import { stopPreview } from './expose'
import { renderStopped } from './render'
import type { ServiceInput } from './schema'
import type { ServicePodState } from './state'

export const stopServiceAction = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  input: ServiceInput
  signal?: AbortSignal | undefined
}): Promise<ToolOutcome> => {
  const { ctx, state, input } = args
  const named =
    input.name === undefined
      ? undefined
      : servicesOfEvents(ctx.events()).find(
          (row) => row.name === input.name && row.status === EServiceStatus.Running,
        )
  const serviceId = input.serviceId ?? named?.serviceId
  if (serviceId === undefined) {
    return {
      ok: false,
      reason:
        input.name === undefined
          ? 'action "stop" takes a serviceId or a declared name'
          : `no running service is declared as "${input.name}" in .atlas/services.yaml; list shows what is running`,
    }
  }
  state.stopping.add(serviceId)
  const stopped = await stopService({ ctx, serviceId, signal: args.signal })
  if (!stopped.ok) {
    state.stopping.delete(serviceId)
    return { ok: false, reason: stopped.reason }
  }
  const row = servicesOfEvents(ctx.events()).find((kept) => kept.serviceId === serviceId)
  await stopPreview({ ctx, port: row?.port })
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
