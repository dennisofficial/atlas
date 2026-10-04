import React from 'react'

import {
  EStepMark,
  moveHeading,
  type ContainerMove,
  type MoveRow,
} from '../../composition/container-move'
import { wrapWords } from '../text-flow'
import { formatElapsed, theme } from '../theme'
import {
  BottomDrawer,
  DrawerGap,
  DrawerHeading,
  DrawerHints,
  DrawerLine,
  drawerCells,
  DRAWER_INSET,
} from './drawer'
import { ShimmerLine } from './shimmer-line'
import { Spans, type Span } from './spans'

const NARROWEST = 24

const rowSpans = (row: MoveRow): readonly Span[] => {
  if (row.mark === EStepMark.Done) {
    return [
      { text: '✓ ', fg: theme.ok },
      { text: row.text, fg: theme.dim },
    ]
  }
  if (row.mark === EStepMark.Failed) {
    return [
      { text: '✗ ', fg: theme.error },
      { text: row.text, fg: theme.error },
    ]
  }

  return [
    { text: '· ', fg: theme.dim },
    { text: row.text, fg: theme.dim },
  ]
}

function RowLine(props: { row: MoveRow; elapsedMs: number }): React.ReactNode {
  const { row } = props

  if (row.mark === EStepMark.Active) {
    return (
      <DrawerLine>
        <ShimmerLine label={`${row.text} (${formatElapsed(Math.max(0, props.elapsedMs))})`} />
      </DrawerLine>
    )
  }

  return (
    <DrawerLine>
      <text>
        <Spans spans={rowSpans(row)} />
      </text>
    </DrawerLine>
  )
}

export function ContainerMoveOverlay(props: {
  move: ContainerMove
  now: number
  width: number
  onDismiss: () => void
}): React.ReactNode {
  const { move } = props
  const inner = Math.max(NARROWEST, props.width - DRAWER_INSET)
  const reason = move.failure === null ? [] : wrapWords({ text: move.failure, width: inner })

  return (
    <BottomDrawer overlay>
      <DrawerHeading label={move.heading ?? moveHeading(move.target)} />
      {move.rows.map((row) => (
        <RowLine key={row.id} row={row} elapsedMs={props.now - move.activeSince} />
      ))}
      {move.failure === null ? null : (
        <>
          <DrawerGap />
          {reason.map((line) => (
            <DrawerLine key={line}>
              <text fg={theme.error}>{line}</text>
            </DrawerLine>
          ))}
          <DrawerHints
            hints={[{ key: 'esc', label: 'carry on' }]}
            cells={drawerCells({ width: props.width })}
            onDismiss={props.onDismiss}
          />
        </>
      )}
    </BottomDrawer>
  )
}
