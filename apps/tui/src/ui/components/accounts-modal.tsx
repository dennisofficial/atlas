import React from 'react'

import { EAccountStatus, providerSpec } from '@dltech/atlas-core'

import { actionLabel, accountDetail } from '../accounts-labels'
import {
  EPickIntent,
  providerActions,
  type AccountsState,
  type ProviderRow,
} from '../accounts-model'
import { useClickRegion } from '../hooks/use-click-region'
import { usePress } from '../hooks/use-press'
import { wrapWords } from '../text-flow'
import type { PauseConfirm } from '../accounts-pause-model'
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

const CONFIRM_WIDTH = 52 - 6

function ConfirmButton(props: {
  label: string
  primary: boolean
  onPress: (() => void) | undefined
}): React.ReactNode {
  const region = useClickRegion(props.onPress)
  return (
    <text bg={region.hovered ? theme.hoverBg : theme.overlayBg} {...region.handlers}>
      <span fg={region.hovered ? theme.hover : props.primary ? theme.accent : theme.body}>
        {`${props.primary ? '▸' : ' '} ${props.label}`}
      </span>
    </text>
  )
}

export function ConfirmPauseModal(props: {
  confirm: PauseConfirm
  cells: number
  onConfirm: (() => void) | undefined
  onCancel: (() => void) | undefined
}): React.ReactNode {
  return (
    <ModalFrame title={props.confirm.title}>
      <text fg={theme.body}>
        {wrapWords({ text: props.confirm.description, width: CONFIRM_WIDTH }).join('\n')}
      </text>
      <box height={1} />
      <box flexDirection="row" gap={2}>
        <ConfirmButton label={props.confirm.confirmLabel} primary onPress={props.onConfirm} />
        <ConfirmButton label="Cancel" primary={false} onPress={props.onCancel} />
      </box>
    </ModalFrame>
  )
}
