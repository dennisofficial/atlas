import { useEffect, useState } from 'react'

const TICK_MS = 1000

export function useNowEvery(args: { enabled: boolean; tickMs: number }): number {
  const { enabled, tickMs } = args
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return undefined
    const interval = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(interval)
  }, [enabled, tickMs])

  return now
}

export const useNow = (enabled: boolean): number => useNowEvery({ enabled, tickMs: TICK_MS })
