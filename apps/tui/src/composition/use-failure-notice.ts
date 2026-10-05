import { useCallback, useState } from 'react'

import type { StepFailure } from '../store'

export function useFailureNotice() {
  const [failure, setFailure] = useState<string | null>(null)
  const handleDismiss = useCallback(() => setFailure(null), [])
  const dismissalFor = (reported: StepFailure | null): (() => void) | null =>
    failure !== null && typeof reported?.message !== 'string' ? handleDismiss : null

  return { failure, setFailure, dismissalFor }
}
