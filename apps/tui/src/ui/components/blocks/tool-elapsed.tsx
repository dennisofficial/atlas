/**
 * How long a call has been going, and how long it took — the same spot on the row says both.
 *
 * While the call is open the reading ticks once a second, written straight into the span the way
 * the spinner beside it already does, so the count costs no React frames. When the result lands the
 * row re-renders once — the call object changes — and the reading freezes at the final duration.
 */

import type { TextNodeRenderable } from '@opentui/core'
import React, { useEffect, useRef } from 'react'

import { settled, type ToolCall } from '../../../store'
import { subscribeTicker } from '../../hooks/use-shimmer-clock'
import { formatElapsed } from '../../theme'

const TICK_MS = 1_000

const WIDEST_READING = '999h 59m'

const parseMs = (stamp: string | null): number | null => {
  if (stamp === null) return null
  const ms = Date.parse(stamp)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The final reading: result time minus call time. A call whose stamps the log never kept — one
 * reconstructed from an old session — says nothing rather than inventing a zero.
 */
export function durationLabelOf(call: ToolCall): string | null {
  const started = parseMs(call.at)
  const ended = parseMs(call.settledAt)
  if (started === null || ended === null) return null
  return formatElapsed(Math.max(0, ended - started))
}

/**
 * How many cells the reading takes on the row. A running call ticks in place without re-rendering,
 * and the row's padding is computed once at render time, so the reservation is the widest reading
 * the format produces rather than the width the reading happens to have this second.
 */
export function elapsedCellsOf(args: { call: ToolCall; separator: string }): number {
  if (!settled(args.call)) return args.separator.length + WIDEST_READING.length
  const duration = durationLabelOf(args.call)
  if (duration === null) return 0
  return args.separator.length + [...duration].length
}

export function ElapsedNote(props: {
  call: ToolCall
  separator: string
  fg: string
  wash: { bg?: string }
}): React.ReactNode {
  const ref = useRef<TextNodeRenderable>(null)
  const latest = useRef(props)
  latest.current = props
  const firstSeenAt = useRef(Date.now())
  const lastReading = useRef<string | null>(null)

  const done = settled(props.call)
  const final = done ? (durationLabelOf(props.call) ?? lastReading.current) : null

  useEffect(() => {
    if (done) return

    const write = (now: number): void => {
      const node = ref.current
      if (node === null) return
      const started = parseMs(latest.current.call.at) ?? firstSeenAt.current
      const reading = formatElapsed(Math.max(0, now - started))
      lastReading.current = reading
      node.children = [`${latest.current.separator}${reading}`]
    }
    write(Date.now())
    return subscribeTicker({ intervalMs: TICK_MS, onTick: write })
  }, [done])

  if (done) {
    if (final === null) return null
    return (
      <span fg={props.fg} {...props.wash}>
        {`${props.separator}${final}`}
      </span>
    )
  }

  const started = parseMs(props.call.at) ?? firstSeenAt.current
  return (
    <span ref={ref} fg={props.fg} {...props.wash}>
      {`${props.separator}${formatElapsed(Math.max(0, Date.now() - started))}`}
    </span>
  )
}
