import React from 'react'

import { CloudSignInPrompt, CloudSignInRow } from '../ui/components/settings/cloud-sign-in'
import { Spans } from '../ui/components/spans'
import type { SettingsLoginState } from '../ui/settings-login-model'
import { theme } from '../ui/theme'

const MAX_COLUMN_CELLS = 76

const MIN_LINE_CELLS = 20

const COLUMN_PAD = 4

const MAX_REASON = 1

const HINTS = '⏎ sign in    ctrl+c quit'

export function SignInScreen(props: {
  width: number
  state: SettingsLoginState
  reason?: string | null
  onSignIn: () => void
  onOpenUrl: (url: string) => void
}): React.ReactNode {
  const column = Math.min(props.width, MAX_COLUMN_CELLS)
  const cells = Math.max(MIN_LINE_CELLS, column - COLUMN_PAD)
  const prompt = props.state.prompt

  return (
    <box
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      flexGrow={MAX_REASON}
      width={props.width}
    >
      <box flexDirection="column" width={column} flexShrink={0}>
        <text fg={theme.bright}>Atlas</text>
        <text fg={theme.body}>Sign in to Atlas Cloud from this terminal.</text>
        <text> </text>
        <CloudSignInRow cells={cells} status={props.state.status} onSignIn={props.onSignIn} />
        <CloudSignInPrompt
          cells={cells}
          state={props.state}
          onOpenUrl={() => {
            if (prompt !== null) props.onOpenUrl(prompt.url)
          }}
        />
        {props.reason === null || props.reason === undefined ? null : (
          <text fg={theme.warn}>{props.reason}</text>
        )}
        {props.state.failure === null ? null : <text fg={theme.warn}>{props.state.failure}</text>}
        <text> </text>
        <text>
          <Spans spans={[{ text: HINTS, fg: theme.hint }]} />
        </text>
      </box>
    </box>
  )
}
