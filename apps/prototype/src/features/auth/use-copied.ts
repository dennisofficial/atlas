import { useCallback, useEffect, useState } from 'react'

const COPIED_MS = 1600

export function useCopied() {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])
  const markCopied = useCallback(() => setCopied(true), [])
  return { copied, markCopied }
}
