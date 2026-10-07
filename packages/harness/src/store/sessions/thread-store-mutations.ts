import { locationOfPlacement, type ThreadId } from '@dltech/atlas-core'

import type { WritePlacementArgs } from '../thread-store'
import { tryReadThreadMeta } from './listing'
import { newThreadMeta, writeMeta, type ThreadMeta } from './meta'
import { metaWithPlacement, PlacementConflict, placementRecordOf } from './placement-meta'
import { sessionDirectory, threadMetaFile } from './paths'
import { writeSessionMetaForRoot } from './session-meta'
import { homeOf } from './thread-store-fields'
import type { ThreadStoreContext } from './thread-store-context'

export async function writePlacementMeta({ context, args }: { context: ThreadStoreContext; args: WritePlacementArgs }): Promise<void> {
  const { registry } = context
  const { threadId, record } = args
  const known = await registry.sessionDirOf({ threadId })
  const sessionDir = known ?? sessionDirectory({ home: context.home, sessionId: threadId })
  const handle = registry.handleFor({ sessionDir })
  const written = await registry.enqueue({
    handle,
    run: async () => {
      const file = threadMetaFile({ sessionDir, threadId })
      const existing = tryReadThreadMeta({ file })
      const base = existing ?? newThreadMeta({ id: threadId, at: context.clock.now() })
      const held = placementRecordOf(base)
      const conflict =
        args.expectedRevision !== undefined &&
        existing !== undefined &&
        existing.placement !== undefined &&
        existing.placement !== null &&
        held.revision !== args.expectedRevision
      if (conflict) {
        throw new PlacementConflict({ expected: args.expectedRevision ?? 0, found: held.revision })
      }
      const meta = metaWithPlacement({
        meta: {
          ...base,
          ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
          ...(args.repo === undefined ? {} : { repo: args.repo }),
        },
        record,
      })
      await writeMeta({ file, meta })
      return meta
    },
  })
  registry.registerThread({ sessionDir, threadId })
  if (sessionDir.endsWith(`/${threadId}`)) {
    await writeSessionMetaForRoot({ registry, sessionDir, root: written, home: locationOfPlacement(record.placement) })
  }
}

export async function updateThreadMeta({
  context,
  threadId,
  change,
}: {
  context: ThreadStoreContext
  threadId: ThreadId
  change: (meta: ThreadMeta) => ThreadMeta
}): Promise<void> {
  const { registry } = context
  const sessionDir = await registry.sessionDirOf({ threadId })
  if (sessionDir === undefined) return
  const handle = registry.handleFor({ sessionDir })
  const next = await registry.enqueue({
    handle,
    run: async () => {
      const file = threadMetaFile({ sessionDir, threadId })
      const meta = tryReadThreadMeta({ file })
      if (meta === undefined) return undefined
      const updated = change(meta)
      await writeMeta({ file, meta: updated })
      return updated
    },
  })
  if (next === undefined || !sessionDir.endsWith(`/${threadId}`)) return
  await writeSessionMetaForRoot({ registry, sessionDir, root: next, home: homeOf({ source: next, fromDir: sessionDir }) })
}
