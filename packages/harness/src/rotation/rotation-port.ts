import type { ThreadId } from '@dltech/atlas-core'

import type { TurnOutcome } from '../loop/turn-outcome'

export enum ERotationPhase {
  Settling = 'settling',
  Summarising = 'summarising',
  Compacting = 'compacting',
  Done = 'done',
  Failed = 'failed',
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
      kind: 'rotated'
      sessionId: string
      operationId: string
      threadId: ThreadId
      watermarkSeq: number
      replaced: number
    }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; reason: string }

export type RotationSettle = {
  /** Pauses the running turn at its next loop boundary; a no-op when no turn runs. */
  pause: () => void
  /** Resolves with the settled turn's outcome, or null when no turn was running. */
  waitSettled: () => Promise<TurnOutcome | null>
}

export abstract class RotationPort {
  /**
   * Rotates the thread's context window in place: settles the running turn, summarises the whole
   * prefix into a carry-over brief, and compacts non-destructively at the head sequence, so the
   * same thread continues with only the brief in its window and every row still on disk.
   * Throws RotationBusy when a rotation is already in flight for the session. Nothing durable
   * marks a rotation in progress: a crash leaves either the untouched log or a landed watermark.
   */
  abstract request(args: {
    sessionId: string
    threadId: ThreadId
    instructions: string
    settle: RotationSettle
    signal?: AbortSignal | undefined
  }): Promise<RotationOutcome>

  abstract subscribe(listener: RotationListener): () => void
}
