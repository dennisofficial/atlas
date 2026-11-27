import React from 'react'

import type { SignInControl } from './account/use-sign-in'
import { EScreen, type ScreenState } from './app-screen'
import { AwaitingAccessScreen } from './awaiting-access-screen'
import { SignInScreen } from './sign-in-screen'

export function AccessScreen(props: {
  screen: ScreenState
  width: number
  signIn: SignInControl
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
        onUseCode={props.signIn.switchToCode}
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
