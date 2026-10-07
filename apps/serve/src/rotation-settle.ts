import type { RotationSettle, TurnOutcome } from '@dltech/atlas-harness'

export function createRotationSettle(args: {
  stop: () => void
  inFlight: () => { commit: Promise<void> | null; turn: Promise<void> | null }
  outcome: () => TurnOutcome | null
  failure: () => Error | null
}): RotationSettle {
  const { commit, turn } = args.inFlight()
  return {
    pause: args.stop,
    waitSettled: async () => {
      await commit
      await turn
      if (turn === null) return null
      const failure = args.failure()
      if (failure !== null) throw failure
      return args.outcome()
    },
  }
}
