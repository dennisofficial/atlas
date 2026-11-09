import { EStage, type BeforeStep } from '@dltech/atlas-core'
import type { RegisteredHook } from '@dltech/atlas-agent'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { withMemoryIndex } from './index-block'
import type { MemoryPodState } from './state'

export const memoryIndexHook = (
  ctx: PluginPodContext,
  state: MemoryPodState,
): RegisteredHook<BeforeStep> => ({
  name: 'memory-index',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ assembled }) => await withMemoryIndex({ assembled, ctx, state }),
})
