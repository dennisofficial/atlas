import React from 'react'

import { EAccountStatus, providerSpec } from '@dltech/atlas-core'

import { actionLabel, accountDetail } from '../accounts-labels'
import {
  EPickIntent,
  providerActions,
  type AccountsState,
  type ProviderRow,
} from '../accounts-model'
import { usePress } from '../hooks/use-press'
import { theme } from '../theme'

const MODAL_Z = 50

function ModalFrame(props: { title: string; children: React.ReactNode }): React.ReactNode {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      alignItems="center"
      justifyContent="center"
      zIndex={MODAL_Z}
    >
      <box
        flexDirection="column"
        width={52}
        border
        borderStyle="rounded"
        borderColor={theme.accent}
        backgroundColor={theme.overlayBg}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={theme.bright}>{props.title}</text>
        <box height={1} />
        {props.children}
        <box height={1} />
        <text fg={theme.meta}>{'↑↓ pick · ⏎ choose · esc back'}</text>
      </box>
    </box>
  )
}

export function ActionsModal(props: {
  row: ProviderRow
  state: AccountsState
  onChoose: (actionIndex: number) => void
}): React.ReactNode {
  const press = usePress()
  const actions = providerActions(props.row)

  return (
    <ModalFrame title={providerTitle(props.row)}>
      {actions.map((action, i) => (
        <box
          key={action}
          height={1}
          {...(i === props.state.action ? { backgroundColor: theme.selectedBg } : {})}
          {...press(() => props.onChoose(i))}
        >
          <text fg={i === props.state.action ? theme.accent : theme.body}>
            {`${i === props.state.action ? '▸ ' : '  '}${actionLabel(action)}`}
          </text>
        </box>
      ))}
    </ModalFrame>
  )
}

export function LoginPickerModal(props: {
  row: ProviderRow
  state: AccountsState
  onChoose: (accountIndex: number) => void
}): React.ReactNode {
  const press = usePress()
  const title =
    props.state.pickIntent === EPickIntent.Use
      ? `${providerTitle(props.row)} — switch active login`
      : `${providerTitle(props.row)} — remove a login`

  return (
    <ModalFrame title={title}>
      {props.row.accounts.map((account, i) => {
        const expired = account.status !== EAccountStatus.Active
        const detail = accountDetail(account)
        return (
          <box
            key={account.id}
            height={1}
            {...(i === props.state.pick ? { backgroundColor: theme.selectedBg } : {})}
            {...press(() => props.onChoose(i))}
          >
            <text>
              <span fg={i === props.state.pick ? theme.accent : theme.body}>
                {i === props.state.pick ? '▸ ' : '  '}
              </span>
              <span fg={expired ? theme.dim : theme.hover}>{account.label}</span>
              {detail.length === 0 ? null : <span fg={theme.hint}>{` · ${detail}`}</span>}
            </text>
          </box>
        )
      })}
    </ModalFrame>
  )
}

const providerTitle = (row: ProviderRow): string => providerSpec(row.provider).label
