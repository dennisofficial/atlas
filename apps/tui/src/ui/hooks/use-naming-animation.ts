import { useEffect, useRef, useState } from 'react'

import { ENamingPhase, type NamingState } from '../components/naming-line'
import { NAMING_SETTLE_MS, titleCells } from '../naming-frames'

/**
 * The longest a rename animation runs from the moment the answer is known: the settle sweep alone.
 * There is no synthetic floor — a bare `/rename` holds the generating phase exactly as long as the
 * LLM takes to answer, and a `/rename name` resolves the operator's typed name the instant the store
 * echoes, so the stream begins immediately. The rename holds its request for at least this long so
 * the surface never hands back to the settled title mid-stream.
 */
export const NAMING_ANIMATION_MS = NAMING_SETTLE_MS

export type NamingAnimation = {
  /** Set while the animation owns the title line: generating, then streaming the answer in. */
  state: NamingState | null
  /** A rename started from `current` (null for a first name). The generating phase opens now and
   *  holds until an answer streams in — the LLM's own latency on a bare rename. */
  begin: (current: string | null) => void
  /** The answer arrived: start the sweep now. Carrying the old width and name means an answer that
   *  lands in the same commit as the begin still streams from the old name rather than snapping. */
  stream: (title: string) => void
  /** End without a settle — the ask was declined, failed, or the thread swapped. */
  end: () => void
}

/**
 * The phase machine both title surfaces read. One source drives the sidebar head and the composer
 * slab — app.tsx arms it when a rename or first titling is in flight and feeds it the answer, so
 * the two surfaces always agree on the frame. `fallbackCells` covers a first name, where there is
 * no old width to continue from; each surface substitutes its own row width when it reads the state
 * back.
 */
export function useNamingAnimation(args: { fallbackCells: number }): NamingAnimation {
  const [state, setState] = useState<NamingState | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    },
    [],
  )

  const clearTimers = (): void => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }

  const later = (ms: number, run: () => void): void => {
    timers.current.push(setTimeout(run, ms))
  }

  return {
    state,
    begin: (current) => {
      clearTimers()
      setState({
        phase: ENamingPhase.Generating,
        startCells: current === null ? args.fallbackCells : Math.max(1, titleCells(current)),
        startedWithName: current !== null,
        target: null,
        startedAt: Date.now(),
      })
    },
    stream: (title) => {
      setState((current) => {
        if (current === null) return current
        later(NAMING_SETTLE_MS, () => setState(null))
        return {
          phase: ENamingPhase.Streaming,
          startCells: current.startCells,
          startedWithName: current.startedWithName,
          target: title,
          startedAt: Date.now(),
        }
      })
    },
    end: () => {
      clearTimers()
      setState(null)
    },
  }
}
