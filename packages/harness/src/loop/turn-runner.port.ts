import type { ThreadId } from '@dltech/atlas-core'

import type { PauseSignal } from './pause-signal'
import type { TurnOutcome } from './turn-outcome'

export abstract class TurnRunner {
  abstract say(args: {
    threadId: ThreadId
    text: string
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome>

  abstract runTurn(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome>

  abstract resume(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome>
}
