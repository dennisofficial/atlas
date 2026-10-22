import { useEffect, useState } from 'react'

const TICK_MS = 1000

export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return undefined
    const interval = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(interval)
  }, [enabled])

  return now
}
