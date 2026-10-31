import { useCallback, useEffect, useRef, useState } from 'react'

import { activePendingOf, type PendingAction, type PendingRemedy } from './run-attention-pending'

export function usePendingRemedy(args: { key: string | null; working: boolean }): {
  pending: PendingRemedy | null
  begin: (remedy: PendingRemedy) => boolean
  clear: () => void
} {
  const { key, working } = args
  const [state, setState] = useState<PendingAction | null>(null)
  const guard = useRef<PendingAction | null>(null)
  const pending = activePendingOf({ pending: state, key, working })

  useEffect(() => {
    if (pending !== null) return
    guard.current = null
    setState(null)
  }, [pending])

  const begin = useCallback(
    (remedy: PendingRemedy): boolean => {
      if (key === null) return false
      if (guard.current !== null && guard.current.key === key) return false
      const next = { remedy, key }
      guard.current = next
      setState(next)
      return true
    },
    [key],
  )

  const clear = useCallback(() => {
    guard.current = null
    setState(null)
  }, [])

  return { pending, begin, clear }
}
