import React from 'react'

import type { DeviceSignInControl } from './account/use-device-sign-in'
import { EScreen, type ScreenState } from './app-screen'
import { AwaitingAccessScreen } from './awaiting-access-screen'
import { SignInScreen } from './sign-in-screen'

export function AccessScreen(props: {
  screen: ScreenState
  width: number
  signIn: DeviceSignInControl
  openUrl: (url: string) => void
  onSignOut: () => void
}): React.ReactNode {
  if (props.screen.screen === EScreen.SignIn) {
    return (
      <SignInScreen
        width={props.width}
        state={props.signIn.state}
        reason={props.screen.reason}
        onSignIn={props.signIn.begin}
        onOpenUrl={props.openUrl}
      />
    )
  }

  if (props.screen.screen === EScreen.AwaitingAccess) {
    return (
      <AwaitingAccessScreen
        width={props.width}
        email={props.screen.email}
        onSignOut={props.onSignOut}
      />
    )
  }

  return null
}
