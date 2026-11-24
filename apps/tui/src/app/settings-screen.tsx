import React from 'react'

import { idleSync } from '../ui/components/settings/cloud'
import { Settings } from '../ui/components/settings'
import { idleLogin } from '../ui/settings-login-model'
import type { SettingsDrawer } from './use-settings'

const noop = (): void => undefined

export function SettingsScreen(props: {
  drawer: SettingsDrawer
  width: number
  sidebarWidth: number
  cwd: string
}): React.ReactNode {
  const { drawer } = props
  if (drawer.state === null) return null

  return (
    <Settings
      width={props.width}
      sidebarWidth={props.sidebarWidth}
      model={drawer.view}
      state={drawer.state}
      resolution={drawer.resolution}
      cwd={props.cwd}
      origin={drawer.origin}
      appearance={drawer.appearance}
      prompt={drawer.secret.prompt}
      textPrompt={drawer.text.prompt}
      secretOf={drawer.secret.displayOf}
      secretOrigin={drawer.secretOrigin}
      problem={drawer.problem}
      cloudEmail={drawer.cloudEmail}
      cloudSignedIn
      cloudSignIn={idleLogin()}
      cloudAction={drawer.cloud.action}
      cloudUpload={idleSync()}
      cloudDownload={idleSync()}
      github={drawer.github}
      signingKey={drawer.signingKey}
      onSignOut={drawer.signOut}
      onSignIn={noop}
      onOpenSignInUrl={noop}
      onUpload={noop}
      onDownload={noop}
      onSelect={drawer.select}
      onDismiss={drawer.close}
    />
  )
}
