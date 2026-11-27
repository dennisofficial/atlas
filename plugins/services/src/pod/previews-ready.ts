import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { hasPreviewsReady } from '../core/previews-event'
import { previewsStatus } from './daemon'
import type { ServicePodState } from './state'

export const recordPreviewsReady = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
  at: string
}): Promise<void> => {
  const { ctx, state, at } = args
  if (state.previewsReadies.has(at)) return
  if (hasPreviewsReady({ events: ctx.events(), at })) {
    state.previewsReadies.add(at)
    return
  }
  state.previewsReadies.add(at)
  try {
    await ctx.append([{ type: 'previews-ready', at }])
  } catch (error) {
    state.previewsReadies.delete(at)
    ctx.log(`services: recording the preview tunnel ready failed: ${String(error)}`)
  }
}

export const reconcilePreviewsReady = async (args: {
  ctx: PluginPodContext
  state: ServicePodState
}): Promise<void> => {
  const { ctx, state } = args
  const asked = await previewsStatus({ ctx })
  if (!asked.ok) {
    ctx.log(`services: the preview tunnel readiness is unknown: ${asked.reason}`)
    return
  }
  if (asked.value.state !== 'up' || asked.value.upAt === undefined) return
  await recordPreviewsReady({ ctx, state, at: asked.value.upAt })
}
