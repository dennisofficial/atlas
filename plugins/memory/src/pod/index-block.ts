import type { Assembled } from '@dltech/atlas-core'
import { readResource, type PluginPodContext, type PodResource } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { memoryIndexOf } from '../core'

export const MEMORY_INDEX_RESOURCE = 'memory-index'

export type MemoryIndexSnapshot = { text: string }

const snapshotSchema: z.ZodType<MemoryIndexSnapshot> = z.object({ text: z.string() })

export const memoryIndexResource: PodResource<MemoryIndexSnapshot> = {
  name: MEMORY_INDEX_RESOURCE,
  schema: snapshotSchema,
  load: async ({ ctx }) => ({ text: memoryIndexOf(await ctx.control.memory.list()) }),
}

export const withMemoryIndex = (args: {
  assembled: Assembled
  ctx: Pick<PluginPodContext, 'events'>
}): Assembled => {
  const snapshot = readResource({ ctx: args.ctx, resource: memoryIndexResource })
  if (snapshot === undefined) return args.assembled
  return {
    ...args.assembled,
    system: [...args.assembled.system, { text: snapshot.text, source: MEMORY_INDEX_RESOURCE }],
  }
}
