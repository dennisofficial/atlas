import { useEffect, useRef, useState } from 'react'

import { ENamingPhase, type NamingState } from '../components/naming-line'
import { NAMING_SETTLE_MS, titleCells } from '../naming-frames'

export type NamingAnimation = {
  /** Set while the animation owns the title line: generating, then streaming the answer in. */
  state: NamingState | null
  /** Open the generating phase from whatever the line reads now — the old name's width on a
   * rename, or null when the thread was never named. */
  begin: (current: string | null) => void
  /** The answer arrived: resolve into it over NAMING_SETTLE_MS, then settle. */
  stream: (title: string) => void
  /** End without a settle — the ask was declined, failed, or answered by hand. */
  end: () => void
}

/**
 * The phase machine both title surfaces read. One source drives the sidebar head and the composer
 * slab — app.tsx arms it when a rename or first titling is in flight and feeds it the rename echo,
 * so the two surfaces always agree on the frame. `fallbackCells` covers a first name, where there
 * is no old width to continue from; each surface substitutes its own row width when it reads the
 * state back.
 */
export function useNamingAnimation(args: { fallbackCells: number }): NamingAnimation {
  const [state, setState] = useState<NamingState | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    },
    [],
  )

  const clearSettle = (): void => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }

  return {
    state,
    begin: (current) => {
      clearSettle()
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
        if (current === null || current.phase !== ENamingPhase.Generating) return current
        clearSettle()
        settleTimer.current = setTimeout(() => setState(null), NAMING_SETTLE_MS)
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
      clearSettle()
      setState(null)
    },
  }
}
