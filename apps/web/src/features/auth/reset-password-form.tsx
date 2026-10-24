'use client'

import { CircleCheck, LinkIcon } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { FieldGroup } from '@dltech/atlas-ui/components/field'

import { AuthApiError, EAuthErrorCode, isInvalidTokenError, resetPassword } from '@/lib/auth-api'

import { FormError, LinkButton, SubmitButton } from './auth-controls'
import { AuthField } from './auth-field'
import { AuthHeading } from './auth-heading'
import { PASSWORD_MIN_LENGTH } from './sign-up-form'
import { EStatusTone, StatusIcon } from './status-icon'

enum EResetStep {
  Form = 'form',
  Success = 'success',
  Expired = 'expired',
}

function ExpiredLink() {
  return (
    <div className="flex flex-col gap-6">
      <StatusIcon icon={LinkIcon} tone={EStatusTone.Warning} />
      <AuthHeading
        title="This link has expired"
        description="Reset links work once and expire after an hour. Request a new one to continue."
      />
      <div className="flex flex-col gap-2">
        <LinkButton href="/forgot-password">Request a new link</LinkButton>
        <LinkButton href="/sign-in" variant="ghost">
          Back to sign in
        </LinkButton>
      </div>
    </div>
  )
}

function Updated() {
  return (
    <div className="flex flex-col gap-6">
      <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
      <AuthHeading
        title="Password updated"
        description="You're signed out everywhere else. Sign in with your new password."
      />
      <LinkButton href="/sign-in">Continue to sign in</LinkButton>
    </div>
  )
}

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const linkBroken =
    token === null ||
    token.length === 0 ||
    searchParams.get('error') === EAuthErrorCode.InvalidToken
  const [step, setStep] = useState(linkBroken ? EResetStep.Expired : EResetStep.Form)
  const [busy, setBusy] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (token === null) return
    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get('password') ?? '')
    if (newPassword !== String(form.get('confirm') ?? '')) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setError(null)
    setBusy(true)
    try {
      await resetPassword({ newPassword, token })
      setStep(EResetStep.Success)
    } catch (cause) {
      if (isInvalidTokenError(cause)) {
        setStep(EResetStep.Expired)
        return
      }
      setError(cause instanceof AuthApiError ? cause.message : 'Could not reset the password')
      setBusy(false)
    }
  }

  if (step === EResetStep.Success) return <Updated />
  if (step === EResetStep.Expired) return <ExpiredLink />

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title="Choose a new password"
        description="Pick something you haven't used with Atlas before."
      />
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <AuthField
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            disabled={busy}
            autoFocus
            description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          />
          <AuthField
            id="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            disabled={busy}
            error={mismatch ? "Passwords don't match." : undefined}
          />
          {error !== null && <FormError>{error}</FormError>}
          <SubmitButton busy={busy}>Update password</SubmitButton>
        </FieldGroup>
      </form>
    </div>
  )
}
