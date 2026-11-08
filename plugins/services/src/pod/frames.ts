import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { DaemonEventFrame } from '@dltech/atlas-protocol'

import { readServiceLog } from './daemon'
import type { ServicePodState } from './state'
import { hasEnded, hasReady, outcomeOf, startedOf } from './status'

export const TAIL_BYTES = 2_048

const tailOf = async (args: { ctx: PluginPodContext; serviceId: string }): Promise<string> => {
  const sized = await readServiceLog({
    ctx: args.ctx,
    serviceId: args.serviceId,
    offset: 0,
    limit: 1,
  })
  if (!sized.ok || sized.value.totalBytes === 0) return ''
  const { totalBytes } = sized.value
  const read = await readServiceLog({
    ctx: args.ctx,
    serviceId: args.serviceId,
    offset: Math.max(0, totalBytes - TAIL_BYTES),
    limit: TAIL_BYTES,
  })
  if (!read.ok) return ''
  return Buffer.from(read.value.bytes, 'base64').toString('utf8')
}

export const recordServiceFrame = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  frame: DaemonEventFrame
}): Promise<void> => {
  const { ctx, state, frame } = args
  if (frame.event.type === 'services.ready') {
    const { serviceId } = frame.event
    if (state.readies.has(serviceId)) return
    state.readies.add(serviceId)
    try {
      await state.starting.get(serviceId)
      if (hasReady({ events: ctx.events(), serviceId })) return
      await ctx.append([{ type: 'service-ready', serviceId }])
    } catch (error) {
      state.readies.delete(serviceId)
      ctx.log(`services: recording ${serviceId} ready failed: ${String(error)}`)
    }
    return
  }
  if (frame.event.type !== 'services.ended') return
  const { serviceId, info } = frame.event
  if (state.endings.has(serviceId)) return
  state.endings.add(serviceId)
  try {
    await state.starting.get(serviceId)
    const started = startedOf({ events: ctx.events(), serviceId })
    if (started === undefined || hasEnded({ events: ctx.events(), serviceId })) return
    const outcome = outcomeOf({
      info,
      stoppedByModel: state.stopping.has(serviceId),
    })
    const tail = await tailOf({ ctx, serviceId })
    await ctx.append([
      {
        type: 'service-ended',
        serviceId,
        command: started.command,
        ...(started.description === undefined ? {} : { description: started.description }),
        status: outcome.status,
        ...(outcome.killedBy === undefined ? {} : { killedBy: outcome.killedBy }),
        ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
        tail,
        ...(state.restarting.has(serviceId) ? { restarting: true as const } : {}),
      },
    ])
  } catch (error) {
    state.endings.delete(serviceId)
    ctx.log(`services: recording the ending of ${serviceId} failed: ${String(error)}`)
  }
}
