import { useCallback, useSyncExternalStore } from 'react'

import { browserReturns, type ReturnStore } from '@dltech/atlas-client/browser-return'
import { returnOutcomeOf, type ReturnOutcome } from '@dltech/atlas-core'

export const useReturnOutcome = (args: {
  state: string | undefined
  durable: ReturnOutcome | undefined
  store?: ReturnStore | undefined
}): ReturnOutcome | undefined => {
  const store = args.store ?? browserReturns
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store])
  const snapshotOf = useCallback(
    () => returnOutcomeOf({ durable: args.durable, local: store.read(args.state) }),
    [store, args.state, args.durable],
  )

  return useSyncExternalStore(subscribe, snapshotOf)
}
