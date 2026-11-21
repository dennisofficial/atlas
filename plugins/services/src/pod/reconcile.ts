import {
  EKilledBy,
  EShellEndCause,
  EServiceStatus,
  type Event,
  lostServicesOf,
  type ServiceLifecycle,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { listServices } from './daemon'
import { recordServiceFrame } from './frames'
import type { ServicePodState } from './state'
import { hasEnded, outcomeOf, startedOf } from './status'

const recordQuietEnding = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  service: ServiceLifecycle
}): Promise<void> => {
  const { ctx, state } = args
  const started = args.service.started
  const { serviceId } = started
  if (state.endings.has(serviceId)) return
  state.endings.add(serviceId)
  try {
    if (hasEnded({ events: ctx.events(), serviceId })) return
    const journal = startedOf({ events: ctx.events(), serviceId })
    await ctx.notify(
      {
        type: 'service-ended',
        serviceId,
        command: journal?.command ?? started.command,
        ...(journal?.description === undefined ? {} : { description: journal.description }),
        ...(started.bootId === undefined ? {} : { bootId: started.bootId }),
        status: EServiceStatus.Killed,
        killedBy: EKilledBy.Unrecorded,
        cause: EShellEndCause.SandboxStopped,
        tail: '',
      },
      { key: `service-ended:${serviceId}` },
    )
  } catch (error) {
    state.endings.delete(serviceId)
    ctx.log(`services: recording the lost ending of ${serviceId} failed: ${String(error)}`)
  }
}

export const reconcileServices = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
}): Promise<void> => {
  const { ctx, state } = args
  const open = lostServicesOf(ctx.events() as readonly Event[])
  if (open.length === 0) return
  const listed = await listServices({ ctx })
  if (!listed.ok) {
    ctx.log(`services: takeover reconcile skipped, the sandbox did not answer: ${listed.reason}`)
    return
  }
  const known = new Map(listed.value.map((info) => [info.serviceId, info]))
  for (const service of open) {
    const info = known.get(service.started.serviceId)
    if (info === undefined) {
      await recordQuietEnding({ ctx, state, service })
      continue
    }
    if (outcomeOf({ info, stoppedByModel: false }).status === EServiceStatus.Running) continue
    await recordServiceFrame({
      ctx,
      state,
      frame: { kind: 'event', event: { type: 'services.ended', serviceId: info.serviceId, info } },
    })
  }
}
