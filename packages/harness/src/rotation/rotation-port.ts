import type { ThreadId } from '@dltech/atlas-core'

import type { TurnOutcome } from '../loop/turn-outcome'

export enum ERotationPhase {
  Idle = 'idle',
  Settling = 'settling',
  Summarising = 'summarising',
  Preparing = 'preparing',
  Committing = 'committing',
  Activating = 'activating',
  Failed = 'failed',
  Aborted = 'aborted',
  Committed = 'committed',
}

export class RotationBusy extends Error {
  constructor(args: { sessionId: string }) {
    super(`session ${args.sessionId} already has a rotation in flight`)
    this.name = 'RotationBusy'
  }
}

export type RotationStage = {
  sessionId: string
  operationId: string
  phase: ERotationPhase
  detail?: string | undefined
}

export type RotationListener = (stage: RotationStage) => void

export type RotationOutcome =
  | {
      kind: 'committed'
      sessionId: string
      operationId: string
      predecessor: ThreadId
      successor: ThreadId
      handoffPath: string
      watermarkSeq: number
    }
  | { kind: 'failed'; sessionId: string; operationId: string; reason: string }
  | { kind: 'aborted'; sessionId: string; operationId: string; reason: string }

export type RotationStatus =
  | { kind: 'idle' }
  | {
      kind: 'active'
      sessionId: string
      operationId: string
      phase: ERotationPhase
      predecessor: ThreadId
      successor: ThreadId | undefined
      watermarkSeq: number | undefined
    }

export type RotationSettle = {
  /** Pauses the running predecessor turn at its next loop boundary; a no-op when no turn runs. */
  pause: () => void
  /** Resolves with the settled turn's outcome, or null when no turn was running. */
  waitSettled: () => Promise<TurnOutcome | null>
}

export abstract class RotationPort {
  /**
   * Runs a forward-only rotation of the session's active main: durable intent, settle at the loop
   * boundary, fixed watermark, handoff, successor prepare, atomic commit, auto-activate, reconcile.
   * Throws RotationBusy when a rotation is already in flight for the session; a duplicate request
   * for the same in-flight operation is refused rather than producing a second successor.
   * The successor is started directly after commit; the caller MUST hold the session's
   * one-turn-at-a-time invariant (the slice-2 authority fence at admission is the durable guard —
   * this port never counts runners).
   */
  abstract request(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
    settle: RotationSettle
  }): Promise<RotationOutcome>

  /** Reads the durable rotation record for the session, or idle when none is in flight. */
  abstract status(args: { sessionId: string }): Promise<RotationStatus>

  /**
   * After a restart: an interrupted `preparing` rotation aborts back to the predecessor; a
   * `committed` one re-activates the successor (fenced, never a duplicate turn). The caller MUST
   * supply `activate` as its guarded turn-starter whenever one exists (surface drive path, serve
   * admission); the default starts the successor's turn directly and is idempotent only within
   * this process. Duplicate-turn exclusion across the session is the slice-2 fence's job, not a
   * runner count here.
   */
  abstract recover(args: { sessionId: string; activate?: (() => Promise<void>) | undefined }): Promise<RotationStatus>

  abstract subscribe(listener: RotationListener): () => void
}
