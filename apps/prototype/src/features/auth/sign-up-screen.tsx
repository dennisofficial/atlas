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
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS } from './auth-paths'
import { ESignUpState } from './auth-states'
import { AUTH_PASSWORD_MIN_LENGTH } from './fixtures/auth'

export function SignUpScreen({ state }: { state: ESignUpState }) {
  const router = useRouter()
  const busy = state === ESignUpState.Busy

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    router.push(AUTH_PATHS.setup)
  }

  const handleGoogle = () => router.push(AUTH_PATHS.setup)

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Create your Atlas account"
        description="One account for the terminal and Atlas Cloud."
      />
      <div className="flex flex-col gap-4">
        <GoogleButton label="Sign up with Google" disabled={busy} onPress={handleGoogle} />
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
            {state === ESignUpState.EmailTaken && (
              <FormError>
                An account with this email already exists.{' '}
                <AuthLink href={AUTH_PATHS.signIn}>Sign in instead</AuthLink>
              </FormError>
            )}
            <SubmitButton busy={busy}>Create account</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        Already have an account? <AuthLink href={AUTH_PATHS.signIn}>Sign in</AuthLink>
      </AuthFooterText>
    </div>
  )
}
