import { DeviceConfirmScreen } from './device-confirm-screen'
import { DeviceEnterScreen } from './device-enter-screen'
import { DeviceResultScreen } from './device-result-screen'
import { ForgotScreen } from './forgot-screen'
import { InviteScreen } from './invite-screen'
import { ResetScreen } from './reset-screen'
import { SetupScreen } from './setup-screen'
import { SignInScreen } from './sign-in-screen'
import { SignUpScreen } from './sign-up-screen'
import { NewThreadView } from '../threads/new/new-thread-view'
import { AuthShell } from './auth-shells'
import { EAuthScreen, EHomeState, ESignInState, type AuthRoute, type Navigate } from './auth-route'

function ScreenView({ route, onNavigate }: { route: AuthRoute; onNavigate?: Navigate }) {
  switch (route.screen) {
    case EAuthScreen.Home:
      return (
        <SignInScreen
          route={{ screen: EAuthScreen.SignIn, state: ESignInState.Idle }}
          onNavigate={onNavigate}
        />
      )
    case EAuthScreen.SignIn:
      return <SignInScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.SignUp:
      return <SignUpScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.Forgot:
      return <ForgotScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.Reset:
      return <ResetScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.DeviceEnter:
      return <DeviceEnterScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.DeviceConfirm:
      return <DeviceConfirmScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.DeviceResult:
      return <DeviceResultScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.Setup:
      return <SetupScreen route={route} onNavigate={onNavigate} />
    case EAuthScreen.Invite:
      return <InviteScreen route={route} onNavigate={onNavigate} />
  }
}

export function AuthPreview({ route, onNavigate }: { route: AuthRoute; onNavigate?: Navigate }) {
  if (route.screen === EAuthScreen.Home && route.state === EHomeState.SignedIn) {
    return <NewThreadView />
  }
  return (
    <AuthShell route={route}>
      <ScreenView key={JSON.stringify(route)} route={route} onNavigate={onNavigate} />
    </AuthShell>
  )
}
