import { EMPTY_POD, type PodSlot } from '@dltech/atlas-plugin-sdk'

import { MemoryFragment } from './fragment'
import { memoryIndexResource } from './index-block'
import { memoryIndexHook } from './index-hook'
import { MemoryTool } from './memory-tool'

export { MemoryFragment } from './fragment'
export { MEMORY_INDEX_RESOURCE, memoryIndexResource, withMemoryIndex } from './index-block'

export const MEMORY_TOOLS = ['memory'] as const

export const memoryPod: PodSlot = {
  ...EMPTY_POD,
  childDeny: MEMORY_TOOLS,
  tools: (ctx) => [new MemoryTool(ctx)],
  hooks: (ctx) => ({ beforeStep: [memoryIndexHook(ctx)] }),
  prompts: [new MemoryFragment()],
  resources: [memoryIndexResource],
}
