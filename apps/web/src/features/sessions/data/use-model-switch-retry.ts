'use client'

import { useCallback, useRef } from 'react'

export type ModelSwitchRetry = {
  arm: (retry: () => void) => void
  disarm: () => void
  handleModelSelected: () => void
}

export function useModelSwitchRetry(): ModelSwitchRetry {
  const armed = useRef<(() => void) | null>(null)

  const arm = useCallback((retry: () => void) => {
    armed.current = retry
  }, [])

  const disarm = useCallback(() => {
    armed.current = null
  }, [])

  const handleModelSelected = useCallback(() => {
    const retry = armed.current
    armed.current = null
    retry?.()
  }, [])

  return { arm, disarm, handleModelSelected }
}
