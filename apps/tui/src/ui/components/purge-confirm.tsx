import React from 'react'

import type { PurgeConfirmState } from '../purge-confirm-model'
import { type Hint } from '../hint-layout'
import { useClickRegion, type ClickRegion } from '../hooks/use-click-region'
import { theme } from '../theme'
import { BottomDrawer, drawerCells, DrawerHints, DrawerLine } from './drawer'
import { clipSpans, truncateCells } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const HEADING = 'Download everything Atlas Cloud holds for you, then delete it there'

export const SUBTITLE = 'Moved to this machine, then removed from the cloud:'

export const SIGN_OUT_NOTE = 'This signs you out when it finishes — afterwards it all lives only here.'

export const CONFIRM_LABEL = 'Download & purge'

export const RUNNING_LABEL = 'Working…'

export const CANCEL_LABEL = 'Cancel'

const ROW_BULLET = '· '

const HINTS: readonly Hint[] = [
  { key: 'Enter', label: 'to download & purge' },
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

/**
 * Same bottom drawer as the rewind confirm: the question is about the purge the operator just
 * asked for, not about the settings page beneath it. Enter confirms from anywhere; the two lines
 * exist so a mouse has something to press.
 */
export function PurgeConfirm(props: {
  width: number
  state: PurgeConfirmState
  overlay?: boolean
  onConfirm: () => void
  onDismiss: () => void
}): React.ReactNode {
  const cells = drawerCells({ width: props.width })
  const running = props.state.running
  const confirm = useClickRegion(running ? undefined : props.onConfirm)
  const cancel = useClickRegion(props.onDismiss)

  return (
    <BottomDrawer overlay={props.overlay === true}>
      <Line spans={[{ text: HEADING, fg: theme.accent }]} cells={cells} />
      <Line spans={[{ text: SUBTITLE, fg: theme.hint }]} cells={cells} />
      <box flexDirection="column" flexShrink={0}>
        {props.state.rows.map((row) => (
          <Line
            key={row.id}
            spans={[
              { text: ROW_BULLET, fg: theme.rule },
              { text: truncateCells({ text: row.label, cells: Math.max(0, cells - ROW_BULLET.length) }), fg: theme.body },
            ]}
            cells={cells}
          />
        ))}
      </box>
      <box height={1} flexShrink={0} />
      <Line spans={[{ text: SIGN_OUT_NOTE, fg: theme.warn }]} cells={cells} />
      <box height={1} flexShrink={0} />
      {running ? (
        <Line spans={[{ text: RUNNING_LABEL, fg: theme.hint }]} cells={cells} />
      ) : (
        <Line spans={[{ text: CONFIRM_LABEL, fg: theme.warn }]} cells={cells} region={confirm} />
      )}
      <Line spans={[{ text: CANCEL_LABEL, fg: theme.body }]} cells={cells} region={cancel} />
      <box height={1} flexShrink={0} />
      <DrawerHints hints={HINTS} cells={cells} onDismiss={props.onDismiss} />
    </BottomDrawer>
  )
}
