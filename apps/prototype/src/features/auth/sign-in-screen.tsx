import { TerminalSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import {
  AuthFooterText,
  AuthLink,
  FormError,
  GoogleButton,
  OrDivider,
  SubmitButton,
} from './auth-controls'
import { AuthField } from './auth-field'
import { AuthBanner, AuthHeading } from './auth-heading'
import { AUTH_PATHS } from './auth-paths'
import { ESignInContext, ESignInState } from './auth-states'

function ContextBanner({ context }: { context: ESignInContext }) {
  if (context === ESignInContext.Device) {
    return <AuthBanner icon={TerminalSquare}>Sign in to authorize your terminal</AuthBanner>
  }
  return null
}

export function SignInScreen({ state, context }: { state: ESignInState; context: ESignInContext }) {
  const router = useRouter()
  const busy = state === ESignInState.Busy

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(AUTH_PATHS.home)
  }

  const handleGoogle = () => router.push(AUTH_PATHS.home)

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
        <GoogleButton label="Continue with Google" disabled={busy} onPress={handleGoogle} />
        <OrDivider />
        <form onSubmit={handleSubmit}>
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
              action={<AuthLink href={AUTH_PATHS.forgot}>Forgot password?</AuthLink>}
            />
            {state === ESignInState.Error && <FormError>Incorrect email or password.</FormError>}
            <SubmitButton busy={busy}>Sign in</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        No account? <AuthLink href={AUTH_PATHS.signUp}>Sign up</AuthLink>
      </AuthFooterText>
    </div>
  )
}
