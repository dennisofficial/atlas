import { useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { AUTH_PASSWORD_MIN_LENGTH, AUTH_USER } from '../../fixtures/auth'
import { AuthField } from './auth-field'
import {
  AuthFooterText,
  AuthLink,
  FormError,
  GoogleButton,
  OrDivider,
  SubmitButton,
} from './auth-controls'
import { AuthHeading } from './auth-heading'
import {
  EAuthScreen,
  ESetupState,
  ESignInState,
  ESignUpState,
  type ScreenProps,
} from './auth-route'
import { useDelayed } from './use-demo'

export function SignUpScreen({ route, onNavigate }: ScreenProps<EAuthScreen.SignUp>) {
  const [state, setState] = useState(route.state ?? ESignUpState.Idle)
  const [googleBusy, setGoogleBusy] = useState(false)
  const later = useDelayed()
  const busy = state === ESignUpState.Busy

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const name = String(form.get('name') ?? '')
    setState(ESignUpState.Busy)
    later(() => {
      if (email.toLowerCase() === AUTH_USER.email) {
        setState(ESignUpState.Error)
        return
      }
      setState(ESignUpState.Idle)
      onNavigate?.({ screen: EAuthScreen.Setup, state: ESetupState.Workspace, name })
    })
  }

  const handleGoogle = () => {
    setGoogleBusy(true)
    later(() => {
      setGoogleBusy(false)
      onNavigate?.({ screen: EAuthScreen.Setup, state: ESetupState.Workspace })
    })
  }

  const handleSignIn = () => onNavigate?.({ screen: EAuthScreen.SignIn, state: ESignInState.Idle })

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Create your Atlas account"
        description="One account for the terminal and Atlas Cloud."
      />
      <div className="flex flex-col gap-4">
        <GoogleButton
          label="Sign up with Google"
          busy={googleBusy}
          disabled={busy}
          onPress={handleGoogle}
        />
        <OrDivider />
        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-4">
            <AuthField
              id="name"
              label="Name"
              autoComplete="name"
              placeholder="Ada Lovelace"
              disabled={busy}
            />
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
              autoComplete="new-password"
              disabled={busy}
              description={`At least ${AUTH_PASSWORD_MIN_LENGTH} characters.`}
            />
            {state === ESignUpState.Error && (
              <FormError>
                An account with this email already exists.{' '}
                <AuthLink onPress={handleSignIn}>Sign in instead</AuthLink>
              </FormError>
            )}
            <SubmitButton busy={busy}>Create account</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        Already have an account? <AuthLink onPress={handleSignIn}>Sign in</AuthLink>
      </AuthFooterText>
    </div>
  )
}
