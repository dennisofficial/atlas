import {
  EHarnessPlacement,
  EToolEnvironment,
  executionLocationOf,
  locationOfPlacement,
  placementOf,
  EExecutionLocation,
  type PlacementRecord,
  type SessionPlacement,
} from '@dltech/atlas-core'

import type { ThreadMeta } from './meta'

export class PlacementConflict extends Error {
  constructor(args: { expected: number; found: number }) {
    super(
      `the session placement moved underneath this write (expected revision ${args.expected}, found ${args.found})`,
    )
    this.name = 'PlacementConflict'
  }
}

const placementFrom = (value: unknown): SessionPlacement | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const held = value as { harness?: unknown; tools?: unknown; driveName?: unknown }
  if (held.harness === EHarnessPlacement.Cloud) {
    return typeof held.driveName === 'string'
      ? { harness: EHarnessPlacement.Cloud, driveName: held.driveName }
      : { harness: EHarnessPlacement.Cloud }
  }
  if (held.harness !== EHarnessPlacement.Host) return undefined
  return {
    harness: EHarnessPlacement.Host,
    tools: held.tools === EToolEnvironment.Docker ? EToolEnvironment.Docker : EToolEnvironment.Host,
  }
}

export function placementRecordOf(meta: ThreadMeta): PlacementRecord {
  const stored = meta.placement
  const placement =
    stored === undefined || stored === null ? undefined : placementFrom(stored.placement)
  if (placement === undefined) {
    return {
      placement: placementOf(
        executionLocationOf(meta.executionLocation) ?? EExecutionLocation.Host,
      ),
      revision: 0,
    }
  }
  return { placement, revision: stored?.revision ?? 0 }
}

export function metaWithPlacement(args: { meta: ThreadMeta; record: PlacementRecord }): ThreadMeta {
  return {
    ...args.meta,
    executionLocation: locationOfPlacement(args.record.placement),
    placement: {
      placement: args.record.placement,
      revision: args.record.revision,
    },
  }
}
