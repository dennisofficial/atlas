import type { ThreadId } from '@dltech/atlas-core'
import type { MessageIntake } from '@dltech/atlas-harness'

export function createHistoryAdmission(args: {
  threadId: ThreadId
  intake: MessageIntake | null
  unavailable: () => boolean
  refusal?: (() => string | undefined) | undefined
}) {
  let held = false
  const assertAvailable = (): void => {
    if (held) throw new Error('the history is being summarised — wait for it to finish')
  }
  return {
    held: () => held,
    assertAvailable,
    hold: (): (() => void) => {
      assertAvailable()
      const refusal = args.refusal?.()
      if (refusal !== undefined) throw new Error(refusal)
      if (args.unavailable()) {
        throw new Error('a turn or workspace handoff is running — wait before summarising history')
      }
      held = true
      const release = args.intake?.hold({ threadId: args.threadId })
      return () => {
        held = false
        release?.()
        args.intake?.changed()
      }
    },
  }
}
