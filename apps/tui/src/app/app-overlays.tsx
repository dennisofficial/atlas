import React from 'react'

import { Onboarding } from '../ui/components/onboarding'
import { AccountsScreen } from './accounts-screen'
import type { EPanel } from './app-screen'
import { SettingsScreen } from './settings-screen'
import type { AccountsControl } from './use-accounts'
import type { OnboardingControl } from './use-onboarding'
import type { SettingsDrawer } from './use-settings'

export function OverlaysScreen(props: {
  width: number
  cwd: string
  sidebarWidth: number
  drawer: SettingsDrawer
  accounts: AccountsControl
  onboarding: OnboardingControl
  shown: EPanel | null
}): React.ReactNode {
  const drawerOpen = props.drawer.state !== null

  return (
    <>
      <AccountsScreen {...props.accounts} width={props.width} />
      {props.onboarding.visible && props.shown === null && !drawerOpen ? (
        <Onboarding
          width={props.width}
          rows={props.onboarding.rows}
          rowIndex={props.onboarding.rowIndex}
          onActivate={props.onboarding.handleActivate}
          onDismiss={props.onboarding.handleDismiss}
        />
      ) : null}
      <SettingsScreen
        drawer={props.drawer}
        width={props.width}
        sidebarWidth={props.sidebarWidth}
        cwd={props.cwd}
      />
    </>
  )
}
