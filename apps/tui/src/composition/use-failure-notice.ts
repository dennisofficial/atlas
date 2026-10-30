import { useCallback, useState } from 'react'

type FailureNotice = { reason: string; dismissible: boolean }

export function useFailureNotice() {
  const [notice, setNotice] = useState<FailureNotice | null>(null)
  const setFailure = useCallback((reason: string | null) => {
    setNotice(reason === null ? null : { reason, dismissible: true })
  }, [])
  const setTurnFailure = useCallback((reason: string | null) => {
    setNotice(reason === null ? null : { reason, dismissible: false })
  }, [])
  const handleDismiss = useCallback(() => setNotice(null), [])
  const dismissalFor = (): (() => void) | null =>
    notice?.dismissible === true ? handleDismiss : null

  return { failure: notice?.reason ?? null, setFailure, setTurnFailure, dismissalFor }
}
