import React from 'react'

import { Spans } from '../ui/components/spans'
import { theme } from '../ui/theme'

const MAX_COLUMN_CELLS = 76

const HINTS = 's sign out    ctrl+c quit'

const WAITING = 'This Atlas account is waiting for access to Atlas Cloud.'

export function AwaitingAccessScreen(props: {
  width: number
  email: string | null
  onSignOut: () => void
}): React.ReactNode {
  const column = Math.min(props.width, MAX_COLUMN_CELLS)

  return (
    <box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
      <box flexDirection="column" width={column} flexShrink={0}>
        <text fg={theme.bright}>Atlas</text>
        <text fg={theme.body}>{WAITING}</text>
        {props.email === null ? null : (
          <text fg={theme.hint}>{`Signed in as ${props.email}.`}</text>
        )}
        <text> </text>
        <text>
          <Spans spans={[{ text: HINTS, fg: theme.hint }]} />
        </text>
      </box>
    </box>
  )
}
