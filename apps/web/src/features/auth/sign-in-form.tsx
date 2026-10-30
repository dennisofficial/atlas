'use client'

import { TerminalSquare } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { useIsDesktop } from '@/features/desktop/use-is-desktop'
import { AuthApiError, signIn } from '@/lib/auth-api'
import { ESignInContext, safeNextPath, signInContextOf, withNext } from '@/lib/auth-redirect'
import { signInErrorMessage } from '@/lib/sign-in-error'

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
import { DesktopSignIn } from './desktop-sign-in'
import { useGoogleSignIn } from './use-google-sign-in'

function ContextBanner({ context }: { context: ESignInContext }) {
  if (context === ESignInContext.Device) {
    return <AuthBanner icon={TerminalSquare}>Sign in to authorize your terminal</AuthBanner>
  }
  return null
}

function WebSignInForm() {
  const searchParams = useSearchParams()
  const next = safeNextPath(searchParams.get('next'))
  const context = signInContextOf(next)
  const redirectError = signInErrorMessage(searchParams.getAll('error'))
  const google = useGoogleSignIn(next)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await signIn({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
      })
      window.location.assign(next ?? '/')
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  const googleError = google.error ?? redirectError

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title={context === ESignInContext.Default ? 'Sign in to Atlas' : 'Sign in to continue'}
        description="Use the account you use in the terminal."
      />
      <ContextBanner context={context} />
      <div className="flex flex-col gap-4">
        {googleError !== null && <FormError>{googleError}</FormError>}
        <GoogleButton
          label="Continue with Google"
          busy={google.busy}
          disabled={busy}
          onPress={() => void google.start()}
        />
        <OrDivider />
        <form onSubmit={handleSubmit}>
          <FieldGroup>
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
              action={<AuthLink href="/forgot-password">Forgot password?</AuthLink>}
            />
            {error !== null && <FormError>{error}</FormError>}
            <SubmitButton busy={busy}>Sign in</SubmitButton>
          </FieldGroup>
        </form>
      </div>
      <AuthFooterText>
        No account? <AuthLink href={withNext({ path: '/sign-up', next })}>Sign up</AuthLink>
      </AuthFooterText>
    </div>
  )
}

export function SignInForm() {
  const desktop = useIsDesktop()
  const searchParams = useSearchParams()
  if (!desktop) return <WebSignInForm />
  return (
    <DesktopSignIn
      title="Sign in to Atlas"
      description="Approve this Mac in your browser."
      next={safeNextPath(searchParams.get('next'))}
    />
  )
}
