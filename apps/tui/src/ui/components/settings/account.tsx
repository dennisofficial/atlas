import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import type { SettingsLoginState } from '../../settings-login-model'
import { theme } from '../../theme'
import { clipSpans, wrapCells } from '../sidebar/cells'
import { Spans, type Span } from '../spans'
import { CloudSignInPrompt, CloudSignInRow } from './cloud-sign-in'
import { SettingsGroupHeader, SettingsLine, SettingsTextLine } from './rows'

export enum EAccountAction {
  SignOut = 'sign-out',
  DownloadPurge = 'download-purge',
}

export const DOWNLOAD_PURGE_LABEL = 'Download & purge cloud data'

function WrappedLine(props: { cells: number; text: string; fg: string }): React.ReactNode {
  return (
    <>
      {wrapCells({ text: props.text, cells: props.cells }).map((line, index) => (
        <SettingsLine key={`${index}-${line}`}>
          <text>
            <Spans spans={clipSpans({ spans: [{ text: line, fg: props.fg }], cells: props.cells })} />
          </text>
        </SettingsLine>
      ))}
    </>
  )
}

export function SettingsAccount(props: {
  cells: number
  email: string | null
  signedIn: boolean
  action: EAccountAction
  onSignOut: () => void
  onDownloadPurge: () => void
  cloudSignIn: SettingsLoginState
  onSignIn: () => void
  onOpenSignInUrl: () => void
}): React.ReactNode {
  const signOut = useClickRegion(props.signedIn ? props.onSignOut : undefined)
  const purge = useClickRegion(props.signedIn ? props.onDownloadPurge : undefined)

  const whom: Span = props.signedIn
    ? { text: props.email ?? 'signed in', fg: theme.hover }
    : { text: 'not signed in', fg: theme.hint }

  return (
    <box flexDirection="column" flexShrink={0}>
      <SettingsGroupHeader label="Atlas Cloud" />
      <SettingsTextLine label="Signed in as" value={[whom]} cells={props.cells} />
      {props.signedIn ? (
        <>
          <SettingsTextLine
            label="Sign out"
            value={[{ text: '⏎', fg: theme.hint }]}
            cells={props.cells}
            selected={props.action === EAccountAction.SignOut}
            {...(signOut.wash.bg === undefined ? {} : { band: signOut.wash.bg })}
            press={signOut.handlers}
          />
          <SettingsTextLine
            label={DOWNLOAD_PURGE_LABEL}
            value={[{ text: '⏎', fg: theme.hint }]}
            cells={props.cells}
            selected={props.action === EAccountAction.DownloadPurge}
            {...(purge.wash.bg === undefined ? {} : { band: purge.wash.bg })}
            press={purge.handlers}
          />
        </>
      ) : (
        <>
          <CloudSignInRow
            cells={props.cells}
            status={props.cloudSignIn.status}
            onSignIn={props.onSignIn}
          />
          <CloudSignInPrompt
            cells={props.cells}
            state={props.cloudSignIn}
            onOpenUrl={props.onOpenSignInUrl}
          />
        </>
      )}
      {props.cloudSignIn.failure === null ? null : (
        <WrappedLine cells={props.cells} text={props.cloudSignIn.failure} fg={theme.warn} />
      )}
      {props.cloudSignIn.notice === null ? null : (
        <WrappedLine cells={props.cells} text={props.cloudSignIn.notice} fg={theme.hint} />
      )}
    </box>
  )
}
