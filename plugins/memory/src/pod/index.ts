import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { MemoryFragment } from './fragment'
import { memoryIndexHook } from './index-hook'
import { MemoryTool } from './memory-tool'
import { stateFor } from './state'

export { MemoryFragment } from './fragment'
export { withMemoryIndex } from './index-block'
export { markStale, stateFor, type MemoryPodState } from './state'

export const MEMORY_TOOLS = ['memory'] as const

export const memoryPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: MEMORY_TOOLS,
  tools: (ctx) => {
    const state = stateFor(ctx)
    return [new MemoryTool(ctx, state)]
  },
  hooks: (ctx) => ({ beforeStep: [memoryIndexHook(ctx, stateFor(ctx))] }),
  prompts: [new MemoryFragment()],
}
