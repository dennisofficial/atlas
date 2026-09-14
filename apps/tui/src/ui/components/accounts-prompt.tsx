import React from 'react'

import { providerSpec } from '@dltech/atlas-core'

import { maskedKey } from '../accounts-labels'
import { EAccountsView, type AccountsState } from '../accounts-model'
import { type PressHandlers, usePress } from '../hooks/use-press'
import { glyph, theme } from '../theme'
import { clipSpans } from './sidebar/cells'
import { DrawerHeading, DrawerLine } from './drawer'
import { Spans, type Span } from './spans'

export const OPEN_URL_HINT =
  'Opened in your browser. Approve, then paste the code. Click to reopen:'

export function TextLine(props: {
  spans: readonly Span[]
  cells: number
  press?: PressHandlers
}): React.ReactNode {
  return (
    <DrawerLine {...(props.press === undefined ? {} : { press: props.press })}>
      <text>
        <Spans spans={clipSpans({ spans: props.spans, cells: props.cells })} />
      </text>
    </DrawerLine>
  )
}

function wrap(args: { text: string; cells: number }): readonly string[] {
  if (args.cells <= 0) return [args.text]

  return args.text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let rest = paragraph

    while (rest.length > args.cells) {
      const broke = rest.lastIndexOf(' ', args.cells)
      const at = broke > 0 ? broke : args.cells
      lines.push(rest.slice(0, at))
      rest = rest.slice(broke > 0 ? at + 1 : at)
    }
    lines.push(rest)

    return lines
  })
}

export function Wrapped(props: {
  text: string
  cells: number
  fg: string
  press?: PressHandlers
}): React.ReactNode {
  const lines = wrap({ text: props.text, cells: props.cells })

  return (
    <>
      {lines.map((line, index) => (
        <DrawerLine
          key={`${index}-${line}`}
          {...(props.press === undefined ? {} : { press: props.press })}
        >
          <text fg={props.fg}>{line}</text>
        </DrawerLine>
      ))}
    </>
  )
}

function DevicePrompt(props: {
  url: string
  userCode: string
  cells: number
  onOpenUrl: () => void
}): React.ReactNode {
  const press = usePress()

  return (
    <>
      <TextLine
        spans={[
          { text: 'Enter this code to sign in: ', fg: theme.hint },
          { text: props.userCode, fg: theme.bright },
        ]}
        cells={props.cells}
      />
      <Wrapped
        text={props.url}
        cells={props.cells}
        fg={theme.court.external}
        press={press(props.onOpenUrl)}
      />
      <TextLine spans={[{ text: 'waiting for approval…', fg: theme.hint }]} cells={props.cells} />
    </>
  )
}

export function AccountsPrompt(props: {
  state: AccountsState
  cells: number
  onOpenUrl: () => void
}): React.ReactNode {
  const { state } = props
  const press = usePress()
  const provider = state.prompt === null ? null : providerSpec(state.prompt.provider).label
  const typing = state.view === EAccountsView.ApiKey ? maskedKey(state.typed) : state.typed
  const takesInput =
    state.view !== EAccountsView.DeviceCode &&
    state.view !== EAccountsView.CloudDevice &&
    state.view !== EAccountsView.GithubDevice

  return (
    <box flexDirection="column" flexShrink={0}>
      <DrawerHeading
        label={state.view === EAccountsView.ApiKey ? 'Paste the api key' : 'Sign in'}
      />
      {state.view === EAccountsView.ApiKey ? (
        <TextLine
          spans={[{ text: `Paste a ${provider ?? ''} api key and press enter.`, fg: theme.hint }]}
          cells={props.cells}
        />
      ) : state.view === EAccountsView.DeviceCode ? (
        state.prompt?.userCode === undefined || state.prompt.userCode.length === 0 ? (
          <TextLine
            spans={[{ text: 'Asking OpenAI for a code…', fg: theme.hint }]}
            cells={props.cells}
          />
        ) : (
          <DevicePrompt
            url={state.prompt.url}
            userCode={state.prompt.userCode}
            cells={props.cells}
            onOpenUrl={props.onOpenUrl}
          />
        )
      ) : state.view === EAccountsView.CloudDevice ? (
        state.cloudPrompt === null ? (
          <TextLine
            spans={[{ text: 'Asking Atlas Cloud for a code…', fg: theme.hint }]}
            cells={props.cells}
          />
        ) : (
          <DevicePrompt
            url={state.cloudPrompt.url}
            userCode={state.cloudPrompt.userCode}
            cells={props.cells}
            onOpenUrl={props.onOpenUrl}
          />
        )
      ) : state.view === EAccountsView.GithubDevice ? (
        state.githubPrompt === null ? (
          <TextLine
            spans={[{ text: 'Asking GitHub for a code…', fg: theme.hint }]}
            cells={props.cells}
          />
        ) : (
          <DevicePrompt
            url={state.githubPrompt.url}
            userCode={state.githubPrompt.userCode}
            cells={props.cells}
            onOpenUrl={props.onOpenUrl}
          />
        )
      ) : (
        <>
          <TextLine
            spans={[{ text: OPEN_URL_HINT, fg: theme.hint }]}
            cells={props.cells}
            press={press(props.onOpenUrl)}
          />
          <Wrapped
            text={state.prompt?.url ?? ''}
            cells={props.cells}
            fg={theme.court.external}
            press={press(props.onOpenUrl)}
          />
        </>
      )}
      {takesInput ? (
        <TextLine
          spans={[
            { text: `${glyph.marker} `, fg: theme.accent },
            { text: typing.length === 0 ? 'waiting for a paste…' : typing, fg: theme.bright },
          ]}
          cells={props.cells}
        />
      ) : null}
      {state.busy ? (
        <TextLine spans={[{ text: 'working…', fg: theme.hint }]} cells={props.cells} />
      ) : null}
    </box>
  )
}
