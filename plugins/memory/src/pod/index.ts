import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { DeleteMemoryTool } from './delete-tool'
import { EditMemoryTool } from './edit-tool'
import { MemoryFragment } from './fragment'
import { memoryIndexHook } from './index-hook'
import { ReadMemoryTool } from './read-tool'
import { stateFor } from './state'
import { WriteMemoryTool } from './write-tool'

export { MemoryFragment } from './fragment'
export { withMemoryIndex } from './index-block'
export { markStale, stateFor, type MemoryPodState } from './state'

export const MEMORY_TOOLS = ['write_memory', 'read_memory', 'edit_memory', 'delete_memory'] as const

export const memoryPod: PodSlot = {
  ...EMPTY_POD,
  tools: (ctx) => {
    const state = stateFor(ctx)
    return [
      new WriteMemoryTool(ctx, state),
      new ReadMemoryTool(ctx),
      new EditMemoryTool(ctx, state),
      new DeleteMemoryTool(ctx, state),
    ]
  },
  hooks: (ctx) => ({ beforeStep: [memoryIndexHook(ctx, stateFor(ctx))] }),
  prompts: [new MemoryFragment()],
}
