import { useEffect, useRef } from 'react'

const MAX_WAKE_ATTEMPTS = 3

/**
 * The witness names the set of pending notices by their joined ids, so a re-render alone never
 * re-fires a wake that already went out for the same set. A turn that dies before its first drain
 * leaves the same notices pending, though, so the same witness is allowed to fire again — bounded
 * by MAX_WAKE_ATTEMPTS, which is what keeps a turn that dies instantly every time from spinning
 * here. A drained or changed witness resets the count.
 */
export function useWakeWitness(args: {
  witness: string | null
  blocked: boolean
  onWake: () => void
}): void {
  const { witness, blocked, onWake } = args

  const attempts = useRef<{ witness: string | null; count: number }>({ witness: null, count: 0 })

  useEffect(() => {
    if (witness === null) {
      attempts.current = { witness: null, count: 0 }
      return
    }
    if (blocked) return

    if (attempts.current.witness !== witness) attempts.current = { witness, count: 0 }
    if (attempts.current.count >= MAX_WAKE_ATTEMPTS) return

    attempts.current = { witness, count: attempts.current.count + 1 }
    onWake()
  }, [blocked, onWake, witness])
}
