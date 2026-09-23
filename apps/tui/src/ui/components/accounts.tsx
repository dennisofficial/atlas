import React from 'react'

import { EAccountStatus, providerSpec, type Account } from '@dltech/atlas-core'

import { accountDetail, signedOutDetail } from '../accounts-labels'
import {
  activeOf,
  EAccountsView,
  isPrompting,
  othersOf,
  selectedRow,
  type AccountsState,
  type ProviderRow,
} from '../accounts-model'
import { type Hint } from '../hint-layout'
import { usePress } from '../hooks/use-press'
import { glyph, theme } from '../theme'
import { clipSpans } from './sidebar/cells'
import { ActionsModal, LoginPickerModal } from './accounts-modal'
import { AccountsPrompt, Wrapped } from './accounts-prompt'
import {
  BottomDrawer,
  drawerCells,
  DrawerGap,
  DrawerHints,
  DRAWER_INSET,
  DRAWER_PAD,
} from './drawer'
import { Spans, type Span } from './spans'

export const ACCOUNTS_INSET = DRAWER_INSET

export const accountsCells = (args: { width: number }): number => drawerCells(args)

export const ACCOUNTS_HEADING = 'Model providers'

const LIST_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'actions' },
  { key: 'esc', label: 'close' },
]

const MODAL_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'choose' },
  { key: 'esc', label: 'back' },
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

const LIST_WIDTH = 28

const panelCells = (args: { cells: number }): number =>
  Math.max(20, args.cells - DRAWER_PAD * 2 - 1 - LIST_WIDTH - 4)

function LoginLine(props: {
  account: Account
  active: boolean
  cells: number
  meters?: ((account: Account) => readonly Span[]) | undefined
}): React.ReactNode {
  const detail = accountDetail(props.account)
  const expired = props.account.status !== EAccountStatus.Active
  const meters = props.meters === undefined ? [] : props.meters(props.account)

  return (
    <>
      <text>
        <Spans
          spans={clipSpans({
            spans: [
              {
                text: `${props.active ? glyph.active : glyph.available} `,
                fg: props.active ? theme.accent : expired ? theme.dim : theme.hint,
              },
              { text: props.account.label, fg: expired ? theme.dim : theme.hover },
              ...(detail.length === 0 ? [] : [{ text: ` · ${detail}`, fg: theme.hint }]),
            ],
            cells: props.cells,
          })}
        />
      </text>
      {meters.length === 0 ? null : (
        <text>
          <Spans spans={clipSpans({ spans: [{ text: '  ' }, ...meters], cells: props.cells })} />
        </text>
      )}
    </>
  )
}

function DetailPanel(props: {
  row: ProviderRow
  cells: number
  meters?: ((account: Account) => readonly Span[]) | undefined
}): React.ReactNode {
  const active = activeOf(props.row)
  const others = othersOf(props.row)

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={theme.rule}
      backgroundColor={theme.panelBg}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.bright}>{providerSpec(props.row.provider).label}</text>
        <text fg={active === undefined ? theme.dim : theme.ok}>
          {active === undefined ? '○ not signed in' : '● connected'}
        </text>
      </box>
      {active === undefined ? (
        <>
          <box height={1} />
          <text fg={theme.hint}>{signedOutDetail(props.row.provider)}</text>
        </>
      ) : (
        <>
          <box height={1} />
          <text fg={theme.meta}>{'ACTIVE LOGIN'}</text>
          <LoginLine
            account={active}
            active
            cells={props.cells}
            {...(props.meters === undefined ? {} : { meters: props.meters })}
          />
        </>
      )}
      {others.length === 0 ? null : (
        <>
          <box height={1} />
          <text fg={theme.meta}>{'OTHER LOGINS'}</text>
          {others.map((account) => (
            <LoginLine key={account.id} account={account} active={false} cells={props.cells} />
          ))}
        </>
      )}
      <box height={1} />
      <text fg={theme.meta}>{'⏎ actions'}</text>
    </box>
  )
}

function ProviderList(props: {
  state: AccountsState
  onPick: (row: ProviderRow) => void
}): React.ReactNode {
  const press = usePress()

  return (
    <box flexDirection="column" width={LIST_WIDTH} flexShrink={0}>
      {props.state.rows.map((row, i) => {
        const connected = activeOf(row) !== undefined
        const selected = i === props.state.index
        return (
          <box
            key={row.provider}
            height={1}
            paddingLeft={1}
            {...(selected ? { backgroundColor: theme.selectedBg } : {})}
            {...press(() => props.onPick(row))}
          >
            <text>
              <span fg={connected ? theme.ok : theme.dim}>{connected ? '● ' : '○ '}</span>
              <span fg={selected ? theme.bright : theme.body}>
                {providerSpec(row.provider).label}
              </span>
            </text>
          </box>
        )
      })}
    </box>
  )
}

export function Accounts(props: {
  meters?: (account: Account) => readonly Span[]
  width: number
  state: AccountsState
  overlay?: boolean
  onPick: (row: ProviderRow) => void
  onChooseAction: (actionIndex: number) => void
  onChooseLogin: (accountIndex: number) => void
  onDismiss: () => void
  onOpenUrl: () => void
}): React.ReactNode {
  const cells = accountsCells({ width: props.width })
  const prompting = isPrompting(props.state)
  const row = selectedRow(props.state)

  const hints = prompting
    ? props.state.view === EAccountsView.DeviceCode
      ? DEVICE_HINTS
      : PROMPT_HINTS
    : props.state.view === EAccountsView.List
      ? LIST_HINTS
      : MODAL_HINTS

  return (
    <BottomDrawer
      overlay={props.overlay === true}
      footer={
        <>
          <DrawerGap />
          <DrawerHints hints={hints} cells={cells} onDismiss={props.onDismiss} />
        </>
      }
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={DRAWER_PAD}
        paddingRight={DRAWER_PAD}
      >
        <text fg={theme.meta}>{ACCOUNTS_HEADING.toUpperCase()}</text>
      </box>
      <DrawerGap />
      {prompting ? (
        <AccountsPrompt state={props.state} cells={cells} onOpenUrl={props.onOpenUrl} />
      ) : (
        <box flexDirection="row" paddingLeft={DRAWER_PAD} paddingRight={DRAWER_PAD} gap={1}>
          <ProviderList state={props.state} onPick={props.onPick} />
          {row === undefined ? null : (
            <DetailPanel
              row={row}
              cells={panelCells({ cells })}
              {...(props.meters === undefined ? {} : { meters: props.meters })}
            />
          )}
        </box>
      )}
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
      {props.state.view === EAccountsView.Actions && row !== undefined ? (
        <ActionsModal row={row} state={props.state} onChoose={props.onChooseAction} />
      ) : null}
      {props.state.view === EAccountsView.SwitchLogin && row !== undefined ? (
        <LoginPickerModal row={row} state={props.state} onChoose={props.onChooseLogin} />
      ) : null}
    </BottomDrawer>
  )
}
