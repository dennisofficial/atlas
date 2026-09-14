import React from 'react'

import {
  ACCOUNT_ROWS,
  accountsWindow,
  EAccountsView,
  rowKey,
  type AccountRow,
  type AccountsState,
} from '../accounts-model'
import { rowDetail, rowLabel } from '../accounts-labels'
import { type Hint } from '../hint-layout'
import { type PressHandlers, usePress } from '../hooks/use-press'
import { glyph, theme } from '../theme'
import { clipSpans } from './sidebar/cells'
import { AccountsPrompt, TextLine, Wrapped } from './accounts-prompt'
import {
  BottomDrawer,
  drawerCells,
  DrawerGap,
  DrawerHeading,
  DrawerHints,
  DrawerLine,
  DRAWER_INSET,
} from './drawer'
import { Spans, type Span } from './spans'

export const ACCOUNTS_INSET = DRAWER_INSET

export const accountsCells = (args: { width: number }): number => drawerCells(args)

export const ACCOUNTS_HEADING = 'Accounts'

export const NO_ACCOUNTS = 'No accounts yet. Sign in to start a turn.'

const LIST_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'use' },
  { key: 'n', label: 'sign in' },
  { key: 'k', label: 'api key' },
  { key: 'x', label: 'remove' },
  { key: 'esc', label: 'close' },
]

const PROMPT_HINTS: readonly Hint[] = [
  { key: '⏎', label: 'submit' },
  { key: 'click', label: 'reopen url' },
  { key: 'esc', label: 'cancel' },
]

const DEVICE_HINTS: readonly Hint[] = [
  { key: 'click', label: 'reopen url' },
  { key: 'esc', label: 'cancel' },
]

const showsDeviceHints = (view: EAccountsView): boolean =>
  view === EAccountsView.DeviceCode || view === EAccountsView.CloudDevice

function AccountLine(props: {
  row: AccountRow
  cells: number
  selected: boolean
  meters: readonly Span[]
  press: PressHandlers
}): React.ReactNode {
  const band = props.selected ? { band: theme.hoverBg } : {}

  return (
    <>
      <DrawerLine {...band} press={props.press}>
        <text>
          <Spans
            spans={clipSpans({
              spans: [
                {
                  text: `${props.row.active ? glyph.active : glyph.available} `,
                  fg: props.row.active ? theme.accent : theme.hint,
                },
                {
                  text: rowLabel(props.row),
                  fg: props.selected ? theme.bright : theme.hover,
                },
              ],
              cells: props.cells,
            })}
          />
        </text>
      </DrawerLine>
      <DrawerLine {...band} press={props.press}>
        <text>
          <Spans
            spans={clipSpans({
              spans: [{ text: `  ${rowDetail(props.row)}`, fg: theme.hint }],
              cells: props.cells,
            })}
          />
        </text>
      </DrawerLine>
      {props.meters.length === 0 ? null : (
        <DrawerLine {...band} press={props.press}>
          <text>
            <Spans
              spans={clipSpans({
                spans: [{ text: '  ', fg: theme.hint }, ...props.meters],
                cells: props.cells,
              })}
            />
          </text>
        </DrawerLine>
      )}
    </>
  )
}

export function Accounts(props: {
  meters?: (row: AccountRow) => readonly Span[]
  width: number
  state: AccountsState
  overlay?: boolean
  onPick: (row: AccountRow) => void
  onDismiss: () => void
  onOpenUrl: () => void
}): React.ReactNode {
  const cells = accountsCells({ width: props.width })
  const press = usePress()
  const prompting = props.state.view !== EAccountsView.List

  const { start, visible, below } = accountsWindow({ state: props.state, rows: ACCOUNT_ROWS })

  return (
    <BottomDrawer
      overlay={props.overlay === true}
      footer={
        <>
          <DrawerGap />
          <DrawerHints
            hints={
              prompting
                ? showsDeviceHints(props.state.view)
                  ? DEVICE_HINTS
                  : PROMPT_HINTS
                : LIST_HINTS
            }
            cells={cells}
            onDismiss={props.onDismiss}
          />
        </>
      }
    >
      <box flexDirection="column" flexShrink={0}>
        <DrawerHeading label={ACCOUNTS_HEADING} />
        {props.state.rows.length === 0 ? (
          <TextLine spans={[{ text: NO_ACCOUNTS, fg: theme.hint }]} cells={cells} />
        ) : (
          <>
            {start === 0 ? null : (
              <TextLine spans={[{ text: `  ${start} more above`, fg: theme.hint }]} cells={cells} />
            )}
            {visible.map((row, offset) => (
              <AccountLine
                key={rowKey(row)}
                row={row}
                cells={cells}
                meters={props.meters === undefined ? [] : props.meters(row)}
                selected={start + offset === props.state.index && !prompting}
                press={press(() => props.onPick(row))}
              />
            ))}
            {below === 0 ? null : (
              <TextLine spans={[{ text: `  ${below} more below`, fg: theme.hint }]} cells={cells} />
            )}
          </>
        )}
      </box>
      {prompting ? (
        <AccountsPrompt state={props.state} cells={cells} onOpenUrl={props.onOpenUrl} />
      ) : null}
      {props.state.notice === null ? null : (
        <box flexDirection="column" flexShrink={0}>
          <Wrapped text={props.state.notice} cells={cells} fg={theme.hint} />
        </box>
      )}
      {props.state.failure === null ? null : (
        <box flexDirection="column" flexShrink={0}>
          <Wrapped text={props.state.failure} cells={cells} fg={theme.warn} />
        </box>
      )}
    </BottomDrawer>
  )
}
