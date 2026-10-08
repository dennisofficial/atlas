import type { EExecutionLocation, SessionPlacement, ThreadId } from '@dltech/atlas-core'

import type { SessionAuthorityPort } from '../store/sessions/meta'
import type { ThreadStorePort } from '../store/thread-store'

export type PlacementStore = Pick<
  ThreadStorePort,
  'readPlacement' | 'writePlacement' | 'onPlacementChanged' | 'find'
>

export type PlacementSessionAuthority = Pick<SessionAuthorityPort, 'activeMainOf'>

export enum EPlacementMoveKind {
  Tools = 'tools',
  Lift = 'lift',
  Descend = 'descend',
  /** A same-placement fill: the record stays put, only its detail (e.g. drive name) is written. */
  Correct = 'correct',
}

export class PlacementBusy extends Error {
  constructor() {
    super('a placement move is already underway for this session')
  }
}

export type PlacementTransaction = {
  from: EExecutionLocation
  committed: () => boolean
  commit: (placement?: SessionPlacement) => Promise<void>
  /**
   * Ends the move without flipping placement, for work that reports its failure as a value rather
   * than throwing it. The preparation marker is cleared and the source placement stands.
   */
  abandon: () => void
}

export type MoveSettledListener = (args: { threadId: ThreadId }) => void
