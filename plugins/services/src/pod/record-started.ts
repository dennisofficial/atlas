import type { EventDraft } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

export const appendStarted = async ({
  ctx,
  started,
}: {
  ctx: PluginPodContext
  started: Extract<EventDraft, { type: 'service-started' }>
}): Promise<void> => {
  await ctx.append([started])
  if (ctx.subAgent === undefined) return
  await ctx.subAgent.appendToParent([{ ...started, agentId: ctx.subAgent.agentId }])
}
