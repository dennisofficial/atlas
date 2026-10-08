import type { EventDraft } from '@dltech/atlas-core'
import type { TurnOutcome } from '@dltech/atlas-harness'
import type { RefObject } from 'react'

import type { DriveOptions } from './use-driven-turn'
import type { RewindConfirmControl } from './use-rewind-confirm'

export type TurnDriver = {
  working: boolean
  workingRef: RefObject<boolean>
  rewindConfirm: RewindConfirmControl
  drive: (drafts: readonly EventDraft[], opts?: DriveOptions) => Promise<void>
  handleInterrupt: () => void
  handleInterruptForMove: () => void
  handlePauseForMove: () => void
  turnInFlight: () => boolean
  handleRetry: () => void
  handleResume: () => void
  handleResumeFresh: () => void
  handleRewindTo: (toSeq: number) => void
  isResumable: boolean
  settle: () => void
  whenSettled: () => Promise<void>
  lastOutcome: RefObject<TurnOutcome | null>
}
