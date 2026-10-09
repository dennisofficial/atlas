import {
  EHarnessPlacement,
  EPlacementMovePhase,
  type PlacementRecord,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PlacementController } from '@dltech/atlas-harness'
import { driveNameFor } from '@dltech/atlas-wire'

import type { ServeApp } from './serve-app'

const cloudPlacement = (args: { threadId: ThreadId }): SessionPlacement => ({
  harness: EHarnessPlacement.Cloud,
  driveName: driveNameFor({ threadId: args.threadId }),
})

const preparingLiftOntoCloud = (record: PlacementRecord): boolean =>
  record.move !== null &&
  record.move.phase === EPlacementMovePhase.Preparing &&
  record.move.from.harness === EHarnessPlacement.Host &&
  record.move.to.harness === EHarnessPlacement.Cloud

type Threads = Pick<ServeApp['threads'], 'spawned' | 'writePlacement'>

const adoptCloudPlacement = async (args: {
  controller: PlacementController
  threads: Threads
  threadId: ThreadId
  child: boolean
}): Promise<void> => {
  const held = await args.controller.load({ threadId: args.threadId })
  const placement = args.child
    ? ({ harness: EHarnessPlacement.Cloud } satisfies SessionPlacement)
    : cloudPlacement({ threadId: args.threadId })
  await args.threads.writePlacement({
    threadId: args.threadId,
    record: { placement, revision: held.revision + 1, move: null },
    expectedRevision: held.revision,
  })
  await args.controller.refresh({ threadId: args.threadId })
}

export async function hydrateCloudPlacement(args: {
  app: Pick<ServeApp, 'executionLocation'> & { threads: Threads }
  threadId: ThreadId
}): Promise<void> {
  const controller = args.app.executionLocation
  if (controller === undefined) return
  const threads = args.app.threads

  const record = await controller.load({ threadId: args.threadId })
  if (preparingLiftOntoCloud(record)) {
    await controller.recover({
      threadId: args.threadId,
      reconcile: async (held) =>
        preparingLiftOntoCloud(held) ? cloudPlacement({ threadId: args.threadId }) : held.placement,
    })
  }

  const settled = await controller.load({ threadId: args.threadId })
  const rootNeedsCloud =
    settled.move === null &&
    (settled.placement.harness === EHarnessPlacement.Host ||
      (settled.placement.harness === EHarnessPlacement.Cloud && settled.placement.driveName === undefined))
  if (rootNeedsCloud) {
    await adoptCloudPlacement({ controller, threads, threadId: args.threadId, child: false })
  }

  const children = await threads.spawned({ threadId: args.threadId })
  for (const child of children) {
    const held = await controller.load({ threadId: child.id })
    if (held.move !== null) continue
    if (held.placement.harness === EHarnessPlacement.Cloud) continue
    await adoptCloudPlacement({ controller, threads, threadId: child.id, child: true })
  }
}
