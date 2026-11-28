import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus, type PreviewTunnelRedial } from '@dltech/atlas-protocol'

const captured = new WeakMap<PluginPodContext, Set<string>>()

export const capturePreviewRedial = (args: {
  ctx: PluginPodContext
  redial: PreviewTunnelRedial
}): void => {
  const { ctx, redial } = args
  const seen = captured.get(ctx) ?? new Set<string>()
  if (seen.has(redial.id)) return
  ctx.analytics.capture({
    event: 'preview_tunnel_redial',
    properties: {
      redial_id: redial.id,
      reason: redial.reason,
      gap_ms: redial.gapMs,
      skew_ms: redial.skewMs,
      stop_ms: redial.stopMs,
      register_ms: redial.registerMs,
      ok: redial.ok,
    },
  })
  seen.add(redial.id)
  captured.set(ctx, seen)
}

export const captureLastPreviewRedial = async (ctx: PluginPodContext): Promise<void> => {
  try {
    const result = await ctx.call({ op: 'previews.status' })
    if (result.status !== ECallStatus.Ok || result.op !== 'previews.status') return
    if (result.value.lastRedial === undefined) return
    capturePreviewRedial({ ctx, redial: result.value.lastRedial })
  } catch (error) {
    ctx.log(`services: reading the last preview redial failed: ${String(error)}`)
  }
}
