import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { ESettingsLogin, isSettlingLogin, type SettingsLoginState } from '../../settings-login-model'
import { theme } from '../../theme'
import { clipSpans, wrapCells } from '../sidebar/cells'
import { Spans, type Span } from '../spans'
import { SettingsLine, SettingsTextLine } from './rows'

const STATUS_LABEL: Readonly<Record<ESettingsLogin, string | null>> = {
  [ESettingsLogin.Idle]: null,
  [ESettingsLogin.Asking]: 'asking Atlas Cloud for a code…',
  [ESettingsLogin.Prompting]: 'code below — waiting for approval…',
  [ESettingsLogin.Finishing]: 'signing in…',
}

export function CloudSignInRow(props: {
  cells: number
  status: ESettingsLogin
  onSignIn: () => void
}): React.ReactNode {
  const idle = props.status === ESettingsLogin.Idle
  const region = useClickRegion(idle ? props.onSignIn : undefined)

  const value: Span =
    STATUS_LABEL[props.status] === null
      ? { text: '⏎', fg: theme.hint }
      : { text: STATUS_LABEL[props.status] ?? '', fg: theme.hint }

  return (
    <SettingsTextLine
      label="Sign in"
      value={[value]}
      cells={props.cells}
      selected={idle}
      {...(region.wash.bg === undefined ? {} : { band: region.wash.bg })}
      press={region.handlers}
    />
  )
}

function CodeLine(props: { cells: number; userCode: string }): React.ReactNode {
  return (
    <SettingsLine>
      <text>
        <Spans
          spans={clipSpans({
            spans: [
              { text: 'Enter this code: ', fg: theme.hint },
              { text: props.userCode, fg: theme.bright },
            ],
            cells: props.cells,
          })}
        />
      </text>
    </SettingsLine>
  )
}

function UrlLines(props: { cells: number; url: string; onOpenUrl: () => void }): React.ReactNode {
  const region = useClickRegion(props.onOpenUrl)
  const lines = wrapCells({ text: props.url, cells: props.cells })

  return (
    <>
      {lines.map((line, index) => (
        <SettingsLine
          key={`${index}-${line}`}
          {...(region.wash.bg === undefined ? {} : { band: region.wash.bg })}
          press={region.handlers}
        >
          <text fg={theme.court.external}>{line}</text>
        </SettingsLine>
      ))}
    </>
  )
}

export function CloudSignInPrompt(props: {
  cells: number
  state: SettingsLoginState
  onOpenUrl: () => void
}): React.ReactNode {
  const { prompt } = props.state
  if (!isSettlingLogin(props.state.status) || prompt === null) return null

  return (
    <>
      <CodeLine cells={props.cells} userCode={prompt.userCode} />
      <UrlLines cells={props.cells} url={prompt.url} onOpenUrl={props.onOpenUrl} />
    </>
  )
}
