import { useEffect, useState } from 'react'

const CLOCK_TICK_MS = 60_000

export function useClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(interval)
  }, [])
  return now
}
