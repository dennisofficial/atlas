import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { cellsOf } from '../../hint-layout'
import type { SettingsLoginState } from '../../settings-login-model'
import { glyph, theme } from '../../theme'
import { clipSpans, wrapCells } from '../sidebar/cells'
import { Spans, type Span } from '../spans'
import { CloudSignInPrompt, CloudSignInRow } from './cloud-sign-in'
import { GithubRow, type GithubAccountView } from './github-connect'
import { SettingsGroupHeader, SettingsLine, SettingsTextLine } from './rows'

export enum ECloudAction {
  SignOut = 'sign-out',
  Upload = 'upload',
  Download = 'download',
  Github = 'github',
}

export const UPLOAD_LABEL = 'Upload local accounts & secrets to cloud'
export const DOWNLOAD_LABEL = 'Download cloud accounts & secrets to this machine'

export type CloudSyncState = {
  running: boolean
  notice: string | null
  failure: string | null
}

export const idleSync = (): CloudSyncState => ({ running: false, notice: null, failure: null })

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

function ActionRow(props: {
  cells: number
  label: string
  selected: boolean
  onPress: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onPress)

  const mark: Span = props.selected
    ? { text: `${glyph.selected} `, fg: theme.accent }
    : { text: '  ' }
  const affordance: Span = { text: '⏎', fg: theme.hint }
  const gap = Math.max(
    1,
    props.cells - cellsOf(mark.text) - cellsOf(props.label) - cellsOf(affordance.text),
  )
  const spans: Span[] = [
    mark,
    { text: props.label, fg: props.selected ? theme.bright : theme.hover },
    { text: ' '.repeat(gap) },
    affordance,
  ]
  const band = region.wash.bg ?? (props.selected ? theme.hoverBg : undefined)

  return (
    <SettingsLine {...(band === undefined ? {} : { band })} press={region.handlers}>
      <text>
        <Spans spans={clipSpans({ spans, cells: props.cells })} />
      </text>
    </SettingsLine>
  )
}

function SyncFeedback(props: {
  cells: number
  state: CloudSyncState
  runningLabel: string
}): React.ReactNode {
  if (props.state.running) {
    return <WrappedLine cells={props.cells} text={props.runningLabel} fg={theme.hint} />
  }
  if (props.state.failure !== null) {
    return <WrappedLine cells={props.cells} text={props.state.failure} fg={theme.warn} />
  }
  if (props.state.notice !== null) {
    return <WrappedLine cells={props.cells} text={props.state.notice} fg={theme.hint} />
  }
  return null
}

export function SettingsCloud(props: {
  cells: number
  email: string | null
  signedIn: boolean
  action: ECloudAction | null
  onSignOut: () => void
  onUpload: () => void
  onDownload: () => void
  upload: CloudSyncState
  download: CloudSyncState
  cloudSignIn: SettingsLoginState
  onSignIn: () => void
  onOpenSignInUrl: () => void
  github?: GithubAccountView | undefined
}): React.ReactNode {
  const whom: Span = props.signedIn
    ? { text: props.email ?? 'signed in', fg: theme.hover }
    : { text: 'not signed in', fg: theme.hint }

  return (
    <box flexDirection="column" flexShrink={0}>
      <SettingsGroupHeader label="Atlas Cloud" />
      <SettingsTextLine label="Signed in as" value={[whom]} cells={props.cells} />
      {props.signedIn ? (
        <>
          <ActionRow
            cells={props.cells}
            label="Sign out"
            selected={props.action === ECloudAction.SignOut}
            onPress={props.onSignOut}
          />
          <ActionRow
            cells={props.cells}
            label={UPLOAD_LABEL}
            selected={props.action === ECloudAction.Upload}
            onPress={props.onUpload}
          />
          <SyncFeedback cells={props.cells} state={props.upload} runningLabel="uploading…" />
          <ActionRow
            cells={props.cells}
            label={DOWNLOAD_LABEL}
            selected={props.action === ECloudAction.Download}
            onPress={props.onDownload}
          />
          <SyncFeedback cells={props.cells} state={props.download} runningLabel="downloading…" />
          {props.github === undefined ? null : (
            <>
              <GithubRow
                cells={props.cells}
                signedIn={props.signedIn}
                selected={props.action === ECloudAction.Github}
                view={props.github}
              />
              <CloudSignInPrompt
                cells={props.cells}
                state={props.github.flow}
                onOpenUrl={props.github.onOpenUrl}
              />
              {props.github.flow.failure === null ? null : (
                <WrappedLine cells={props.cells} text={props.github.flow.failure} fg={theme.warn} />
              )}
              {props.github.flow.notice === null ? null : (
                <WrappedLine cells={props.cells} text={props.github.flow.notice} fg={theme.hint} />
              )}
            </>
          )}
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
