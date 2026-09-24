import {
  ESettingPage,
  type SecretPrompt as SecretPromptState,
  type TextPrompt as TextPromptState,
} from '@dltech/atlas-core'
import type { ScrollBoxRenderable } from '@opentui/core'
import React, { useEffect, useRef } from 'react'

import { fitHints, hintSpans, type Hint } from '../hint-layout'
import { useClickRegion } from '../hooks/use-click-region'
import { currentPage, type SettingsModel, type SettingsState } from '../settings-model'
import { ESettingsLogin, type SettingsLoginState } from '../settings-login-model'
import { theme } from '../theme'
import type { Appearance } from '../appearance'
import { ECloudAction, SettingsCloud, type CloudSyncState } from './settings/cloud'
import { type GithubAccountView } from './settings/github-connect'
import { SettingsBand } from './settings/band'
import { SettingsDetail } from './settings/detail'
import { SettingsHead } from './settings/head'
import { SecretPrompt } from './settings/secret-prompt'
import { TextSettingPrompt } from './settings/text-prompt'
import { SelectableSettingLine, SettingsGroupHeader, SettingsLine, SETTINGS_PAD } from './settings/rows'
import { clipSpans } from './sidebar/cells'
import { Spans, type Span } from './spans'

export const SETTINGS_ROWS_MIN_CELLS = 60

const HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'row' },
  { key: '⏎', label: 'set' },
  { key: '⇥', label: 'tab' },
  { key: 'esc', label: 'back' },
]

const CLOUD_HINTS_SIGNED_IN: readonly Hint[] = [
  { key: '↑↓', label: 'row' },
  { key: '⏎', label: 'choose' },
  { key: '⇥', label: 'tab' },
  { key: 'esc', label: 'back' },
]

const CLOUD_HINTS_SIGNED_OUT_IDLE: readonly Hint[] = [
  { key: '⏎', label: 'sign in' },
  { key: '⇥', label: 'tab' },
  { key: 'esc', label: 'back' },
]

const CLOUD_HINTS_SIGNED_OUT_PENDING: readonly Hint[] = [
  { key: '⇥', label: 'tab' },
  { key: 'esc', label: 'back' },
]

const GAP_CELLS = 1

const settingsCells = (args: { width: number }): number =>
  Math.max(0, args.width - SETTINGS_PAD * 2)

export const settingsDetailVisible = (args: { width: number; sidebarWidth: number }): boolean =>
  args.width - args.sidebarWidth >= SETTINGS_ROWS_MIN_CELLS

function FooterLine(props: {
  cells: number
  hints: readonly Hint[]
  status: string
  failing: boolean
  onDismiss: () => void
}): React.ReactNode {
  const region = useClickRegion(props.onDismiss)
  const hints = hintSpans({
    hints: fitHints({ hints: props.hints, cells: props.cells }),
    keyColour: theme.meta,
  })
  const width = hints.reduce((total, span) => total + [...span.text].length, 0)
  const status: Span = {
    text: props.status,
    fg: props.failing ? theme.error : theme.meta,
  }
  const gap = Math.max(GAP_CELLS, props.cells - [...props.status].length - width)

  return (
    <SettingsLine
      {...(region.wash.bg === undefined ? {} : { band: region.wash.bg })}
      press={region.handlers}
    >
      <text>
        <Spans
          spans={clipSpans({ spans: [status, { text: ' '.repeat(gap) }, ...hints], cells: props.cells })}
        />
      </text>
    </SettingsLine>
  )
}

