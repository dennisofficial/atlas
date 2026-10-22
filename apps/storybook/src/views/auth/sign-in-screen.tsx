import { Mail, TerminalSquare } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { AUTH_WORKSPACE } from '../../fixtures/auth'
import { AuthField } from './auth-field'
import {
  AuthFooterText,
  AuthLink,
  FormError,
  GoogleButton,
  OrDivider,
  SubmitButton,
} from './auth-controls'
import { AuthBanner, AuthHeading } from './auth-heading'
import {
  EAuthScreen,
  EDeviceConfirmState,
  EHomeState,
  EInviteState,
  ESignInContext,
  ESignInState,
  type AuthRoute,
  type ScreenProps,
} from './auth-route'
import { useDelayed } from './use-demo'

const WRONG_PASSWORD = 'wrong'

function routeAfterSignIn(context: ESignInContext): AuthRoute {
  switch (context) {
    case ESignInContext.Device:
      return { screen: EAuthScreen.DeviceConfirm, state: EDeviceConfirmState.Idle }
    case ESignInContext.Invite:
      return { screen: EAuthScreen.Invite, state: EInviteState.SignedIn }
    default:
      return { screen: EAuthScreen.Home, state: EHomeState.SignedIn }
  }
}

function ContextBanner({ context }: { context: ESignInContext }) {
  if (context === ESignInContext.Device) {
    return <AuthBanner icon={TerminalSquare}>Sign in to authorize your terminal</AuthBanner>
  }
  if (context === ESignInContext.Invite) {
    return (
      <AuthBanner icon={Mail}>
        Sign in to accept your invitation to {AUTH_WORKSPACE.name}
      </AuthBanner>
    )
  }
  return null
}

export function SignInScreen({ route, onNavigate }: ScreenProps<EAuthScreen.SignIn>) {
  const context = route.context ?? ESignInContext.Default
  const [state, setState] = useState(route.state ?? ESignInState.Idle)
  const [googleBusy, setGoogleBusy] = useState(false)
  const later = useDelayed()
  const busy = state === ESignInState.Busy

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    setState(ESignInState.Busy)
    later(() => {
      if (password === WRONG_PASSWORD) {
        setState(ESignInState.Error)
        return
      }
      setState(ESignInState.Idle)
      onNavigate?.(routeAfterSignIn(context))
    })
  }

  const handleGoogle = () => {
    setGoogleBusy(true)
    setState(ESignInState.Idle)
    later(() => {
      setGoogleBusy(false)
      onNavigate?.(routeAfterSignIn(context))
    })
  }

  const handleForgot = () => onNavigate?.({ screen: EAuthScreen.Forgot })
  const handleSignUp = () => onNavigate?.({ screen: EAuthScreen.SignUp })

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title={context === ESignInContext.Default ? 'Sign in to Atlas' : 'Sign in to continue'}
        description="Use the account you use in the terminal."
      />
      <ContextBanner context={context} />
      <div className="flex flex-col gap-4">
        {state === ESignInState.GoogleError && (
          <FormError>Google sign-in was cancelled. Try again, or use your email.</FormError>
        )}
        <GoogleButton
          label="Continue with Google"
          busy={googleBusy}
          disabled={busy}
          onPress={handleGoogle}
        />
        <OrDivider />
        <form onSubmit={handleSubmit} noValidate={false}>
          <FieldGroup className="gap-4">
            <AuthField
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              disabled={busy}
            />
            <AuthField
              id="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              disabled={busy}
              action={<AuthLink onPress={handleForgot}>Forgot password?</AuthLink>}
            />
            {state === ESignInState.Error && <FormError>Incorrect email or password.</FormError>}
            <SubmitButton busy={busy}>Sign in</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        No account? <AuthLink onPress={handleSignUp}>Sign up</AuthLink>
      </AuthFooterText>
    </div>
  )
}
