import type { TextRenderable } from '@opentui/core'
import React, { useEffect, useRef } from 'react'

import { subscribeTicker } from '../hooks/use-shimmer-clock'
import {
  namingGenerating,
  namingSettled,
  namingStreaming,
  NAMING_SETTLE_MS,
  type NamingLine,
} from '../naming-frames'
import { SHIMMER_TICK_MS } from '../shimmer-frames'

export enum ENamingPhase {
  Generating = 'generating',
  Streaming = 'streaming',
}

export type NamingState = {
  phase: ENamingPhase
  startCells: number
  /** Whether `startCells` came from an existing name (a rename) or a neutral guess (a first name). */
  startedWithName: boolean
  target: string | null
  startedAt: number
}

/**
 * The naming animation, painted like ShimmerLine: a tick writes the next StyledText straight into
 * the buffer rather than rendering through React. Both phases are cheap string walks — generating
 * reshuffles noise dots, streaming resolves them left to right while the width glides from
 * `startCells` to the answer's own width. A finished sweep goes quiet by painting the settled
 * title once and unsubscribing; the parent's own state change is what ends it, but the title is
 * already exactly right if that repaint ever lags.
 */
export function NamingLine(props: { state: NamingState; line: NamingLine }): React.ReactNode {
  const ref = useRef<TextRenderable>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    let settled = false
    const paint = (now: number): void => {
      const node = ref.current
      if (node === null || node.isDestroyed) return
      const { state, line } = latest.current
      if (state.phase === ENamingPhase.Generating) {
        node.content = namingGenerating({ startCells: state.startCells, line })
        return
      }
      if (state.target === null) return
      if (settled) return
      if (now - state.startedAt >= NAMING_SETTLE_MS) {
        settled = true
        node.content = namingSettled({ title: state.target, line })
        return
      }
      node.content = namingStreaming({
        title: state.target,
        startCells: state.startCells,
        line,
        now,
        startedAt: state.startedAt,
      })
    }
    paint(Date.now())
    return subscribeTicker({ intervalMs: SHIMMER_TICK_MS, onTick: paint })
  }, [])

  const { state, line } = props
  return (
    <text
      ref={ref}
      content={
        state.phase === ENamingPhase.Generating
          ? namingGenerating({ startCells: state.startCells, line })
          : namingSettled({ title: state.target ?? '', line })
      }
    />
  )
}
