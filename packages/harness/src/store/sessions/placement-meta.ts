import { EExecutionLocation, EHarnessPlacement, type PlacementRecord } from '@dltech/atlas-core'

import type { ThreadMeta } from './meta'

export class PlacementConflict extends Error {
  constructor(args: { expected: number; found: number }) {
    super(
      `the session placement moved underneath this write (expected revision ${args.expected}, found ${args.found})`,
    )
    this.name = 'PlacementConflict'
  }
}

export function placementRecordOf(meta: ThreadMeta): PlacementRecord | undefined {
  const stored = meta.placement
  const driveName = stored?.placement?.driveName
  if (stored?.placement !== undefined && stored.placement !== null) {
    return {
      placement: driveName === undefined ? { harness: EHarnessPlacement.Cloud } : { harness: EHarnessPlacement.Cloud, driveName },
      revision: stored.revision,
    }
  }
  if (meta.executionLocation !== EExecutionLocation.Cloud) return undefined
  return { placement: { harness: EHarnessPlacement.Cloud }, revision: stored?.revision ?? 0 }
}

export function metaWithPlacement(args: { meta: ThreadMeta; record: PlacementRecord }): ThreadMeta {
  return {
    ...args.meta,
    executionLocation: EExecutionLocation.Cloud,
    placement: {
      placement: args.record.placement,
      revision: args.record.revision,
    },
  }
}
