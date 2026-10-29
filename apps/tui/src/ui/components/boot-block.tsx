import type { TextRenderable } from '@opentui/core'
import React, { useEffect, useRef } from 'react'

import { EStepMark, type ContainerMove, type MoveRow } from '../../composition/container-move'
import { serveStageOf } from '../../composition/container-move-birth'
import { subscribeTicker } from '../hooks/use-shimmer-clock'
import { wrapWords } from '../text-flow'
import { formatElapsed, theme } from '../theme'
import { rowSpans } from './container-move'
import { ShimmerLine } from './shimmer-line'
import { Spans } from './spans'
import { transferSpans } from './transfer-meter'

const INDENT = 2
const NARROWEST = 20
const ELAPSED_TICK_MS = 1000

const CANCEL_HINT = 'esc to cancel and keep the draft'
const DISMISS_HINT = 'esc to dismiss'

const elapsedOf = (since: number): string => formatElapsed(Math.max(0, Date.now() - since))

function ElapsedText(props: { since: number }): React.ReactNode {
  const ref = useRef<TextRenderable>(null)

  useEffect(() => {
    const write = (): void => {
      const node = ref.current
      if (node === null || node.isDestroyed) return
      node.content = `elapsed ${elapsedOf(props.since)}`
    }
    return subscribeTicker({ intervalMs: ELAPSED_TICK_MS, onTick: write })
  }, [props.since])

  return <text ref={ref} fg={theme.warn} content={`elapsed ${elapsedOf(props.since)}`} />
}

function RowLines(props: { row: MoveRow; since: number; cells: number }): React.ReactNode {
  const { row } = props
  const serve = serveStageOf(row)
  const transfers =
    row.mark === EStepMark.Done
      ? []
      : (row.transfers ?? []).map((transfer) => (
          <text key={`${transfer.nodeId}:${transfer.transferId}`}>
            <Spans spans={transferSpans({ transfer, cells: props.cells })} />
          </text>
        ))

  return (
    <>
      {row.mark === EStepMark.Active ? (
        <ShimmerLine label={() => `${row.text} (${elapsedOf(props.since)})`} />
      ) : (
        <text>
          <Spans spans={rowSpans(row)} />
        </text>
      )}
      {serve === null ? null : (
        <text>
          <Spans spans={[{ text: '  ' }, { text: serve, fg: theme.meta }]} />
        </text>
      )}
      {transfers}
    </>
  )
}

export function BootBlockView(props: {
  move: ContainerMove
  cancellable: boolean
  width: number
}): React.ReactNode {
  const { move } = props
  const inner = Math.max(NARROWEST, props.width - INDENT * 2)
  const reason = move.failure === null ? [] : wrapWords({ text: move.failure, width: inner })

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={INDENT} marginTop={1} marginBottom={1}>
      <text fg={theme.meta}>{move.heading ?? ''}</text>
      {move.failure === null ? <ElapsedText since={move.startedAt} /> : null}
      {move.rows.map((row) => (
        <RowLines key={row.id} row={row} since={move.activeSince} cells={inner} />
      ))}
      {reason.map((line) => (
        <text key={line} fg={theme.error}>
          {line}
        </text>
      ))}
      {move.failure !== null || props.cancellable ? (
        <text fg={theme.hint}>{move.failure === null ? CANCEL_HINT : DISMISS_HINT}</text>
      ) : null}
    </box>
  )
}
