import {
  indexPressureOf,
  reconcileNoticeOf,
  systemNotice,
  type ReconcileEntry,
} from '@dltech/atlas-core'
import { crossLatch, type MemorySnapshot, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { currentMemoryIndex } from './index-block'
import type { MemoryPodState } from './state'

export const MEMORY_RECONCILE_LATCH = 'memory-reconcile'

const entriesOf = (snapshot: MemorySnapshot): readonly ReconcileEntry[] =>
  snapshot.memories
    .filter((memory) => memory.scope === 'global' || snapshot.project !== null)
    .map((memory) => ({
      scope: memory.scope,
      name: memory.name,
      updatedAt: memory.updatedAt,
      descriptionChars: memory.description.length,
    }))

export const reconcileNoticeAfterChange = async (args: {
  ctx: Pick<PluginPodContext, 'control' | 'append' | 'events' | 'log'>
  state: MemoryPodState
  mayFire: boolean
}): Promise<string | undefined> => {
  try {
    await currentMemoryIndex(args)
    const { text, snapshot, failed } = args.state
    if (failed || text === null || snapshot === null) return undefined
    const pressure = indexPressureOf(text.length)
    const fire = await crossLatch({
      ctx: args.ctx,
      name: MEMORY_RECONCILE_LATCH,
      level: pressure,
      mayFire: args.mayFire,
    })
    if (!fire) return undefined
    const content = reconcileNoticeOf({
      pressure,
      indexChars: text.length,
      entries: entriesOf(snapshot),
    })
    return systemNotice({ kind: 'memory-reconcile', content })
  } catch (error) {
    args.ctx.log(`memory: the reconcile check failed: ${String(error)}`)
    return undefined
  }
}
