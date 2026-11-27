import { useCallback, useEffect, useReducer, useState } from 'react'

import {
  apiResourceReducer,
  EResourceAction,
  EResourceState,
  initialApiResourceState,
} from './api-resource-state'

export const useApiResource = <T>({
  load,
  deps,
}: {
  load: () => Promise<T>
  deps: readonly unknown[]
}): { state: EResourceState; data: T | null; reload: () => void } => {
  const [state, dispatch] = useReducer(apiResourceReducer<T>, undefined, initialApiResourceState<T>)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    dispatch({ type: EResourceAction.Started })
    load()
      .then((data) => {
        if (!cancelled) dispatch({ type: EResourceAction.Loaded, data })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: EResourceAction.Failed })
      })
    return () => {
      cancelled = true
    }
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])

  return { state: state.state, data: state.data, reload }
}