export function Settings(props: {
  width: number
  sidebarWidth: number
  model: SettingsModel
  state: SettingsState
  cwd: string
  origin: string
  appearance: Appearance
  prompt: SecretPromptState | null
  textPrompt: TextPromptState | null
  secretOf: (id: string) => Span | undefined
  secretOrigin: string
  problem?: string | undefined
  cloudEmail: string | null
  cloudSignedIn: boolean
  cloudSignIn: SettingsLoginState
  cloudAction: ECloudAction | null
  cloudUpload: CloudSyncState
  cloudDownload: CloudSyncState
  github?: GithubAccountView | undefined
  onSignOut: () => void
  onSignIn: () => void
  onOpenSignInUrl: () => void
  onUpload: () => void
  onDownload: () => void
  onSelect: (target: SettingsState) => void
  onDismiss: () => void
}): React.ReactNode {
  const detail = settingsDetailVisible({ width: props.width, sidebarWidth: props.sidebarWidth })
  const columnWidth = props.width - (detail ? props.sidebarWidth : 0)
  const cells = settingsCells({ width: columnWidth })
  const page = currentPage({ state: props.state, model: props.model })
  const onCloudPage = page?.page.id === ESettingPage.Cloud
  const rowsActive = !onCloudPage || (props.cloudSignedIn && props.cloudAction === null)
  const selected = rowsActive ? page?.rows[props.state.rowIndex] : undefined

  const status =
    props.problem ??
    (onCloudPage
      ? 'providers and api keys live in the accounts overlay — ctrl+a'
      : props.prompt === null
        ? `edits write to ${props.origin}`
        : `sealed into ${props.secretOrigin}, never into ${props.origin}`)

  const hints = onCloudPage
    ? props.cloudSignedIn
      ? CLOUD_HINTS_SIGNED_IN
      : props.cloudSignIn.status === ESettingsLogin.Idle
        ? CLOUD_HINTS_SIGNED_OUT_IDLE
        : CLOUD_HINTS_SIGNED_OUT_PENDING
    : HINTS

  const scroller = useRef<ScrollBoxRenderable | null>(null)
  const selectedId = selected?.definition.id
  useEffect(() => {
    if (selectedId === undefined) return
    scroller.current?.scrollChildIntoView(`setting-${selectedId}`)
  }, [selectedId])

  return (
    <box
      flexDirection="column"
      backgroundColor={theme.appBg}
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      zIndex={30}
    >
      <SettingsHead
        cells={settingsCells({ width: props.width })}
        pages={props.model.pages.map((held) => held.page)}
        pageIndex={props.state.pageIndex}
        origin={props.origin}
      />
      <box flexDirection="row" flexGrow={1} flexShrink={1} flexBasis={0}>
        <box
          flexDirection="column"
          width={columnWidth}
          flexGrow={1}
          flexShrink={1}
          flexBasis={0}
          paddingTop={1}
        >
          <scrollbox ref={scroller} flexGrow={1} flexShrink={1} flexBasis={0}>
            <box flexDirection="column" flexShrink={0} gap={1}>
              {onCloudPage ? (
                <SettingsCloud
                  cells={cells}
                  email={props.cloudEmail}
                  signedIn={props.cloudSignedIn}
                  action={props.cloudAction}
                  onSignOut={props.onSignOut}
                  onUpload={props.onUpload}
                  onDownload={props.onDownload}
                  upload={props.cloudUpload}
                  download={props.cloudDownload}
                  cloudSignIn={props.cloudSignIn}
                  onSignIn={props.onSignIn}
                  onOpenSignInUrl={props.onOpenSignInUrl}
                  {...(props.github === undefined ? {} : { github: props.github })}
                />
              ) : null}
              {onCloudPage && !props.cloudSignedIn ? null : page?.groups.map((group) => (
                <box key={group.label} flexDirection="column" flexShrink={0}>
                  <SettingsGroupHeader label={group.label} />
                  {group.rows.map((row) => (
                    <SelectableSettingLine
                      key={row.definition.id}
                      setting={row}
                      cells={cells}
                      override={props.secretOf(row.definition.id)}
                      selected={row.definition.id === selected?.definition.id}
                      onSelect={() =>
                        props.onSelect({
                          pageIndex: props.state.pageIndex,
                          rowIndex: page.rows.indexOf(row),
                        })
                      }
                    />
                  ))}
                </box>
              ))}
            </box>
          </scrollbox>
          {props.prompt !== null ? (
            <SecretPrompt prompt={props.prompt} cells={cells} />
          ) : props.textPrompt !== null ? (
            <TextSettingPrompt prompt={props.textPrompt} cells={cells} />
          ) : (
            <SettingsBand
              width={columnWidth}
              setting={selected}
              appearance={props.appearance}
            />
          )}
          <FooterLine
            cells={cells}
            hints={hints}
            status={status}
            failing={props.problem !== undefined}
            onDismiss={props.onDismiss}
          />
        </box>
        {detail ? (
          <SettingsDetail width={props.sidebarWidth} setting={selected} cwd={props.cwd} />
        ) : null}
      </box>
    </box>
  )
}
