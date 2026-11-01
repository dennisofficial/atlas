import type { MessageIntake, RotationSettle, TurnOutcome } from '@dltech/atlas-harness'

import type { Said } from './turn-commit'

export type TurnRunOptions = {
  resume?: boolean | undefined
  onlyIfIdle?: boolean | undefined
}

export type ServeTurnDriver = {
  say: (args: Said) => Promise<void>
  run: (options?: TurnRunOptions) => void
  sayOrRun: () => boolean
  interrupt: () => void
  dismissFailure: (args: { failureSeq: number }) => Promise<void>
  pause: () => void
  beginRelocation: () => Promise<void>
  beginRotation: () => RotationSettle
  relocationResumable: () => boolean
  resume: () => void
  running: () => boolean
  busy: () => boolean
  outcome: () => TurnOutcome | null
  failure: () => Error | null
  outcomePending: () => boolean
  settled: () => Promise<void>
  attach: (shared: MessageIntake) => () => void
  holdHistory: () => () => void
  holdForRotation: () => () => void
}

export type TurnDriverHooks = {
  onTurnStarted: () => void
  onTurnEnded: () => void
  onOutcome: (outcome: TurnOutcome) => void
  onFailure: (reason: string) => void
  holdWorking?: (() => () => void) | undefined
}
