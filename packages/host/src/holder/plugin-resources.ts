import type { RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type AfterTurn, type BeforeTurn } from '@dltech/atlas-core'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'

import { messageOf } from './plugin-resource-probes'
import { loadedDraftsOf, RELOADED } from './plugin-resource-refresh'
import type { ResourceSync } from './plugin-resource-sync'

type Ctx = PluginPodContext

export const reloadResource = async (args: {
  ctx: Ctx
  resource: PodResource<unknown>
  directory: string
}): Promise<void> => {
  try {
    const drafts = await loadedDraftsOf({
      resource: args.resource,
      ctx: args.ctx,
      directory: args.directory,
      fingerprint: RELOADED,
    })
    await args.ctx.append(drafts)
  } catch (failure) {
    args.ctx.log(`plugin resource ${args.resource.name} could not reload: ${messageOf(failure)}`)
  }
}

export const pluginResourcesHook = (args: { sync: ResourceSync }): RegisteredHook<BeforeTurn> => ({
  name: 'plugin-resources',
  order: { stage: EStage.Guard, nudge: 0 },
  awaited: true,
  run: async () => {
    await args.sync.turnStart()
    return {}
  },
})

export const pluginResourcesClosedHook = (args: {
  sync: ResourceSync
}): RegisteredHook<AfterTurn> => ({
  name: 'plugin-resources-closed',
  order: { stage: EStage.Guard, nudge: 0 },
  awaited: true,
  run: async () => {
    args.sync.refreshInBackground()
    return {}
  },
})
