import { EExecutionLocation, EHarnessPlacement, type ThreadId } from '@dltech/atlas-core'

import { driveNameFor, EPlacementMoveKind } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

/**
 * The sandbox knows it is cloud by construction, but the placement record it restored may have
 * been written by a lift that never filled in the drive name (chooseExecutionLocation maps the
 * location to a bare `{ harness: Cloud }`). Serve owns the correction: the name is derivable from
 * the thread id, so the family's durable record is complete once serve has read it. The move is a
 * same-location commit — a fill, not a relocation — so it never rewrites where the session runs.
 */
export async function hydrateCloudPlacement(args: {
  app: Pick<ServeApp, 'executionLocation'>
  threadId: ThreadId
}): Promise<void> {
  const controller = args.app.executionLocation
  if (controller === undefined) return
  const record = await controller.load({ threadId: args.threadId })
  if (record.placement.harness !== EHarnessPlacement.Cloud) return
  if (record.placement.driveName !== undefined) return
  if (record.move !== null) return
  await controller.move({
    threadId: args.threadId,
    target: EExecutionLocation.Cloud,
    kind: EPlacementMoveKind.Correct,
    work: async (transaction) => {
      await transaction.commit({
        harness: EHarnessPlacement.Cloud,
        driveName: driveNameFor({ threadId: args.threadId }),
      })
    },
  })
}
