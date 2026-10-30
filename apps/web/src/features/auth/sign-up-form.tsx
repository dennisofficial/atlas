'use client'

import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { useIsDesktop } from '@/features/desktop/use-is-desktop'
import { AuthApiError, isAccountExistsError, signUp } from '@/lib/auth-api'
import { safeNextPath, withNext } from '@/lib/auth-redirect'

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
import { DesktopSignIn } from './desktop-sign-in'
import { useGoogleSignIn } from './use-google-sign-in'

export const PASSWORD_MIN_LENGTH = 8

function WebSignUpForm() {
  const next = safeNextPath(useSearchParams().get('next'))
  const signInHref = withNext({ path: '/sign-in', next })
  const google = useGoogleSignIn(next)
  const [error, setError] = useState<string | null>(null)
  const [exists, setExists] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    setExists(false)
    try {
      await signUp({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      })
      window.location.assign(next ?? '/setup')
    } catch (cause) {
      setExists(isAccountExistsError(cause))
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-up failed')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Create your Atlas account"
        description="One account for the terminal and Atlas Cloud."
      />
      <div className="flex flex-col gap-4">
        {google.error !== null && <FormError>{google.error}</FormError>}
        <GoogleButton
          label="Sign up with Google"
          busy={google.busy}
          disabled={busy}
          onPress={() => void google.start()}
        />
        <OrDivider />
        <form onSubmit={handleSubmit}>
          <FieldGroup>
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
              minLength={PASSWORD_MIN_LENGTH}
              disabled={busy}
              description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            />
            {error !== null && (
              <FormError>
                {exists ? 'An account with this email already exists.' : error}
                {exists && (
                  <>
                    {' '}
                    <AuthLink href={signInHref}>Sign in instead</AuthLink>
                  </>
                )}
              </FormError>
            )}
            <SubmitButton busy={busy}>Create account</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        Already have an account? <AuthLink href={signInHref}>Sign in</AuthLink>
      </AuthFooterText>
    </div>
  )
}

export function SignUpForm() {
  const desktop = useIsDesktop()
  const searchParams = useSearchParams()
  if (!desktop) return <WebSignUpForm />
  return (
    <DesktopSignIn
      title="Create your Atlas account"
      description="Finish sign-up in your browser."
      next={safeNextPath(searchParams.get('next'))}
    />
  )
}
