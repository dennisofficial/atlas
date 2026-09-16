import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { theme } from '../../theme'
import type { Span } from '../spans'
import { SettingsGroupHeader, SettingsTextLine } from './rows'

export function SettingsAccount(props: {
  cells: number
  email: string | null
  signedIn: boolean
  onSignOut: () => void
}): React.ReactNode {
  const signOut = useClickRegion(props.signedIn ? props.onSignOut : undefined)

  const whom: Span = props.signedIn
    ? { text: props.email ?? 'signed in', fg: theme.hover }
    : { text: 'not signed in', fg: theme.hint }

  return (
    <box flexDirection="column" flexShrink={0}>
      <SettingsGroupHeader label="Atlas Cloud" />
      <SettingsTextLine label="Signed in as" value={[whom]} cells={props.cells} />
      {props.signedIn ? (
        <SettingsTextLine
          label="Sign out"
          value={[{ text: '⏎', fg: theme.hint }]}
          cells={props.cells}
          selected
          {...(signOut.wash.bg === undefined ? {} : { band: signOut.wash.bg })}
          press={signOut.handlers}
        />
      ) : (
        <SettingsTextLine
          label="Sign in"
          value={[{ text: 'from the accounts overlay — ctrl+a', fg: theme.hint }]}
          cells={props.cells}
        />
      )}
    </box>
  )
}
