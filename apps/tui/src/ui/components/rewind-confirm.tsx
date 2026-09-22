import React from 'react'

import type { RewindConfirmRow, RewindConfirmState } from '../rewind-confirm-model'
import { type Hint } from '../hint-layout'
import { useClickRegion, type ClickRegion } from '../hooks/use-click-region'
import { theme } from '../theme'
import { BottomDrawer, drawerCells, DrawerHints, DrawerLine } from './drawer'
import { clipSpans, spanCells, truncateCells } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const HEADING = 'This rewind destroys what was created after that point'

export const SUBTITLE = 'These will be killed and deleted, like they never happened:'

export const CONFIRM_LABEL = 'Rewind anyway'

export const CANCEL_LABEL = 'Cancel'

const TAG_SEPARATOR = ' · '

const RUNNING_NOTE = ' (running)'

const HINTS: readonly Hint[] = [
  { key: 'Enter', label: 'to rewind anyway' },
  { key: 'Esc', label: 'to cancel' },
]

function Line(props: {
  spans: readonly Span[]
  cells: number
  region?: ClickRegion
}): React.ReactNode {
  const region = props.region
  return (
    <DrawerLine
      {...(region === undefined
        ? {}
        : { press: region.handlers, hover: region.handlers, band: region.wash.bg })}
    >
      <text>
        <Spans spans={clipSpans({ spans: props.spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function rowSpans(args: { row: RewindConfirmRow; cells: number }): Span[] {
  const tag: Span[] = [
    { text: args.row.tag, fg: theme.meta },
    { text: TAG_SEPARATOR, fg: theme.rule },
  ]
  const note = args.row.running ? RUNNING_NOTE : ''

  return [
    ...tag,
    {
      text: truncateCells({
        text: args.row.label,
        cells: Math.max(0, args.cells - spanCells(tag) - note.length),
      }),
      fg: theme.body,
    },
    ...(args.row.running ? [{ text: RUNNING_NOTE, fg: theme.warn } as Span] : []),
  ]
}

/**
 * Same bottom drawer as the exit guard: the question is about the rewind the operator just asked
 * for, not about anything in the transcript above it. Enter confirms from anywhere; the two lines
 * exist so a mouse has something to press.
 */
export function RewindConfirm(props: {
  width: number
  state: RewindConfirmState
  overlay?: boolean
  onConfirm: () => void
  onDismiss: () => void
}): React.ReactNode {
  const cells = drawerCells({ width: props.width })
  const confirm = useClickRegion(props.onConfirm)
  const cancel = useClickRegion(props.onDismiss)

  return (
    <BottomDrawer overlay={props.overlay === true}>
      <Line spans={[{ text: HEADING, fg: theme.accent }]} cells={cells} />
      <Line spans={[{ text: SUBTITLE, fg: theme.hint }]} cells={cells} />
      <box flexDirection="column" flexShrink={0}>
        {props.state.rows.map((row) => (
          <Line key={row.id} spans={rowSpans({ row, cells })} cells={cells} />
        ))}
      </box>
      <box height={1} flexShrink={0} />
      <Line spans={[{ text: CONFIRM_LABEL, fg: theme.warn }]} cells={cells} region={confirm} />
      <Line spans={[{ text: CANCEL_LABEL, fg: theme.body }]} cells={cells} region={cancel} />
      <box height={1} flexShrink={0} />
      <DrawerHints hints={HINTS} cells={cells} onDismiss={props.onDismiss} />
    </BottomDrawer>
  )
}
