import type { SessionPlacement, ThreadId } from '@dltech/atlas-core'

import type { SessionAuthorityPort } from '../store/sessions/meta'
import type { ThreadStorePort } from '../store/thread-store'

export type PlacementStore = Pick<
  ThreadStorePort,
  'readPlacement' | 'writePlacement' | 'onPlacementChanged' | 'find'
>

export type PlacementSessionAuthority = Pick<SessionAuthorityPort, 'activeMainOf'>

export class PlacementBusy extends Error {
  constructor() {
    super('a placement change is already underway for this session')
  }
}

/**
 * The handle the cloud-birth path commits through: no move lifecycle, just the durable placement
 * write the birth's provisioning is the content of. `commit` is the CAS record write; `committed`
 * lets the caller tell a committed birth from one that failed before the write.
 */
export type PlacementCommit = {
  committed: () => boolean
  commit: (placement: SessionPlacement) => Promise<void>
}
