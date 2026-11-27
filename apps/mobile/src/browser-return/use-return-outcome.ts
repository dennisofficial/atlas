import { returnOutcomeOf, type ReturnOutcome } from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { useCallback, useSyncExternalStore } from 'react'

const NO_OUTCOME = (): undefined => undefined

export const useReturnOutcome = (args: {
  state: string | undefined
  durable: ReturnOutcome | undefined
}): ReturnOutcome | undefined => {
  const snapshotOf = useCallback(
    () => returnOutcomeOf({ durable: args.durable, local: browserReturns.read(args.state) }),
    [args.state, args.durable],
  )
  return useSyncExternalStore(browserReturns.subscribe, snapshotOf, NO_OUTCOME)
}
