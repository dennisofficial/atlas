import { useEffect, useRef, useState } from 'react'

import { ENamingPhase, type NamingState } from '../components/naming-line'
import { NAMING_SETTLE_MS, titleCells } from '../naming-frames'

/**
 * The generating phase always shows for at least this long, even when the rename resolves in the
 * same commit the ask started in — a fast LLM (or a name the operator typed) would otherwise let
 * `begin` and `stream` land in one batched render, collapsing the sweep into an instant snap from
 * the old name to the new.
 */
const MIN_GENERATING_MS = 550

/**
 * The longest a rename animation runs from the moment the answer is known: the generating floor,
 * plus the settle sweep. The rename holds its request for at least this long so the surface never
 * hands back to the settled title mid-stream.
 */
export const NAMING_ANIMATION_MS = MIN_GENERATING_MS + NAMING_SETTLE_MS

export type NamingAnimation = {
  /** Set while the animation owns the title line: generating, then streaming the answer in. */
  state: NamingState | null
  /** A rename started from `current` (null for a first name). The generating phase opens now and
   *  runs at least MIN_GENERATING_MS before any answer streams in. */
  begin: (current: string | null) => void
  /** The answer arrived. Streams once the generating floor has elapsed — immediately if it already
   *  has, after the remaining delay if the rename resolved fast. */
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
        const startedAt = current.startedAt
        const wait = Math.max(0, MIN_GENERATING_MS - (Date.now() - startedAt))
        const startCells = current.startCells
        const startedWithName = current.startedWithName

        later(wait + NAMING_SETTLE_MS, () => setState(null))
        later(wait, () =>
          setState((latest) =>
            latest === null
              ? null
              : {
                  phase: ENamingPhase.Streaming,
                  startCells,
                  startedWithName,
                  target: title,
                  startedAt: Date.now(),
                },
          ),
        )

        return {
          phase: ENamingPhase.Generating,
          startCells,
          startedWithName,
          target: title,
          startedAt,
        }
      })
    },
    end: () => {
      clearTimers()
      setState(null)
    },
  }
}
