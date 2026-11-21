import { EStage, type BeforeStep } from '@dltech/atlas-core'
import type { RegisteredHook } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { withMemoryIndex } from './index-block'

export const memoryIndexHook = (ctx: PluginPodContext): RegisteredHook<BeforeStep> => ({
  name: 'memory-index',
  order: { stage: EStage.Observe, nudge: 0 },
  awaited: true,
  run: async ({ assembled }) => withMemoryIndex({ assembled, ctx }),
})
