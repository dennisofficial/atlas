import React from 'react'

import { Accounts } from '../ui/components/accounts'
import type { AccountsControl } from './use-accounts'

export function AccountsScreen(props: AccountsControl & { width: number }): React.ReactNode {
  if (props.state === null) return null

  return (
    <Accounts
      width={props.width}
      state={props.state}
      overlay
      onPick={props.handlePick}
      onChooseAction={props.handleChooseAction}
      onChooseLogin={props.handleChooseLogin}
      onDismiss={props.handleDismiss}
      onOpenUrl={props.handleOpenUrl}
    />
  )
}
